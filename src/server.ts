import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigManager } from "./config/manager.js";

// Enhanced imports
import { EnhancedZebrunnerClient } from "./api/enhanced-client.js";
import { ZebrunnerReportingClient } from "./api/reporting-client.js";
import { ZebrunnerReportingToolHandlers } from "./handlers/reporting-tools.js";
import { FormatProcessor } from "./utils/formatter.js";
import { HierarchyProcessor } from "./utils/hierarchy.js";
import { RulesParser } from "./utils/rules-parser.js";
import { TestGenerator } from "./utils/test-generator.js";
import { getClickableLinkConfig, generateTestCaseLink, addTestCaseWebUrl, generateSuiteLink, addSuiteWebUrl } from "./utils/clickable-links.js";
import { ZebrunnerConfig } from "./types/api.js";
import { ZebrunnerReportingConfig } from "./types/reporting.js";
import {
  ZebrunnerTestCase,
  ZebrunnerTestSuite,
  ZebrunnerTestExecutionItem,
  ZebrunnerTestRun,
  ZebrunnerTestResultResponse
} from "./types/core.js";

/**
 * Unified Zebrunner MCP Server
 *
 * Features:
 * - All enhanced functionality from analysis document
 * - Improved error handling to avoid 400/404 errors
 * - Experimental features for problematic endpoints
 * - Comprehensive debug logging
 * - Multiple output formats (DTO, JSON, string, markdown)
 * - Hierarchy processing and pagination
 */

/** Initialize configuration manager with auto-detection and defaults */
const configManager = ConfigManager.getInstance();
const appConfig = configManager.getConfig();

// Extract configuration values with auto-detection and defaults
const ZEBRUNNER_URL = appConfig.baseUrl?.replace(/\/+$/, "");
const ZEBRUNNER_LOGIN = appConfig.login;
const ZEBRUNNER_TOKEN = appConfig.authToken;
const DEBUG_MODE = appConfig.debug;
const MAX_PAGE_SIZE = appConfig.maxPageSize;
const DEFAULT_PAGE_SIZE = appConfig.defaultPageSize;
const ENABLE_RULES_ENGINE = configManager.isRulesEngineEnabled();

// Print configuration summary and warnings
configManager.printConfigSummary();
const configWarnings = configManager.getWarnings();
if (configWarnings.length > 0) {
  configWarnings.forEach(warning => console.error(warning));
}

/** Enhanced API client configuration */
const config: ZebrunnerConfig = {
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN,
  timeout: 30_000,
  retryAttempts: 3,
  retryDelay: 1000,
  debug: DEBUG_MODE,
  defaultPageSize: DEFAULT_PAGE_SIZE,
  maxPageSize: MAX_PAGE_SIZE
};

const client = new EnhancedZebrunnerClient(config);

// Initialize reporting client (new authentication method)
const reportingConfig: ZebrunnerReportingConfig = {
  baseUrl: ZEBRUNNER_URL.replace('/api/public/v1', ''),
  accessToken: ZEBRUNNER_TOKEN,
  timeout: 30_000,
  debug: DEBUG_MODE
};

const reportingClient = new ZebrunnerReportingClient(reportingConfig);
const reportingHandlers = new ZebrunnerReportingToolHandlers(reportingClient, client);

// === Widget mini-config ===
const WIDGET_BASE_URL = ZEBRUNNER_URL.replace('/api/public/v1', '');

// Project aliases mapping to project keys (dynamically resolved to IDs)
const PROJECT_ALIASES: Record<string, string> = {
  web: "MFPWEB", android: "MFPAND", ios: "MFPIOS", api: "MFPAPI"
};

const PERIODS = ["Last 14 Days","Last 7 Days","Week","Month"] as const;

const PLATFORM_MAP: Record<string, string[]> = {
  web: [],        // web often uses BROWSER instead
  api: ["api"],
  android: [],
  ios: ["ios"]
};

const TEMPLATE = {
  RESULTS_BY_PLATFORM: 8,
  TOP_BUGS: 4,
  BUG_REVIEW: 9,
  FAILURE_INFO: 6,
  FAILURE_DETAILS: 10
} as const;

/** Debug logging utility with safe serialization - uses stderr to avoid MCP protocol interference */
function debugLog(message: string, data?: unknown) {
  if (DEBUG_MODE) {
    try {
      const serializedData = data ? JSON.stringify(data, null, 2) : '';
      console.error(`🔍 [DEBUG] ${message}`, serializedData);
    } catch (error) {
      console.error(`🔍 [DEBUG] ${message}`, '[Data serialization failed]', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}

/** Enhanced error handling for experimental features */
function handleExperimentalError(error: unknown, feature: string): string {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  const errorMsg = `⚠️  Experimental feature '${feature}' failed: ${errorMessage}`;

  // Type-safe status code checking
  const statusCode = (error && typeof error === 'object' && 'response' in error)
    ? (error as any).response?.status
    : undefined;

  switch (statusCode) {
    case 404:
      return `${errorMsg}\n💡 This endpoint may not be available on your Zebrunner instance.`;
    case 400:
      return `${errorMsg}\n💡 This endpoint may require different parameters for your Zebrunner instance.`;
    case 401:
      return `${errorMsg}\n💡 Check your credentials and permissions.`;
    case 403:
      return `${errorMsg}\n💡 Insufficient permissions for this operation.`;
    case 429:
      return `${errorMsg}\n💡 Rate limit exceeded. Please wait before retrying.`;
    default:
      return `${errorMsg}\n💡 Enable DEBUG=true for more details.`;
  }
}

/** Enhanced project resolution with dynamic discovery and suggestions */
async function resolveProjectId(project: string | number): Promise<{ projectId: number; suggestions?: string }> {
  if (typeof project === "number") {
    return { projectId: project };
  }

  // First try hardcoded aliases for backward compatibility
  const projectKey = PROJECT_ALIASES[project] || project;

  try {
    const projectId = await reportingClient.getProjectId(projectKey);
    return { projectId };
  } catch (error) {
    // If not found, try dynamic discovery
    try {
      const availableProjects = await reportingClient.getAvailableProjects();

      // Look for exact match
      const exactMatch = availableProjects.items.find(p =>
        p.key.toLowerCase() === project.toLowerCase() ||
        p.name.toLowerCase() === project.toLowerCase()
      );

      if (exactMatch) {
        return { projectId: exactMatch.id };
      }

      // Generate suggestions for similar projects
      const suggestions = availableProjects.items
        .filter(p =>
          p.key.toLowerCase().includes(project.toLowerCase()) ||
          p.name.toLowerCase().includes(project.toLowerCase())
        )
        .slice(0, 5) // Limit to 5 suggestions
        .map(p => `"${p.key}" (${p.name})`)
        .join(', ');

      const allProjects = availableProjects.items
        .map(p => `"${p.key}" (${p.name})`)
        .join(', ');

      const suggestionText = suggestions
        ? `\n\n💡 Did you mean: ${suggestions}?\n\n📋 Available projects: ${allProjects}`
        : `\n\n📋 Available projects: ${allProjects}`;

      throw new Error(`Project "${project}" not found.${suggestionText}`);
    } catch (discoveryError) {
      // If dynamic discovery also fails, throw original error with suggestion to use get_available_projects
      throw new Error(`Project "${project}" not found. Use get_available_projects tool to see available projects.`);
    }
  }
}

/** Improved API response validation */
function validateApiResponse(data: unknown, expectedType: string): boolean {
  if (!data) {
    debugLog(`Invalid response: null/undefined data for ${expectedType}`);
    return false;
  }

  if (expectedType === 'array' && !Array.isArray(data) && !(typeof data === 'object' && data !== null && 'items' in data)) {
    debugLog(`Invalid response: expected array or {items: []} for ${expectedType}`, data);
    return false;
  }

  return true;
}

// === Generic SQL widget caller ===
async function callWidgetSql(
  projectId: number,
  templateId: number,
  paramsConfig: any
): Promise<any> {
  const bearerToken = await reportingClient.authenticate();
  const url = `${WIDGET_BASE_URL}/api/reporting/v1/widget-templates/sql?projectId=${projectId}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({ templateId, paramsConfig })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Widget SQL failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
  }
  return res.json();
}

// === Build paramsConfig for widget requests ===
function buildParamsConfig(opts: {
  period: (typeof PERIODS)[number];
  platform?: string | string[];  // alias ("ios") or explicit array (["ios"])
  browser?: string[];            // e.g., ["chrome"] for web
  milestone?: string[];          // e.g., ["25.39.0"] for milestone filtering
  dashboardName?: string;        // optional override
  extra?: Partial<Record<string, any>>;
}) {
  const { period, platform, browser = [], milestone = [], dashboardName, extra = {} } = opts;

  if (!PERIODS.includes(period as any)) {
    throw new Error(`Invalid period: ${period}. Allowed: ${PERIODS.join(", ")}`);
  }

  const resolvedPlatform: string[] =
    Array.isArray(platform)
      ? platform
      : platform
      ? (PLATFORM_MAP[platform] ?? [])
      : [];

  return {
    BROWSER: browser,
    DEFECT: [], APPLICATION: [], BUILD: [], PRIORITY: [],
    RUN: [], USER: [], ENV: [], MILESTONE: milestone,
    PLATFORM: resolvedPlatform,
    STATUS: [], LOCALE: [],
    PERIOD: period,
    dashboardName: dashboardName ?? "Weekly results",
    isReact: true,
    ...extra
  };
}

// === Helper functions for parsing HTML anchor tags ===

/**
 * Safely strip all HTML tags from a string using iterative replacement.
 * This prevents incomplete sanitization that could leave partial tags like <script.
 * CodeQL Security Fix: Iterative stripping ensures complete tag removal.
 * @param html - Input string potentially containing HTML tags
 * @returns Plain text with all HTML tags removed
 */
function stripHtmlTags(html: string): string {
  if (!html) return "";
  
  let result = html;
  let previous: string;
  
  // Iteratively remove tags until no more are found
  // This handles cases like <<script>script> that single-pass regex misses
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, '');
  } while (result !== previous);
  
  // Also handle any remaining angle brackets that could form partial tags
  result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  return result.trim();
}

/**
 * Parse HTML anchor tag to extract URL and text
 * Example: <a href="https://example.com/browse/JIRA-123" target="_blank">JIRA-123</a>
 * Returns: { url: "https://example.com/browse/JIRA-123", text: "JIRA-123" }
 */
function parseHtmlAnchor(html: string): { url: string | null; text: string } {
  if (!html) return { url: null, text: "" };
  
  // Extract href attribute
  const hrefMatch = html.match(/href="([^"]+)"/);
  // Extract text content between tags (preferred - direct extraction)
  const textMatch = html.match(/>([^<]+)</);
  
  const url = hrefMatch ? hrefMatch[1] : null;
  // Use direct text extraction if available, otherwise safely strip all tags
  const text = textMatch ? textMatch[1] : stripHtmlTags(html);
  
  return { url, text };
}

/**
 * Parse HTML anchor with div attribute for dashboards/runs
 */
function parseDashboardAnchor(html: string, baseUrl?: string): { url: string | null; text: string; dashboardId: number | null } {
  if (!html) return { url: null, text: "", dashboardId: null };
  
  const hrefMatch = html.match(/href="([^"]+)"/);
  const textMatch = html.match(/>([^<]+)</);
  const dashboardIdMatch = html.match(/automation-dashboards\/(\d+)/);
  
  let url = hrefMatch ? hrefMatch[1] : null;
  // Use direct text extraction if available, otherwise safely strip all tags
  const text = textMatch ? textMatch[1] : stripHtmlTags(html);
  const dashboardId = dashboardIdMatch ? parseInt(dashboardIdMatch[1]) : null;
  
  // Convert relative URLs to absolute if baseUrl is provided
  if (url && baseUrl && url.startsWith('../../')) {
    const projectMatch = url.match(/\.\.\/\.\.\/([^\/]+)/);
    if (projectMatch) {
      url = `${baseUrl}/projects/${projectMatch[1]}/automation-dashboards/${dashboardId}`;
    }
  }
  
  return { url, text, dashboardId };
}

/**
 * Parse bug failure link with hashcode
 */
function parseFailureLink(html: string, baseUrl?: string): {
  url: string | null;
  text: string;
  dashboardId: number | null;
  hashcode: string | null;
  period: string | null;
} {
  if (!html) return { url: null, text: "", dashboardId: null, hashcode: null, period: null };
  
  const hrefMatch = html.match(/href="([^"]+)"/);
  const textMatch = html.match(/>([^<]+)</);
  const dashboardIdMatch = html.match(/automation-dashboards\/(\d+)/);
  const hashcodeMatch = html.match(/hashcode=([^&"]+)/);
  const periodMatch = html.match(/PERIOD=([^&"]+)/);
  
  let url = hrefMatch ? hrefMatch[1] : null;
  // Use direct text extraction if available, otherwise safely strip all tags
  const text = textMatch ? textMatch[1] : stripHtmlTags(html);
  const dashboardId = dashboardIdMatch ? parseInt(dashboardIdMatch[1]) : null;
  const hashcode = hashcodeMatch ? hashcodeMatch[1] : null;
  const period = periodMatch ? decodeURIComponent(periodMatch[1].replace(/\+/g, ' ')) : null;
  
  // Convert relative URLs to absolute if baseUrl is provided
  if (url && baseUrl && url.startsWith('../../')) {
    const projectMatch = url.match(/\.\.\/\.\.\/([^\/]+)/);
    if (projectMatch) {
      url = `${baseUrl}/projects/${projectMatch[1]}/automation-dashboards/${dashboardId}${url.includes('?') ? '?' + url.split('?')[1] : ''}`;
    }
  }
  
  return { url, text, dashboardId, hashcode, period };
}

/**
 * Convert parsed anchor to markdown link
 */
function toMarkdownLink(url: string | null, text: string): string {
  if (!url || !text) return text || "N/A";
  return `[${text}](${url})`;
}

/** Enhanced markdown rendering with debug info */
async function renderTestCaseMarkdown(
  testCase: ZebrunnerTestCase,
  includeDebugInfo: boolean = false,
  includeSuiteHierarchy: boolean = false,
  projectKey?: string,
  clickableLinkConfig?: any
): Promise<string> {
  let markdown = FormatProcessor.formatTestCaseMarkdown(testCase);

  // Add clickable links to test case key if enabled
  if (clickableLinkConfig?.includeClickableLinks && projectKey) {
    const testCaseLink = generateTestCaseLink(
      projectKey,
      testCase.key || `tc-${testCase.id}`,
      testCase.id,
      clickableLinkConfig.baseWebUrl,
      clickableLinkConfig
    );
    // Replace the test case key in the markdown with clickable link
    const keyPattern = new RegExp(`\\b${testCase.key || `tc-${testCase.id}`}\\b`, 'g');
    markdown = markdown.replace(keyPattern, testCaseLink);
  }

  // Add suite hierarchy information if available
  if (includeSuiteHierarchy && (testCase.featureSuiteId || testCase.rootSuiteId)) {
    markdown += `\n## 📁 Suite Hierarchy\n\n`;

    if (testCase.rootSuiteId) {
      markdown += `- **Root Suite ID**: ${testCase.rootSuiteId}\n`;
    }

    if (testCase.featureSuiteId) {
      markdown += `- **Feature Suite ID**: ${testCase.featureSuiteId}\n`;
    }

    if (testCase.testSuite?.id) {
      markdown += `- **Test Suite ID**: ${testCase.testSuite.id}\n`;
      if (testCase.testSuite.name || testCase.testSuite.title) {
        markdown += `- **Test Suite Name**: ${testCase.testSuite.name || testCase.testSuite.title}\n`;
      }
    }

    // Try to get hierarchy path with names if client is available
    if (projectKey && testCase.featureSuiteId) {
      try {
        const hierarchyPath = await client.getSuiteHierarchyPath(projectKey, testCase.featureSuiteId);
        if (hierarchyPath.length > 0) {
          const pathString = hierarchyPath.map(suite => `${suite.name} (${suite.id})`).join(' → ');
          markdown += `- **Hierarchy Path**: ${pathString} → Test Case\n`;
        }
      } catch (error) {
        // Ignore errors in hierarchy path resolution
      }
    }
  }

  if (includeDebugInfo && DEBUG_MODE) {
    markdown += `\n\n---\n## Debug Information\n\n`;
    markdown += `- **Retrieved At**: ${new Date().toISOString()}\n`;
    markdown += `- **API Response Size**: ${JSON.stringify(testCase).length} characters\n`;
    markdown += `- **Custom Fields Count**: ${testCase.customField ? Object.keys(testCase.customField).length : 0}\n`;
    if (includeSuiteHierarchy) {
      markdown += `- **Suite Hierarchy Included**: Yes\n`;
      markdown += `- **Feature Suite ID**: ${testCase.featureSuiteId || 'Not available'}\n`;
      markdown += `- **Root Suite ID**: ${testCase.rootSuiteId || 'Not available'}\n`;
    }
  }

  return markdown;
}

/** Perform comprehensive test coverage analysis */
async function performCoverageAnalysis(
  testCase: any,
  implementationContext: string,
  analysisScope: string,
  includeRecommendations: boolean
): Promise<any> {
  try {
    // Get rules configuration (only if rules engine is enabled)
    let rulesParser: RulesParser | null = null;
    let rules: any = null;
    let detectedFramework: any = null;

    if (ENABLE_RULES_ENGINE) {
      try {
        rulesParser = RulesParser.getInstance();
        rules = await rulesParser.getRules();
        detectedFramework = await rulesParser.detectFramework(implementationContext);
      } catch (rulesError: any) {
        debugLog("Rules engine error (continuing without rules)", { error: rulesError.message });
        // Continue without rules engine
      }
    }
  const analysis = {
    testCase: {
      key: testCase.key,
      title: testCase.title,
      description: testCase.description,
      steps: testCase.steps || [],
      priority: testCase.priority?.name,
      automationState: testCase.automationState?.name
    },
    implementation: {
      context: implementationContext,
      detectedElements: extractImplementationElements(implementationContext)
    },
    coverage: {
      stepsCoverage: [],
      assertionsCoverage: [],
      dataCoverage: [],
      overallScore: 0
    },
    recommendations: [] as string[],
    analysis: {
      scope: analysisScope,
      timestamp: new Date().toISOString(),
      missingElements: [] as string[],
      coveredElements: [] as string[],
      partiallyMissing: [] as string[]
    }
  };

  // Analyze each test step (with or without rules context)
  if (testCase.steps && testCase.steps.length > 0) {
    analysis.coverage.stepsCoverage = testCase.steps.map((step: any, index: number) => {
      const stepAnalysis = ENABLE_RULES_ENGINE
        ? analyzeStepCoverage(step, implementationContext, rules, detectedFramework)
        : analyzeStepCoverage(step, implementationContext);

      // Determine step characteristics for rules validation
      const isUI = stepAnalysis.action.toLowerCase().includes('tap') ||
                   stepAnalysis.action.toLowerCase().includes('click') ||
                   stepAnalysis.action.toLowerCase().includes('screen');
      const isAPI = stepAnalysis.action.toLowerCase().includes('api') ||
                    stepAnalysis.action.toLowerCase().includes('request') ||
                    stepAnalysis.action.toLowerCase().includes('response');
      const isCritical = stepAnalysis.action.toLowerCase().includes('login') ||
                         stepAnalysis.action.toLowerCase().includes('payment') ||
                         stepAnalysis.action.toLowerCase().includes('critical');

      return {
        stepNumber: index + 1,
        action: step.action,
        expectedResult: step.expectedResult,
        coverage: stepAnalysis.coverage,
        implementationMatches: stepAnalysis.matches,
        missingElements: stepAnalysis.missing,
        confidence: stepAnalysis.confidence,
        isUI,
        isAPI,
        isCritical,
        rulesViolations: stepAnalysis.rulesViolations || []
      };
    });
  }

  // Calculate overall coverage score
  const totalSteps = analysis.coverage.stepsCoverage.length;
  const coveredSteps = analysis.coverage.stepsCoverage.filter((step: any) => step.coverage > 0.5).length;
  analysis.coverage.overallScore = totalSteps > 0 ? Math.round((coveredSteps / totalSteps) * 100) : 0;

  // Validate coverage against rules (only if rules engine is enabled)
  if (ENABLE_RULES_ENGINE && rulesParser) {
    const stepCoverages = analysis.coverage.stepsCoverage.map((step: any) => ({
      step: step.stepNumber,
      coverage: step.coverage * 100,
      isUI: step.isUI,
      isAPI: step.isAPI,
      isCritical: step.isCritical
    }));

    const rulesValidation = await rulesParser.validateCoverage(stepCoverages, analysis.coverage.overallScore);
    (analysis as any).rulesValidation = rulesValidation;
  }

  // Generate recommendations (enhanced with rules context if available)
  if (includeRecommendations) {
    try {
      analysis.recommendations = ENABLE_RULES_ENGINE
        ? generateCoverageRecommendations(analysis, rules, detectedFramework)
        : generateCoverageRecommendations(analysis);
    } catch (recError: any) {
      debugLog("Error generating recommendations", { error: recError.message });
      analysis.recommendations = ["Error generating recommendations: " + recError.message];
    }
  }

  return analysis;

  } catch (error: any) {
    debugLog("Error in performCoverageAnalysis", { error: error.message, stack: error.stack });
    // Return a minimal analysis object to prevent complete failure
    return {
      testCase: {
        key: testCase?.key || 'Unknown',
        title: testCase?.title || 'Unknown',
        description: testCase?.description || '',
        steps: testCase?.steps || [],
        priority: testCase?.priority?.name || 'Unknown',
        automationState: testCase?.automationState?.name || 'Unknown'
      },
      implementation: {
        context: implementationContext,
        detectedElements: { methods: [], classes: [], variables: [], assertions: [], testData: [], uiElements: [], apiCalls: [] }
      },
      coverage: {
        stepsCoverage: [],
        assertionsCoverage: [],
        dataCoverage: [],
        overallScore: 0
      },
      recommendations: [`Error in coverage analysis: ${error.message}`],
      analysis: {
        scope: analysisScope,
        timestamp: new Date().toISOString(),
        missingElements: [],
        coveredElements: [],
        partiallyMissing: []
      },
      error: error.message
    };
  }
}

/** Extract implementation elements from context */
function extractImplementationElements(context: string): any {
  const elements = {
    methods: [] as string[],
    classes: [] as string[],
    variables: [] as string[],
    assertions: [] as string[],
    testData: [] as string[],
    uiElements: [] as string[],
    apiCalls: [] as string[]
  };

  // Extract method names
  const methodMatches = context.match(/(?:def|function|it\(|test\(|describe\()\s+([a-zA-Z_][a-zA-Z0-9_]*)/g);
  if (methodMatches) {
    elements.methods = methodMatches.map(match => match.split(/\s+/).pop()).filter(Boolean) as string[];
  }

  // Extract assertions
  const assertionMatches = context.match(/(assert|expect|should|verify|check)[a-zA-Z]*\s*\([^)]+\)/gi);
  if (assertionMatches) {
    elements.assertions = assertionMatches;
  }

  // Extract UI elements
  const uiMatches = context.match(/(?:getElementById|querySelector|findElement|click|tap|type|select)[a-zA-Z]*\s*\([^)]+\)/gi);
  if (uiMatches) {
    elements.uiElements = uiMatches;
  }

  return elements;
}

/** Analyze coverage for a specific test step */
function analyzeStepCoverage(step: any, implementationContext: string, rules?: any, detectedFramework?: any): any {
  const action = step.action || '';
  const expectedResult = step.expectedResult || '';

  const analysis = {
    coverage: 0,
    matches: [] as string[],
    missing: [] as string[],
    confidence: 0
  };

  // Extract keywords and analyze matches
  const actionKeywords = extractKeywords(action);
  const implementationKeywords = extractKeywords(implementationContext);

  const actionMatches = actionKeywords.filter(keyword =>
    implementationKeywords.some(implKeyword =>
      implKeyword.toLowerCase().includes(keyword.toLowerCase())
    )
  );

  const expectedKeywords = extractKeywords(expectedResult);
  const expectedMatches = expectedKeywords.filter(keyword =>
    implementationKeywords.some(implKeyword =>
      implKeyword.toLowerCase().includes(keyword.toLowerCase())
    )
  );

  // Calculate coverage score
  const totalKeywords = actionKeywords.length + expectedKeywords.length;
  const matchedKeywords = actionMatches.length + expectedMatches.length;
  analysis.coverage = totalKeywords > 0 ? matchedKeywords / totalKeywords : 0;
  analysis.confidence = Math.min(analysis.coverage * 1.2, 1.0);

  analysis.matches = [...actionMatches, ...expectedMatches];
  analysis.missing = [
    ...actionKeywords.filter(k => !actionMatches.includes(k)),
    ...expectedKeywords.filter(k => !expectedMatches.includes(k))
  ];

  return analysis;
}

/** Extract meaningful keywords from text */
function extractKeywords(text: string): string[] {
  if (!text) return [];

  const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'user'];

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.includes(word))
    .filter((word, index, arr) => arr.indexOf(word) === index);
}

/** Generate coverage improvement recommendations */
function generateCoverageRecommendations(analysis: any, rules?: any, detectedFramework?: any): string[] {
  const recommendations = [];
  const coverageScore = analysis.coverage.overallScore;

  if (coverageScore < 30) {
    recommendations.push("🔴 **Critical**: Very low test coverage. Consider implementing comprehensive automation.");
  } else if (coverageScore < 60) {
    recommendations.push("🟡 **Moderate**: Test coverage needs improvement. Focus on missing test steps.");
  } else if (coverageScore < 80) {
    recommendations.push("🟢 **Good**: Decent coverage. Fine-tune missing elements.");
  } else {
    recommendations.push("✅ **Excellent**: High coverage. Consider adding edge cases.");
  }

  const lowCoverageSteps = analysis.coverage.stepsCoverage.filter((step: any) => step.coverage < 0.5);
  if (lowCoverageSteps.length > 0) {
    recommendations.push(`📋 **Missing Steps**: ${lowCoverageSteps.length} steps need better coverage.`);
  }

  return recommendations;
}

/** Format coverage analysis output */
async function formatCoverageAnalysis(analysis: any, outputFormat: string, filePath?: string, clickableLinkConfig?: any): Promise<any> {
  const chatResponse = generateChatResponse(analysis, clickableLinkConfig);

  return {
    chatResponse,
    markdownContent: outputFormat.includes('markdown') ? chatResponse : '',
    codeComments: outputFormat.includes('code_comments') ? generateCodeComments(analysis) : ''
  };
}

/** Generate chat response format */
function generateChatResponse(analysis: any, clickableLinkConfig?: any): string {
  const testCase = analysis.testCase;
  const coverage = analysis.coverage;

  let response = `# 🔍 Test Coverage Analysis: ${testCase.key}\n\n`;

  // Add clickable link to test case if enabled
  if (clickableLinkConfig?.includeClickableLinks) {
    const testCaseLink = generateTestCaseLink(
      testCase.projectKey || testCase.project_key,
      testCase.key,
      testCase.id,
      clickableLinkConfig.baseWebUrl,
      clickableLinkConfig
    );
    response += `**Test Case**: ${testCaseLink} - ${testCase.title}\n`;
  } else {
    response += `**Test Case**: ${testCase.title}\n`;
  }

  response += `**Overall Score**: ${coverage.overallScore}%\n\n`;

  if (coverage.stepsCoverage.length > 0) {
    response += `## 📋 Step Analysis\n\n`;
    coverage.stepsCoverage.forEach((step: any) => {
      const coveragePercent = Math.round(step.coverage * 100);
      const indicator = coveragePercent >= 70 ? '✅' : coveragePercent >= 40 ? '⚠️' : '❌';

      response += `### ${indicator} Step ${step.stepNumber} (${coveragePercent}%)\n`;
      response += `**Action**: ${step.action}\n`;
      response += `**Expected**: ${step.expectedResult}\n\n`;
    });
  }

  if (analysis.recommendations.length > 0) {
    response += `## 💡 Recommendations\n\n`;
    analysis.recommendations.forEach((rec: string) => {
      response += `${rec}\n\n`;
    });
  }

  return response;
}

/** Generate code comments */
function generateCodeComments(analysis: any): string {
  return `/**\n * Coverage Analysis: ${analysis.testCase.key}\n * Score: ${analysis.coverage.overallScore}%\n */\n`;
}

async function main() {
  const server = new McpServer(
    {
      name: "mcp-zebrunner",
      version: "3.1.0",
      description: "Unified Zebrunner MCP Server with comprehensive features, improved error handling, and new Reporting API support"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  debugLog("🚀 Starting Zebrunner Unified MCP Server with Reporting API", {
    url: ZEBRUNNER_URL,
    debug: DEBUG_MODE,
    reportingApiEnabled: true
  });

  // ========== CORE WORKING FEATURES ==========

  server.tool(
    "list_test_suites",
    "📋 List test suites for a project (✅ Verified Working)",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      project_id: z.number().int().positive().optional().describe("Project ID (alternative to project_key)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      include_hierarchy: z.boolean().default(false).describe("Include hierarchy information"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(1000).default(50).describe("Page size (configurable via MAX_PAGE_SIZE env var)"),
      page_token: z.string().optional().describe("Page token for pagination"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      const { project_key, project_id, format, include_hierarchy, page, size, page_token, include_clickable_links } = args;

      try {
        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Runtime validation for configured MAX_PAGE_SIZE
        if (size > MAX_PAGE_SIZE) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Error: Requested page size (${size}) exceeds configured maximum (${MAX_PAGE_SIZE}). Set MAX_PAGE_SIZE environment variable to increase the limit.`
            }]
          };
        }

        debugLog("Listing test suites", { project_key, project_id, format, include_hierarchy, page, size, page_token });

        if (!project_key && !project_id) {
          throw new Error('Either project_key or project_id must be provided');
        }

        const searchParams = {
          projectId: project_id,
          page,
          size,
          pageToken: page_token
        };

        const suites = await client.getTestSuites(project_key || '', searchParams);

        if (!validateApiResponse(suites, 'array')) {
          throw new Error('Invalid API response format');
        }

        let processedSuites = suites.items || suites;

        if (include_hierarchy) {
          debugLog("Processing hierarchy for suites", { count: processedSuites.length });
          processedSuites = HierarchyProcessor.enrichSuitesWithHierarchy(processedSuites);
        }

        // Add clickable links to suites if enabled
        const enhancedSuites = processedSuites.map((suite: any) =>
          addSuiteWebUrl(suite, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
        );

        // Prepare response with pagination metadata
        const response = {
          items: enhancedSuites,
          _meta: suites._meta,
          pagination: {
            currentPage: page,
            pageSize: size,
            hasNextPage: suites._meta?.nextPageToken ? true : false,
            nextPageToken: suites._meta?.nextPageToken
          }
        };

        const formattedData = FormatProcessor.format(response, format);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }]
        };
      } catch (error: any) {
        debugLog("Error listing test suites", { error: error.message, stack: error.stack });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error listing test suites: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_case_by_key",
    "🔍 Get detailed test case by key (✅ Verified Working)",
    {
      project_key: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID') - auto-detected from case_key if not provided"),
      case_key: z.string().min(1).describe("Test case key (e.g., 'ANDROID-29', 'IOS-2')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_debug: z.boolean().default(false).describe("Include debug information in markdown"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId with suite hierarchy path"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      // Auto-detect project key if not provided
      let resolvedArgs;
      try {
        resolvedArgs = FormatProcessor.resolveProjectKey(args);
      } catch (error: any) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error resolving project key: ${error.message}`
          }]
        };
      }

      const { project_key, case_key, format, include_debug, include_suite_hierarchy, include_clickable_links } = resolvedArgs;

      try {
        debugLog("Getting test case by key", { project_key, case_key, format, include_suite_hierarchy, include_clickable_links });

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        const testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });

        if (!testCase) {
          throw new Error(`Test case ${case_key} not found`);
        }

        if (format === 'markdown') {
          const markdown = await renderTestCaseMarkdown(testCase, include_debug, include_suite_hierarchy, project_key, clickableLinkConfig);
          return {
            content: [{
              type: "text" as const,
              text: markdown
            }]
          };
        }

        // Add webUrl for JSON/DTO formats if clickable links enabled
        const enhancedTestCase = addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
        const formattedData = FormatProcessor.format(enhancedTestCase, format);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }]
        };
      } catch (error: any) {
        debugLog("Error getting test case by key", { error: error.message, project_key, case_key });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting test case ${case_key}: ${error.message}`
          }]
        };
      }
    }
  );

  // ========== ENHANCED FEATURES ==========

  server.tool(
    "get_all_subsuites",
    "📋 Get all subsuites from a root suite as flat list with pagination",
    {
      project_key: z.string().min(1).describe("Project key"),
      root_suite_id: z.number().int().positive().describe("Root suite ID to get all subsuites from"),
      include_root: z.boolean().default(true).describe("Include the root suite in results"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(1000).default(50).describe("Page size (configurable via MAX_PAGE_SIZE env var)")
    },
    async (args) => {
      const { project_key, root_suite_id, include_root, format, page, size } = args;

      // Runtime validation for configured MAX_PAGE_SIZE
      if (size > MAX_PAGE_SIZE) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error: Requested page size (${size}) exceeds configured maximum (${MAX_PAGE_SIZE}). Set MAX_PAGE_SIZE environment variable to increase the limit.`
          }]
        };
      }

      try {
        debugLog("Getting all subsuites from root", args);

        // Get all suites for the project
        const allSuites = await client.getAllTestSuites(project_key, {
          maxResults: 10000,
          onProgress: (count, pageNum) => debugLog(`Fetching suites: ${count} items (page ${pageNum})`)
        });

        if (allSuites.length === 0) {
          throw new Error(`No test suites found for project ${project_key}`);
        }

        // Find the root suite
        const rootSuite = allSuites.find(s => s.id === root_suite_id);
        if (!rootSuite) {
          throw new Error(`Root suite ${root_suite_id} not found in project ${project_key}`);
        }

        // Get all descendants
        const descendants = HierarchyProcessor.getSuiteDescendants(root_suite_id, allSuites);

        // Combine root + descendants if include_root is true
        let allSubsuites = include_root ? [rootSuite, ...descendants] : descendants;

        // Sort by ID for consistent ordering
        allSubsuites.sort((a, b) => a.id - b.id);

        // Apply pagination
        const startIndex = page * size;
        const endIndex = startIndex + size;
        const paginatedSubsuites = allSubsuites.slice(startIndex, endIndex);

        // Create response with pagination metadata
        const responseData = {
          items: paginatedSubsuites,
          _meta: {
            totalElements: allSubsuites.length,
            currentPage: page,
            pageSize: size,
            totalPages: Math.ceil(allSubsuites.length / size),
            hasNext: endIndex < allSubsuites.length,
            hasPrevious: page > 0,
            rootSuiteId: root_suite_id,
            rootSuiteName: rootSuite.title || rootSuite.name,
            includesRoot: include_root
          }
        };

        const formattedData = FormatProcessor.format(responseData, format);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }]
        };
      } catch (error: any) {
        debugLog("Error getting subsuites", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting subsuites from root suite ${root_suite_id}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_cases_advanced",
    "📊 Advanced test case retrieval with filtering and pagination (✨ Enhanced with automation state and date filtering)\n" +
    "⚠️  IMPORTANT: Use 'suite_id' for direct parent suites, 'root_suite_id' for root suites that contain sub-suites.\n" +
    "💡 TIP: Use 'get_test_cases_by_suite_smart' for automatic suite type detection!",
    {
      project_key: z.string().min(1).describe("Project key"),
      suite_id: z.number().int().positive().optional().describe("Filter by direct parent suite ID (for child suites)"),
      root_suite_id: z.number().int().positive().optional().describe("Filter by root suite ID (includes all sub-suites)"),
      include_steps: z.boolean().default(false).describe("Include detailed test steps"),
      // 🆕 Automation state filtering
      automation_states: z.union([
        z.string(),
        z.number(),
        z.array(z.union([z.string(), z.number()]))
      ]).optional().describe("Filter by automation state(s). Can be: single name ('Not Automated'), single ID (10), array of names (['Not Automated', 'To Be Automated']), array of IDs ([10, 12]), or mixed array (['Not Automated', 12])"),
      // 🆕 Date filtering
      created_after: z.string().optional().describe("Filter test cases created after this date (ISO format: '2024-01-01' or '2024-01-01T10:00:00Z')"),
      created_before: z.string().optional().describe("Filter test cases created before this date (ISO format: '2024-12-31' or '2024-12-31T23:59:59Z')"),
      modified_after: z.string().optional().describe("Filter test cases modified after this date (ISO format: '2024-01-01' or '2024-01-01T10:00:00Z')"),
      modified_before: z.string().optional().describe("Filter test cases modified before this date (ISO format: '2024-12-31' or '2024-12-31T23:59:59Z')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(100).default(10).describe("Page size (configurable via MAX_PAGE_SIZE env var)"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      const {
        project_key,
        suite_id,
        root_suite_id,
        include_steps,
        automation_states,
        created_after,
        created_before,
        modified_after,
        modified_before,
        format,
        page,
        size,
        include_clickable_links
      } = args;

      // Runtime validation for configured MAX_PAGE_SIZE
      if (size > MAX_PAGE_SIZE) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error: Requested page size (${size}) exceeds configured maximum (${MAX_PAGE_SIZE}). Set MAX_PAGE_SIZE environment variable to increase the limit.`
          }]
        };
      }

      try {
        debugLog("Getting advanced test cases with enhanced filtering", args);

        const searchParams = {
          page,
          size,
          suiteId: suite_id,
          rootSuiteId: root_suite_id,
          automationState: automation_states,
          createdAfter: created_after,
          createdBefore: created_before,
          modifiedAfter: modified_after,
          modifiedBefore: modified_before
        };

        const response = await client.getTestCases(project_key, searchParams);

        if (!validateApiResponse(response, 'array')) {
          throw new Error('Invalid API response format');
        }

        let processedCases = response.items || response;

        // If include_steps is true, fetch detailed info for first few cases
        if (include_steps && processedCases.length > 0) {
          debugLog("Fetching detailed steps for test cases", { count: Math.min(5, processedCases.length) });

          const casesToFetch = processedCases.slice(0, 5).filter((tc): tc is (typeof tc & { key: string }) => Boolean(tc?.key));

          const detailedCases = await Promise.allSettled(
            casesToFetch.map(async (testCase) => {
              try {
                return await client.getTestCaseByKey(project_key, testCase.key);
              } catch (error) {
                debugLog(`Failed to fetch detailed case ${testCase.key}`, { error });
                return testCase; // Fallback to original data
              }
            })
          );

          // Replace original cases with detailed versions where successful
          const detailedMap = new Map();
          detailedCases.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
              const originalCase = casesToFetch[index];
              if (originalCase?.key) {
                detailedMap.set(originalCase.key, result.value);
              }
            }
          });

          processedCases = processedCases.map(testCase =>
            testCase?.key && detailedMap.has(testCase.key)
              ? detailedMap.get(testCase.key)
              : testCase
          );
        }

        // Add helpful information about API limitations
        const responseData = {
          items: processedCases,
          _meta: response._meta, // Use corrected metadata from enhanced client
          _notice: response._meta?.totalElements === 10 && response._meta?.hasNext === undefined ?
            "⚠️  Note: Zebrunner API has known limitations with pagination and suite filtering. Results may be limited to available test cases." : undefined
        };

        const formattedData = FormatProcessor.format(responseData, format);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }]
        };
      } catch (error: any) {
        debugLog("Error getting advanced test cases", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error retrieving test cases: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_suite_hierarchy",
    "🌳 Get hierarchical test suite tree with configurable depth",
    {
      project_key: z.string().min(1).describe("Project key"),
      root_suite_id: z.number().int().positive().optional().describe("Start from specific root suite"),
      max_depth: z.number().int().positive().max(10).default(5).describe("Maximum tree depth"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      const { project_key, root_suite_id, max_depth, format, include_clickable_links } = args;

      try {
        debugLog("Building suite hierarchy", args);

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        const allSuites = await client.getAllTestSuites(project_key, {
          maxResults: 5000, // Reasonable limit for hierarchy processing
          onProgress: (count, page) => debugLog(`Fetching suites: ${count} items (page ${page})`)
        });

        if (allSuites.length === 0) {
          throw new Error(`No test suites found for project ${project_key}`);
        }
        let suitesToProcess = allSuites;

        // Filter by root suite if specified
        if (root_suite_id) {
          const descendants = HierarchyProcessor.getSuiteDescendants(root_suite_id, allSuites);
          const rootSuite = allSuites.find(s => s.id === root_suite_id);
          suitesToProcess = rootSuite ? [rootSuite, ...descendants] : descendants;
        }

        // Build hierarchical tree
        const hierarchyTree = HierarchyProcessor.buildSuiteTree(suitesToProcess);

        // Limit depth with proper typing and add clickable links
        const limitDepth = (suites: ZebrunnerTestSuite[], currentDepth: number): ZebrunnerTestSuite[] => {
          if (currentDepth >= max_depth) {
            return suites.map(suite => addSuiteWebUrl({ ...suite, children: [] }, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig));
          }

          return suites.map(suite => addSuiteWebUrl({
            ...suite,
            children: suite.children ? limitDepth(suite.children, currentDepth + 1) : []
          }, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig));
        };

        const limitedTree = limitDepth(hierarchyTree, 0);
        const formattedData = FormatProcessor.format(limitedTree, format);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }]
        };
      } catch (error: any) {
        debugLog("Error building suite hierarchy", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error building suite hierarchy: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_cases_by_automation_state",
    "🤖 Get test cases filtered by automation state (💡 Use get_automation_states to see available states)",
    {
      project_key: z.string().min(1).describe("Project key"),
      automation_states: z.union([
        z.string(),
        z.number(),
        z.array(z.union([z.string(), z.number()]))
      ]).describe("Automation state(s) to filter by. Examples: 'Not Automated', ['Not Automated', 'To Be Automated'], [10, 12], or 'Automated'"),
      suite_id: z.number().int().positive().optional().describe("Optional: Filter by specific suite ID"),
      created_after: z.string().optional().describe("Optional: Filter test cases created after this date (ISO format: '2024-01-01')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(100).default(20).describe("Page size"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      const { project_key, automation_states, suite_id, created_after, format, page, size, include_clickable_links } = args;

      try {
        debugLog("Getting test cases by automation state", args);

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        const searchParams = {
          page,
          size,
          suiteId: suite_id,
          automationState: automation_states,
          createdAfter: created_after
        };

        const response = await client.getTestCases(project_key, searchParams);

        if (!validateApiResponse(response, 'array')) {
          throw new Error('Invalid API response format');
        }

        let processedCases = response.items || response;

        // Add automation state info to the output
        const automationStateInfo = Array.isArray(automation_states)
          ? automation_states.join(', ')
          : automation_states;

        if (format === 'markdown') {
          let markdown = `# Test Cases by Automation State\n\n`;
          markdown += `**Project:** ${project_key}\n`;
          markdown += `**Automation State(s):** ${automationStateInfo}\n`;
          if (suite_id) markdown += `**Suite ID:** ${suite_id}\n`;
          if (created_after) markdown += `**Created After:** ${created_after}\n`;
          markdown += `**Total Found:** ${processedCases.length}\n\n`;

          if (processedCases.length === 0) {
            markdown += `No test cases found matching the specified automation state(s).\n\n`;
            markdown += `💡 **Available automation states:**\n`;
            markdown += `- 🖐️ Not Automated\n`;
            markdown += `- 👤 To Be Automated\n`;
            markdown += `- ⚙️ Automated\n`;
          } else {
            markdown += `## Test Cases\n\n`;
            processedCases.forEach((testCase: any, index: number) => {
              const num = page * size + index + 1;
              const testCaseDisplay = generateTestCaseLink(
                project_key,
                testCase.key || 'N/A',
                testCase.id,
                clickableLinkConfig.baseWebUrl,
                clickableLinkConfig
              );
              markdown += `### ${num}. ${testCaseDisplay} - ${testCase.title || 'Untitled'}\n\n`;

              if (testCase.automationState) {
                const stateIcon = testCase.automationState.name === 'Automated' ? '⚙️' :
                                testCase.automationState.name === 'To Be Automated' ? '👤' : '🖐️';
                markdown += `**Automation State:** ${stateIcon} ${testCase.automationState.name}\n`;
              }

              if (testCase.priority) {
                markdown += `**Priority:** ${testCase.priority.name}\n`;
              }

              if (testCase.createdAt) {
                markdown += `**Created:** ${new Date(testCase.createdAt).toLocaleDateString()}\n`;
              }

              if (testCase.description) {
                markdown += `**Description:** ${testCase.description.substring(0, 200)}${testCase.description.length > 200 ? '...' : ''}\n`;
              }

              markdown += `\n`;
            });
          }

          return {
            content: [{
              type: "text" as const,
              text: markdown
            }]
          };
        }

        // For other formats, return structured data
        const enhancedTestCases = processedCases.map((tc: any) =>
          addTestCaseWebUrl(tc, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
        );

        const result = {
          project_key,
          automation_states: automationStateInfo,
          suite_id,
          created_after,
          total_found: processedCases.length,
          page,
          size,
          test_cases: enhancedTestCases
        };

        if (format === 'string') {
          let output = `Test Cases by Automation State\n`;
          output += `Project: ${project_key}\n`;
          output += `Automation State(s): ${automationStateInfo}\n`;
          if (suite_id) output += `Suite ID: ${suite_id}\n`;
          if (created_after) output += `Created After: ${created_after}\n`;
          output += `Total Found: ${processedCases.length}\n\n`;

          if (processedCases.length === 0) {
            output += `No test cases found matching the specified automation state(s).\n`;
          } else {
            processedCases.forEach((testCase: any, index: number) => {
              const num = page * size + index + 1;
              const testCaseDisplay = generateTestCaseLink(
                project_key,
                testCase.key || 'N/A',
                testCase.id,
                clickableLinkConfig.baseWebUrl,
                clickableLinkConfig
              );
              output += `${num}. ${testCaseDisplay} - ${testCase.title || 'Untitled'}\n`;
              if (testCase.automationState) {
                output += `   Automation State: ${testCase.automationState.name}\n`;
              }
              if (testCase.priority) {
                output += `   Priority: ${testCase.priority.name}\n`;
              }
              output += `\n`;
            });
          }

          return {
            content: [{
              type: "text" as const,
              text: output
            }]
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error getting test cases by automation state", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_automation_states",
    "🔧 Get available automation states for a project (names and IDs)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      format: z.enum(['json', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("Getting automation states", args);

        // Resolve project ID using the same logic as other tools
        const { projectId } = await resolveProjectId(args.project);

        // Get automation states using the reporting client
        const automationStates = await reportingClient.getAutomationStates(projectId);

        if (args.format === 'markdown') {
          let markdown = `# Automation States for Project ${args.project}\n\n`;
          markdown += `**Project ID:** ${projectId}\n`;
          markdown += `**Total States:** ${automationStates.length}\n\n`;

          markdown += `## Available Automation States\n\n`;
          automationStates.forEach((state, index) => {
            const icon = state.name === 'Automated' ? '⚙️' :
                        state.name === 'To Be Automated' ? '👤' : '🖐️';
            markdown += `${index + 1}. **${icon} ${state.name}** (ID: ${state.id})\n`;
          });

          markdown += `\n## Usage Examples\n\n`;
          markdown += `### Filter by Name:\n`;
          markdown += `\`\`\`\n`;
          markdown += `get_test_cases_by_automation_state(\n`;
          markdown += `  project_key: "${typeof args.project === 'string' ? args.project : 'android'}",\n`;
          markdown += `  automation_states: "Not Automated"\n`;
          markdown += `)\n`;
          markdown += `\`\`\`\n\n`;

          markdown += `### Filter by ID:\n`;
          markdown += `\`\`\`\n`;
          markdown += `get_test_cases_by_automation_state(\n`;
          markdown += `  project_key: "${typeof args.project === 'string' ? args.project : 'android'}",\n`;
          markdown += `  automation_states: ${automationStates[0]?.id || 10}\n`;
          markdown += `)\n`;
          markdown += `\`\`\`\n\n`;

          markdown += `### Filter by Multiple States:\n`;
          markdown += `\`\`\`\n`;
          markdown += `get_test_cases_by_automation_state(\n`;
          markdown += `  project_key: "${typeof args.project === 'string' ? args.project : 'android'}",\n`;
          markdown += `  automation_states: ["Not Automated", "To Be Automated"]\n`;
          markdown += `)\n`;
          markdown += `\`\`\`\n`;

          return {
            content: [{
              type: "text" as const,
              text: markdown
            }]
          };
        }

        // JSON format
        const result = {
          project: args.project,
          projectId,
          automationStates: automationStates,
          // Also provide a mapping for easy reference
          mapping: automationStates.reduce((acc, state) => {
            acc[state.name] = state.id;
            return acc;
          }, {} as Record<string, number>)
        };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error getting automation states", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting automation states: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_case_by_title",
    "🔍 Get test cases by title using partial match search with pagination support",
    {
      project_key: z.string().min(1).describe("Project key"),
      title: z.string().min(1).describe("Title to search for (partial match)"),
      max_page_size: z.number().int().positive().max(100).default(10).describe("Maximum number of results per page"),
      page_token: z.string().optional().describe("Token for pagination (from previous response _meta.nextPageToken)"),
      get_all: z.boolean().default(false).describe("Get all matching test cases across all pages"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      const { project_key, title, max_page_size, page_token, get_all, format, include_clickable_links } = args;

      try {
        debugLog("Getting test case by title", args);

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Build RQL filter for title search using partial match
        // Properly escape backslashes first, then quotes to prevent injection
        const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const filter = `title~="${escapedTitle}"`;

        if (get_all) {
          // Get all pages
          const allTestCases: any[] = [];
          let currentPageToken = page_token;

          do {
            const searchParams = {
              size: max_page_size,
              filter: filter,
              pageToken: currentPageToken
            };

            const response = await client.getTestCases(project_key, searchParams);

            if (!validateApiResponse(response, 'array')) {
              throw new Error('Invalid API response format');
            }

            const pageItems = response.items || response;
            allTestCases.push(...pageItems);

            // Check for next page
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          // Add clickable links if requested
          let processedCases = allTestCases;
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);
          const summary = `Found ${processedCases.length} test case(s) total matching title "${title}"`;

          return {
            content: [{
              type: "text" as const,
              text: `${summary}\n\n${resultText}`
            }]
          };
        } else {
          // Single page
          const searchParams = {
            size: max_page_size,
            filter: filter,
            pageToken: page_token
          };

          const response = await client.getTestCases(project_key, searchParams);

          if (!validateApiResponse(response, 'array')) {
            throw new Error('Invalid API response format');
          }

          let processedCases = response.items || response;

          // Add clickable links if requested
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

          const summary = `Found ${processedCases.length} test case(s) on this page matching title "${title}"`;
          let paginationInfo = '';

          if (response._meta?.nextPageToken) {
            paginationInfo = `\n\n📄 **Pagination:** Use page_token="${response._meta.nextPageToken}" to get next page, or set get_all=true to retrieve all results.`;
          }

          return {
            content: [{
              type: "text" as const,
              text: `${summary}${paginationInfo}\n\n${resultText}`
            }]
          };
        }

      } catch (error: any) {
        debugLog("Error getting test case by title", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting test case by title: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_case_by_filter",
    "🔍 Get test cases using advanced filtering options with exact matching",
    {
      project_key: z.string().min(1).describe("Project key"),
      test_suite_id: z.number().int().positive().optional().describe("Filter by exact test suite ID"),
      created_after: z.string().optional().describe("Filter test cases created after this date (ISO format: '2024-01-01T00:00:00Z')"),
      created_before: z.string().optional().describe("Filter test cases created before this date (ISO format: '2024-12-31T23:59:59Z')"),
      last_modified_after: z.string().optional().describe("Filter test cases last modified after this date (ISO format: '2024-01-01T00:00:00Z')"),
      last_modified_before: z.string().optional().describe("Filter test cases last modified before this date (ISO format: '2024-12-31T23:59:59Z')"),
      priority_id: z.number().int().positive().optional().describe("Filter by priority ID (use get_automation_priorities to see available priorities)"),
      automation_state_id: z.number().int().positive().optional().describe("Filter by automation state ID (use get_automation_states to see available states)"),
      max_page_size: z.number().int().positive().max(100).default(20).describe("Maximum number of results per page"),
      page_token: z.string().optional().describe("Token for pagination (from previous response _meta.nextPageToken)"),
      get_all: z.boolean().default(false).describe("Get all matching test cases across all pages"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      const {
        project_key,
        test_suite_id,
        created_after,
        created_before,
        last_modified_after,
        last_modified_before,
        priority_id,
        automation_state_id,
        max_page_size,
        page_token,
        get_all,
        format,
        include_clickable_links
      } = args;

      try {
        debugLog("Getting test cases by filter", args);

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Build RQL filter from provided parameters
        const filters: string[] = [];

        if (test_suite_id) {
          filters.push(`testSuite.id = ${test_suite_id}`);
        }

        if (created_after) {
          filters.push(`createdAt >= '${created_after}'`);
        }

        if (created_before) {
          filters.push(`createdAt <= '${created_before}'`);
        }

        if (last_modified_after) {
          filters.push(`lastModifiedAt >= '${last_modified_after}'`);
        }

        if (last_modified_before) {
          filters.push(`lastModifiedAt <= '${last_modified_before}'`);
        }

        if (priority_id) {
          filters.push(`priority.id = ${priority_id}`);
        }

        if (automation_state_id) {
          filters.push(`automationState.id = ${automation_state_id}`);
        }

        if (filters.length === 0) {
          throw new Error('At least one filter parameter must be provided');
        }

        const filter = filters.join(' AND ');

        if (get_all) {
          // Get all pages
          const allTestCases: any[] = [];
          let currentPageToken = page_token;

          do {
            const searchParams = {
              size: max_page_size,
              filter: filter,
              pageToken: currentPageToken
            };

            const response = await client.getTestCases(project_key, searchParams);

            if (!validateApiResponse(response, 'array')) {
              throw new Error('Invalid API response format');
            }

            const pageItems = response.items || response;
            allTestCases.push(...pageItems);

            // Check for next page
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          // Add clickable links if requested
          let processedCases = allTestCases;
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);
          const summary = `Found ${processedCases.length} test case(s) total matching the specified filters`;
          const filterSummary = `Applied filters: ${filter}`;

          return {
            content: [{
              type: "text" as const,
              text: `${summary}\n${filterSummary}\n\n${resultText}`
            }]
          };
        } else {
          // Single page
          const searchParams = {
            size: max_page_size,
            filter: filter,
            pageToken: page_token
          };

          const response = await client.getTestCases(project_key, searchParams);

          if (!validateApiResponse(response, 'array')) {
            throw new Error('Invalid API response format');
          }

          let processedCases = response.items || response;

          // Add clickable links if requested
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

          const summary = `Found ${processedCases.length} test case(s) on this page matching the specified filters`;
          const filterSummary = `Applied filters: ${filter}`;
          let paginationInfo = '';

          if (response._meta?.nextPageToken) {
            paginationInfo = `\n\n📄 **Pagination:** Use page_token="${response._meta.nextPageToken}" to get next page, or set get_all=true to retrieve all results.`;
          }

          return {
            content: [{
              type: "text" as const,
              text: `${summary}\n${filterSummary}${paginationInfo}\n\n${resultText}`
            }]
          };
        }

      } catch (error: any) {
        debugLog("Error getting test cases by filter", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting test cases by filter: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_automation_priorities",
    "🎯 Get available priorities for a project (names and IDs)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      format: z.enum(['json', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("Getting automation priorities", args);

        // Resolve project ID using the same logic as other tools
        const { projectId } = await resolveProjectId(args.project);

        // Get priorities using the reporting client
        const priorities = await reportingClient.getPriorities(projectId);

        if (args.format === 'markdown') {
          let markdown = `# Priorities for Project ${args.project}\n\n`;
          markdown += `**Project ID:** ${projectId}\n`;
          markdown += `**Total Priorities:** ${priorities.length}\n\n`;

          markdown += `## Available Priorities\n\n`;
          priorities.forEach((priority, index) => {
            const icon = priority.name === 'High' ? '🔴' :
                        priority.name === 'Medium' ? '🟡' :
                        priority.name === 'Low' ? '🟢' :
                        priority.name === 'Trivial' ? '⚪' :
                        priority.name === 'Critical' ? '❗' : '⚪';
            markdown += `${index + 1}. **${icon} ${priority.name}** (ID: ${priority.id})\n`;
          });

          markdown += `\n## Usage Examples\n\n`;
          markdown += `### Filter by Priority ID:\n`;
          markdown += `\`\`\`\n`;
          markdown += `get_test_case_by_filter(\n`;
          markdown += `  project_key: "${typeof args.project === 'string' ? args.project : 'android'}",\n`;
          markdown += `  priority_id: ${priorities[0]?.id || 15}\n`;
          markdown += `)\n`;
          markdown += `\`\`\`\n`;

          return {
            content: [{
              type: "text" as const,
              text: markdown
            }]
          };
        }

        // JSON format
        const result = {
          project: args.project,
          projectId,
          priorities: priorities,
          // Also provide a mapping for easy reference
          mapping: priorities.reduce((acc, priority) => {
            acc[priority.name] = priority.id;
            return acc;
          }, {} as Record<string, number>)
        };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error getting automation priorities", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting automation priorities: ${error.message}`
          }]
        };
      }
    }
  );

  // ========== EXPERIMENTAL FEATURES ==========
  // Note: Experimental features have been removed as they relied on API endpoints
  // that are not available or working properly. Use the following alternatives:
  //
  // Instead of get_test_suite_experimental -> use get_tcm_suite_by_id
  // Instead of list_test_cases_by_suite_experimental -> use get_test_cases_advanced with suite_id
  // Instead of search_test_cases_experimental -> API endpoint not working
  //
  // This improves reliability and reduces maintenance overhead.

  server.tool(
    "get_test_coverage_by_test_case_steps_by_key",
    "🔍 Analyze test case coverage against actual implementation with recommendations",
    {
      project_key: z.string().min(1).optional().describe("Project key (auto-detected from case_key if not provided)"),
      case_key: z.string().min(1).describe("Test case key (e.g., 'ANDROID-6')"),
      implementation_context: z.string().min(10).describe("Actual implementation details (code snippets, file paths, or implementation description)"),
      analysis_scope: z.enum(['steps', 'assertions', 'data', 'full']).default('full').describe("Scope of analysis: steps, assertions, data coverage, or full analysis"),
      output_format: z.enum(['chat', 'markdown', 'code_comments', 'all']).default('chat').describe("Output format: chat response, markdown file, code comments, or all formats"),
      include_recommendations: z.boolean().default(true).describe("Include improvement recommendations"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId in analysis"),
      file_path: z.string().optional().describe("File path for adding code comments or saving markdown (optional)"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      try {
        // Auto-detect project key if not provided
        const resolvedArgs = FormatProcessor.resolveProjectKey(args);
        const { project_key, case_key, implementation_context, analysis_scope, output_format, include_recommendations, include_suite_hierarchy, file_path, include_clickable_links } = resolvedArgs;

        debugLog("Analyzing test coverage", { project_key, case_key, analysis_scope, output_format, include_suite_hierarchy, include_clickable_links });

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Get the detailed test case
        const testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });

        if (!testCase) {
          throw new Error(`Test case ${case_key} not found in project ${project_key}`);
        }

        // Perform coverage analysis
        const analysisResult = await performCoverageAnalysis(testCase, implementation_context, analysis_scope, include_recommendations);

        // Format output based on requested format
        const outputs = await formatCoverageAnalysis(analysisResult, output_format, file_path, clickableLinkConfig);

        return {
          content: [{
            type: "text" as const,
            text: outputs.chatResponse
          }]
        };

      } catch (error: any) {
        debugLog("Error analyzing test coverage", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error analyzing test coverage for ${args.case_key}: ${error.message}`
          }]
        };
      }
    }
  );

  // ========== NEW ENHANCED TOOLS ==========

  server.tool(
    "generate_draft_test_by_key",
    "🧪 Generate draft test code from Zebrunner test case with intelligent framework detection",
    {
      project_key: z.string().min(1).optional().describe("Project key (auto-detected from case_key if not provided)"),
      case_key: z.string().min(1).describe("Test case key (e.g., 'ANDROID-6')"),
      implementation_context: z.string().min(10).describe("Implementation context (existing code, file paths, or framework hints)"),
      target_framework: z.enum(['auto', 'java-carina', 'javascript-jest', 'python-pytest']).default('auto').describe("Target test framework (auto-detected if 'auto')"),
      output_format: z.enum(['code', 'markdown', 'comments', 'all']).default('code').describe("Output format for generated test"),
      include_setup_teardown: z.boolean().default(true).describe("Include setup and teardown code"),
      include_assertions_templates: z.boolean().default(true).describe("Include assertion templates"),
      generate_page_objects: z.boolean().default(false).describe("Generate page object classes"),
      include_data_providers: z.boolean().default(false).describe("Include data provider templates"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId information"),
      file_path: z.string().optional().describe("File path for saving generated code (optional)")
    },
    async (args) => {
      try {
        // Auto-detect project key if not provided
        const resolvedArgs = FormatProcessor.resolveProjectKey(args);
        const {
          project_key,
          case_key,
          implementation_context,
          target_framework,
          output_format,
          include_setup_teardown,
          include_assertions_templates,
          generate_page_objects,
          include_data_providers,
          include_suite_hierarchy,
          file_path
        } = resolvedArgs;

        debugLog("Generating draft test", { project_key, case_key, target_framework, output_format, include_suite_hierarchy });

        // Get the detailed test case
        const testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });

        if (!testCase) {
          throw new Error(`Test case ${case_key} not found in project ${project_key}`);
        }

        // Check if rules engine is enabled
        if (!ENABLE_RULES_ENGINE) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ Draft test generation requires the enhanced rules engine.\n\nTo enable this feature:\n1. Set ENABLE_RULES_ENGINE=true in your .env file\n2. Optionally create a rules file: mcp-zebrunner-rules.md\n3. Restart the MCP server\n\nFor backward compatibility, this feature is disabled by default.`
            }]
          };
        }

        // Initialize test generator
        const testGenerator = new TestGenerator();

        // Generate test with options
        const generatedTest = await testGenerator.generateTest(testCase, implementation_context, {
          framework: target_framework === 'auto' ? undefined : target_framework,
          outputFormat: output_format,
          includeSetupTeardown: include_setup_teardown,
          includeAssertionTemplates: include_assertions_templates,
          generatePageObjects: generate_page_objects,
          includeDataProviders: include_data_providers
        });

        // Format response based on output format
        let responseText = '';

        if (output_format === 'code' || output_format === 'all') {
          responseText += `# 🧪 Generated Test Code\n\n`;
          responseText += `**Framework Detected**: ${generatedTest.framework}\n`;
          responseText += `**Quality Score**: ${generatedTest.qualityScore}%\n\n`;

          if (generatedTest.imports.length > 0) {
            responseText += `## Imports\n\`\`\`${generatedTest.framework.includes('java') ? 'java' : 'javascript'}\n`;
            responseText += generatedTest.imports.join('\n') + '\n\`\`\`\n\n';
          }

          responseText += `## Test Code\n\`\`\`${generatedTest.framework.includes('java') ? 'java' : 'javascript'}\n`;
          responseText += generatedTest.testCode + '\n\`\`\`\n\n';

          if (generatedTest.setupCode) {
            responseText += `## Setup Code\n\`\`\`${generatedTest.framework.includes('java') ? 'java' : 'javascript'}\n`;
            responseText += generatedTest.setupCode + '\n\`\`\`\n\n';
          }

          if (generatedTest.pageObjectCode) {
            responseText += `## Page Object\n\`\`\`${generatedTest.framework.includes('java') ? 'java' : 'javascript'}\n`;
            responseText += generatedTest.pageObjectCode + '\n\`\`\`\n\n';
          }

          if (generatedTest.dataProviderCode) {
            responseText += `## Data Provider\n\`\`\`${generatedTest.framework.includes('java') ? 'java' : 'javascript'}\n`;
            responseText += generatedTest.dataProviderCode + '\n\`\`\`\n\n';
          }
        }

        if (generatedTest.recommendations.length > 0) {
          responseText += `## 💡 Recommendations\n`;
          generatedTest.recommendations.forEach(rec => {
            responseText += `- ${rec}\n`;
          });
          responseText += '\n';
        }

        // Add rules information if available
        try {
          const rulesParser = RulesParser.getInstance();
          const rulesPath = rulesParser.getRulesFilePath();
          responseText += `## ⚙️ Configuration\n`;
          responseText += `- **Rules File**: ${rulesPath}\n`;
          responseText += `- **Framework**: ${generatedTest.framework}\n`;
          responseText += `- **Quality Score**: ${generatedTest.qualityScore}%\n\n`;
        } catch (error) {
          // Ignore rules file errors
        }

        responseText += `---\n`;
        responseText += `*Generated by MCP Zebrunner Server with enhanced rules engine*`;

        return {
          content: [{
            type: "text" as const,
            text: responseText
          }]
        };

      } catch (error: any) {
        debugLog("Error generating draft test", { error: error.message, stack: error.stack, args });

        let errorMessage = `❌ Error generating draft test for ${args.case_key}`;
        let troubleshootingTips = '';

        // Handle specific error types
        if (error.message?.includes('500') || error.message?.includes('Internal server error')) {
          errorMessage += ': Internal server error occurred';
          troubleshootingTips = `
🔧 **Troubleshooting Steps:**
1. **Check Implementation Context**: Ensure your implementation_context parameter contains meaningful information (code snippets, file paths, or detailed descriptions)
2. **Try Different Framework**: Specify a target_framework explicitly instead of 'auto'
3. **Simplify Request**: Try with minimal parameters first
4. **Retry**: This may be a temporary server issue - try again in a few moments

💡 **Tips for Better Results:**
- Provide actual code snippets from your test files
- Include file paths to existing test implementations
- Mention specific testing frameworks you're using
- Add details about page objects or test data structures`;
        } else if (error.message?.includes('not found')) {
          errorMessage += ': Test case not found';
          troubleshootingTips = `
🔧 **Troubleshooting Steps:**
1. **Verify Test Case Key**: Ensure ${args.case_key} exists in project ${args.project_key || 'the specified project'}
2. **Check Project Key**: Verify the project key is correct
3. **Case Sensitivity**: Test case keys are case-sensitive`;
        } else if (error.message?.includes('rules engine')) {
          errorMessage += ': Rules engine configuration issue';
          troubleshootingTips = `
🔧 **Configuration Required:**
1. Set ENABLE_RULES_ENGINE=true in your .env file
2. Create a rules file: mcp-zebrunner-rules.md (optional)
3. Restart the MCP server`;
        } else {
          errorMessage += `: ${error.message}`;
          troubleshootingTips = `
🔧 **General Troubleshooting:**
1. **Implementation Context**: Provide detailed implementation context with code examples
2. **Framework Detection**: Try specifying target_framework explicitly
3. **Test Case Validity**: Ensure the test case has sufficient detail and steps`;
        }

        return {
          content: [{
            type: "text" as const,
            text: errorMessage + troubleshootingTips
          }]
        };
      }
    }
  );

  server.tool(
    "get_enhanced_test_coverage_with_rules",
    "🔍 Enhanced test coverage analysis with configurable rules validation and quality scoring",
    {
      project_key: z.string().min(1).optional().describe("Project key (auto-detected from case_key if not provided)"),
      case_key: z.string().min(1).describe("Test case key (e.g., 'ANDROID-6')"),
      implementation_context: z.string().min(10).describe("Actual implementation details (code snippets, file paths, or implementation description)"),
      analysis_scope: z.enum(['steps', 'assertions', 'data', 'full']).default('full').describe("Scope of analysis: steps, assertions, data coverage, or full analysis"),
      output_format: z.enum(['chat', 'markdown', 'detailed', 'all']).default('detailed').describe("Output format: chat response, markdown file, detailed analysis, or all formats"),
      include_recommendations: z.boolean().default(true).describe("Include improvement recommendations"),
      validate_against_rules: z.boolean().default(true).describe("Validate coverage against configured rules"),
      show_framework_detection: z.boolean().default(true).describe("Show detected framework and patterns"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId in analysis"),
      file_path: z.string().optional().describe("File path for adding code comments or saving markdown (optional)")
    },
    async (args) => {
      try {
        // Auto-detect project key if not provided
        const resolvedArgs = FormatProcessor.resolveProjectKey(args);
        const {
          project_key,
          case_key,
          implementation_context,
          analysis_scope,
          output_format,
          include_recommendations,
          validate_against_rules,
          show_framework_detection,
          include_suite_hierarchy,
          file_path
        } = resolvedArgs;

        debugLog("Enhanced coverage analysis", { project_key, case_key, analysis_scope, validate_against_rules, include_suite_hierarchy });

        // Get the detailed test case
        const testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });

        if (!testCase) {
          throw new Error(`Test case ${case_key} not found in project ${project_key}`);
        }

        // Perform enhanced coverage analysis
        const analysisResult = await performCoverageAnalysis(testCase, implementation_context, analysis_scope, include_recommendations);

        // Format enhanced output
        let responseText = `# 🔍 Enhanced Test Coverage Analysis: ${case_key}\n\n`;

        // Test case information
        responseText += `## 📋 Test Case Details\n`;
        responseText += `- **Key**: ${testCase.key}\n`;
        responseText += `- **Title**: ${testCase.title}\n`;
        responseText += `- **Priority**: ${testCase.priority?.name || 'Not set'}\n`;
        responseText += `- **Automation State**: ${testCase.automationState?.name || 'Not set'}\n\n`;

        // Framework detection (only if rules engine is enabled)
        if (show_framework_detection && ENABLE_RULES_ENGINE) {
          try {
            const rulesParser = RulesParser.getInstance();
            const detectedFramework = await rulesParser.detectFramework(implementation_context);
            responseText += `## 🔧 Framework Detection\n`;
            if (detectedFramework) {
              responseText += `- **Detected Framework**: ${detectedFramework.name}\n`;
              responseText += `- **Keywords Found**: ${detectedFramework.keywords.join(', ')}\n`;
              responseText += `- **File Patterns**: ${detectedFramework.filePatterns.join(', ')}\n`;
            } else {
              responseText += `- **Framework**: Not detected (using default patterns)\n`;
            }
            responseText += '\n';
          } catch (error) {
            // Ignore framework detection errors
          }
        } else if (show_framework_detection && !ENABLE_RULES_ENGINE) {
          responseText += `## 🔧 Framework Detection\n`;
          responseText += `- **Status**: Disabled (ENABLE_RULES_ENGINE=false)\n`;
          responseText += `- **Note**: Enable rules engine for framework detection\n\n`;
        }

        // Coverage summary
        responseText += `## 📊 Coverage Summary\n`;
        responseText += `- **Overall Score**: ${analysisResult.coverage.overallScore}%\n`;
        responseText += `- **Total Steps**: ${analysisResult.coverage.stepsCoverage.length}\n`;
        responseText += `- **Covered Steps**: ${analysisResult.coverage.stepsCoverage.filter((s: any) => s.coverage > 0.5).length}\n`;

        // Rules validation (only if rules engine is enabled)
        if (validate_against_rules && ENABLE_RULES_ENGINE && analysisResult.rulesValidation) {
          responseText += `- **Rules Validation**: ${analysisResult.rulesValidation.passed ? '✅ Passed' : '❌ Failed'}\n`;
          if (analysisResult.rulesValidation.violations.length > 0) {
            responseText += `- **Violations**: ${analysisResult.rulesValidation.violations.length}\n`;
          }
        } else if (validate_against_rules && !ENABLE_RULES_ENGINE) {
          responseText += `- **Rules Validation**: Disabled (ENABLE_RULES_ENGINE=false)\n`;
        }
        responseText += '\n';

        // Step-by-step analysis
        responseText += `## 🔄 Step Analysis\n`;
        analysisResult.coverage.stepsCoverage.forEach((step: any) => {
          const icon = step.coverage > 0.8 ? '✅' : step.coverage > 0.5 ? '⚠️' : '❌';
          responseText += `### ${icon} Step ${step.stepNumber} (${Math.round(step.coverage * 100)}%)\n`;
          responseText += `**Action**: ${step.action}\n`;
          responseText += `**Expected**: ${step.expectedResult}\n`;

          if (step.implementationMatches.length > 0) {
            responseText += `**Matches**: ${step.implementationMatches.join(', ')}\n`;
          }

          if (step.missingElements.length > 0) {
            responseText += `**Missing**: ${step.missingElements.join(', ')}\n`;
          }

          if (step.rulesViolations && step.rulesViolations.length > 0) {
            responseText += `**Rules Violations**: ${step.rulesViolations.join(', ')}\n`;
          }

          responseText += '\n';
        });

        // Rules validation details
        if (validate_against_rules && analysisResult.rulesValidation) {
          responseText += `## ⚖️ Rules Validation\n`;
          responseText += `**Status**: ${analysisResult.rulesValidation.passed ? '✅ Passed' : '❌ Failed'}\n\n`;

          if (analysisResult.rulesValidation.violations.length > 0) {
            responseText += `### ❌ Violations\n`;
            analysisResult.rulesValidation.violations.forEach((violation: string) => {
              responseText += `- ${violation}\n`;
            });
            responseText += '\n';
          }

          if (analysisResult.rulesValidation.recommendations.length > 0) {
            responseText += `### 💡 Rules Recommendations\n`;
            analysisResult.rulesValidation.recommendations.forEach((rec: string) => {
              responseText += `- ${rec}\n`;
            });
            responseText += '\n';
          }
        }

        // General recommendations
        if (include_recommendations && analysisResult.recommendations.length > 0) {
          responseText += `## 💡 Improvement Recommendations\n`;
          analysisResult.recommendations.forEach((rec: string) => {
            responseText += `- ${rec}\n`;
          });
          responseText += '\n';
        }

        // Configuration info
        responseText += `## ⚙️ Configuration\n`;
        responseText += `- **Rules Engine**: ${ENABLE_RULES_ENGINE ? 'Enabled' : 'Disabled'}\n`;
        responseText += `- **Analysis Scope**: ${analysis_scope}\n`;
        responseText += `- **Rules Validation**: ${validate_against_rules ? 'Enabled' : 'Disabled'}\n`;

        if (ENABLE_RULES_ENGINE) {
          try {
            const rulesParser = RulesParser.getInstance();
            const rulesPath = rulesParser.getRulesFilePath();
            responseText += `- **Rules File**: ${rulesPath}\n`;
          } catch (error) {
            responseText += `- **Rules File**: Error loading rules file\n`;
          }
        }
        responseText += '\n';

        responseText += `---\n`;
        responseText += `*Enhanced analysis powered by configurable rules engine*`;

        return {
          content: [{
            type: "text" as const,
            text: responseText
          }]
        };

      } catch (error: any) {
        debugLog("Error in enhanced coverage analysis", {
          error: error.message,
          stack: error.stack?.split('\n').slice(0, 5).join('\n'),
          args: {
            project_key: args.project_key,
            case_key: args.case_key,
            analysis_scope: args.analysis_scope
          }
        });

        let errorDetails = `❌ Error in enhanced coverage analysis for ${args.case_key}: ${error.message}`;

        // Add specific troubleshooting information
        if (error.message.includes('not found')) {
          errorDetails += `\n\n🔍 **Troubleshooting:**\n- Verify the test case key "${args.case_key}" exists in project "${args.project_key || 'auto-detected'}"\n- Check your Zebrunner API credentials and permissions`;
        } else if (error.message.includes('timeout') || error.message.includes('ENOTFOUND')) {
          errorDetails += `\n\n🔍 **Troubleshooting:**\n- Check your network connection to Zebrunner\n- Verify ZEBRUNNER_URL environment variable is correct`;
        } else if (error.message.includes('rules') || error.message.includes('RulesParser')) {
          errorDetails += `\n\n🔍 **Troubleshooting:**\n- Rules engine error detected\n- Set ENABLE_RULES_ENGINE=false to disable rules validation\n- Check if rules configuration files are accessible`;
        }

        errorDetails += `\n\n**Configuration:**\n- Rules Engine: ${process.env.ENABLE_RULES_ENGINE || 'undefined'}\n- Debug Mode: ${process.env.DEBUG || 'false'}`;

        return {
          content: [{
            type: "text" as const,
            text: errorDetails
          }]
        };
      }
    }
  );

  // ========== COMPREHENSIVE JAVA METHODOLOGY TOOLS ==========
  // Based on Zebrunner_MCP_API.md implementation guide

  server.tool(
    "get_tcm_test_suites_by_project",
    "📋 Get TCM test suites by project with pagination (Java methodology)",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      max_page_size: z.number().int().positive().max(1000).default(100).describe("Maximum page size for pagination"),
      page_token: z.string().optional().describe("Page token for pagination"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, max_page_size, page_token, format } = args;

        // Validate page size against configured maximum
        if (max_page_size > MAX_PAGE_SIZE) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Error: Requested page size (${max_page_size}) exceeds configured maximum (${MAX_PAGE_SIZE}). Set MAX_PAGE_SIZE environment variable to increase the limit.`
            }]
          };
        }

        debugLog("Getting TCM test suites", { project_key, max_page_size, page_token });

        // Use existing getTestSuites method with pagination
        const result = await client.getTestSuites(project_key, {
          size: max_page_size,
          pageToken: page_token
        });

        const formattedResult = FormatProcessor.format(result, format as any);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_tcm_test_suites_by_project", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting TCM test suites for ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_all_tcm_test_case_suites_by_project",
    "📋 Get ALL TCM test case suites by project using comprehensive pagination",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      include_hierarchy: z.boolean().default(true).describe("Include hierarchy information (rootSuiteId, parentSuiteName, etc.)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, include_hierarchy, format } = args;

        debugLog("Getting all TCM test case suites", { project_key, include_hierarchy });

        // Get all suites with pagination (use large page size to get all)
        let allSuites: ZebrunnerTestSuite[] = [];
        let page = 0;
        let hasMore = true;
        const pageSize = MAX_PAGE_SIZE;

        while (hasMore) {
          const result = await client.getTestSuites(project_key, {
            size: pageSize,
            page: page
          });

          allSuites.push(...result.items);

          // Check if we have more pages (simple heuristic: if we got less than pageSize, we're done)
          hasMore = result.items.length === pageSize;
          page++;

          // Safety check to prevent infinite loops
          if (page > 100) {
            console.error(`⚠️ Stopped pagination after 100 pages for project ${project_key}`);
            break;
          }
        }

        // Apply hierarchy processing if requested
        let processedSuites = allSuites;
        if (include_hierarchy) {
          processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
        }

        console.error(`Found ${processedSuites.length} suites.`);

        const formattedResult = FormatProcessor.format(processedSuites, format as any);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_all_tcm_test_case_suites_by_project", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting all TCM test case suites for ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_root_suites",
    "🌳 Get root suites (suites with no parent) from project",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, format } = args;

        debugLog("Getting root suites", { project_key });

        // Get all suites using comprehensive method
        debugLog("Fetching all suites for root suite identification", { project_key });
        const allSuites = await client.getAllTestSuites(project_key);

        // Filter to root suites only
        const rootSuites = HierarchyProcessor.getRootSuites(allSuites);

        console.error(`Found ${rootSuites.length} root suites out of ${allSuites.length} total suites.`);

        const formattedResult = FormatProcessor.format(rootSuites, format as any);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_root_suites", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting root suites for ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_tcm_suite_by_id",
    "🔍 Find TCM suite by ID with comprehensive search",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      suite_id: z.number().int().positive().describe("Suite ID to find"),
      only_root_suites: z.boolean().default(false).describe("Search only in root suites"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      try {
        const { project_key, suite_id, only_root_suites, format, include_clickable_links } = args;

        debugLog("Getting TCM suite by ID", { project_key, suite_id, only_root_suites, include_clickable_links });

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Get all suites from project using comprehensive method
        debugLog("Fetching all suites using getAllTestSuites method", { project_key, suite_id });
        const allSuites = await client.getAllTestSuites(project_key);

        debugLog("Fetched suites", {
          totalSuites: allSuites.length,
          searchingSuiteId: suite_id,
          sampleSuiteIds: allSuites.slice(0, 5).map(s => s.id)
        });

        // Filter to root suites if requested
        let searchSuites = allSuites;
        if (only_root_suites) {
          searchSuites = HierarchyProcessor.getRootSuites(allSuites);
        }

        // Find the suite
        const suite = searchSuites.find((s: ZebrunnerTestSuite) => s.id === suite_id);

        if (suite) {
          // Enhance with hierarchy information
          const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
          const enhancedSuite = processedSuites.find(s => s.id === suite_id) || suite;

          // Add clickable links if enabled
          const suiteWithLinks = addSuiteWebUrl(enhancedSuite, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig);

          console.error(`Found suite by id ${suite_id} with title: ${enhancedSuite.name || enhancedSuite.title}`);
          console.error(`Item ID: ${enhancedSuite.id}`);
          console.error(`Parent Suite ID: ${enhancedSuite.parentSuiteId}`);
          console.error(`Root Suite ID: ${enhancedSuite.rootSuiteId}`);
          console.error(`Relative Position: ${enhancedSuite.relativePosition}`);
          console.error(`Title: ${enhancedSuite.name || enhancedSuite.title}`);
          console.error(`Description: ${enhancedSuite.description || ''}`);

          const formattedResult = FormatProcessor.format(suiteWithLinks, format as any);

          return {
            content: [{
              type: "text" as const,
              text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
            }]
          };
        } else {
          console.error(`Suite id ${suite_id} was not found`);
          return {
            content: [{
              type: "text" as const,
              text: `❌ Suite ID ${suite_id} not found in project ${project_key}${only_root_suites ? ' (searched root suites only)' : ''}`
            }]
          };
        }

      } catch (error: any) {
        debugLog("Error in get_tcm_suite_by_id", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error finding TCM suite ${args.suite_id} in ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_all_tcm_test_cases_by_project",
    "📋 Get ALL TCM test cases by project using comprehensive pagination",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI"),
      max_results: z.number().int().positive().max(1000).default(500).describe("Maximum number of results (configurable limit for performance)")
    },
    async (args) => {
      try {
        const { project_key, format, include_clickable_links, max_results } = args;

        debugLog("Getting all TCM test cases", { project_key, include_clickable_links, max_results });

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Get all test cases using proper token-based pagination
        let allTestCases: ZebrunnerTestCase[] = [];
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        const maxPages = 100; // Safety limit

        do {
          const result = await client.getTestCases(project_key, {
            size: MAX_PAGE_SIZE,
            pageToken: pageToken
          });

          allTestCases.push(...result.items);
          pageToken = result._meta?.nextPageToken;
          pageCount++;

          // Apply max_results limit for performance
          if (allTestCases.length >= max_results) {
            allTestCases = allTestCases.slice(0, max_results);
            debugLog(`Limiting results to ${max_results} test cases for performance`);
            break;
          }

          debugLog("Fetched test cases page", {
            pageCount,
            currentPageSize: result.items.length,
            totalSoFar: allTestCases.length,
            hasNextPage: !!pageToken
          });

        } while (pageToken && pageCount < maxPages);

        console.error(`Found ${allTestCases.length} testcases.`);

        // Add clickable links to test cases if enabled
        const enhancedTestCases = allTestCases.map((tc: any) =>
          addTestCaseWebUrl(tc, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
        );

        const formattedResult = FormatProcessor.format(enhancedTestCases, format as any);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_all_tcm_test_cases_by_project", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting all TCM test cases for ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_all_tcm_test_cases_with_root_suite_id",
    "🌳 Get ALL TCM test cases enriched with root suite ID information",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, format } = args;

        debugLog("Getting all TCM test cases with root suite ID", { project_key });

        // Get all test cases using proper token-based pagination
        let allTestCases: ZebrunnerTestCase[] = [];
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        const maxPages = 100; // Safety limit

        do {
          const result = await client.getTestCases(project_key, {
            size: MAX_PAGE_SIZE,
            pageToken: pageToken
          });

          allTestCases.push(...result.items);
          pageToken = result._meta?.nextPageToken;
          pageCount++;

        } while (pageToken && pageCount < maxPages);

        // Get all suites for hierarchy processing using comprehensive method
        debugLog("Fetching all suites for hierarchy enrichment", { project_key });
        const allSuites = await client.getAllTestSuites(project_key);

        // Process suite hierarchy
        const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);

        // Enrich test cases with root suite information
        const enrichedTestCases = allTestCases.map(testCase => {
          const foundSuiteId = testCase.testSuite?.id;
          if (foundSuiteId) {
            const rootId = HierarchyProcessor.getRootIdBySuiteId(processedSuites, foundSuiteId);
            return { ...testCase, rootSuiteId: rootId };
          }
          return testCase;
        });

        console.error(`Added ${enrichedTestCases.length} test cases with root suite IDs.`);

        const formattedResult = FormatProcessor.format(enrichedTestCases, format as any);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_all_tcm_test_cases_with_root_suite_id", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting TCM test cases with root suite ID for ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_root_id_by_suite_id",
    "🔍 Get root suite ID for a specific suite ID",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      suite_id: z.number().int().positive().describe("Suite ID to find root for"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, suite_id, format } = args;

        debugLog("Getting root ID by suite ID", { project_key, suite_id });

        // Get all suites for hierarchy processing using comprehensive method
        debugLog("Fetching all suites for root ID calculation", { project_key, suite_id });
        const allSuites = await client.getAllTestSuites(project_key);

        // Process hierarchy and find root ID
        const rootId = HierarchyProcessor.getRootId(allSuites, suite_id);
        const suite = allSuites.find(s => s.id === suite_id);
        const rootSuite = allSuites.find(s => s.id === rootId);

        const result = {
          suiteId: suite_id,
          rootSuiteId: rootId,
          suiteName: suite?.name || suite?.title || 'Unknown',
          rootSuiteName: rootSuite?.name || rootSuite?.title || 'Unknown',
          hierarchyPath: HierarchyProcessor.generateSuitePath(suite_id, allSuites)
        };

        console.error(`Suite ${suite_id} has root suite ID: ${rootId}`);

        const formattedResult = FormatProcessor.format(result, format as any);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_root_id_by_suite_id", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting root ID for suite ${args.suite_id} in ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_cases_by_suite_smart",
    "🧠 Smart test case retrieval by suite ID - automatically detects if suite is root suite and uses appropriate filtering with enhanced pagination",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'MCP')"),
      suite_id: z.number().int().positive().describe("Suite ID to get test cases from"),
      include_steps: z.boolean().default(false).describe("Include detailed test steps for first few cases"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      get_all: z.boolean().default(true).describe("Get all test cases (true) or paginated results (false)"),
      include_sub_suites: z.boolean().default(true).describe("Include test cases from sub-suites (if any)"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based, only used if get_all=false)"),
      size: z.number().int().positive().max(100).default(50).describe("Page size (only used if get_all=false)")
    },
    async (args) => {
      try {
        const { project_key, suite_id, include_steps, format, get_all, include_sub_suites, page, size } = args;

        debugLog("Smart test case retrieval by suite", { project_key, suite_id, include_steps, format, get_all, include_sub_suites, page, size });

        // Step 1: Get all suites to determine hierarchy
        debugLog("Fetching all suites for hierarchy analysis", { project_key, suite_id });
        const allSuites = await client.getAllTestSuites(project_key);

        // Step 2: Find the suite and determine if it's a root suite
        const targetSuite = allSuites.find(s => s.id === suite_id);
        if (!targetSuite) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Suite ${suite_id} not found in project ${project_key}`
            }]
          };
        }

        // Step 3: Determine root suite ID and process hierarchy
        const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
        const rootId = HierarchyProcessor.getRootId(processedSuites, suite_id);
        const isRootSuite = rootId === suite_id;

        // Step 4: Check if this suite has children (regardless of being root or not)
        const hasChildren = processedSuites.some(s => s.parentSuiteId === suite_id);

        debugLog("Suite hierarchy analysis", {
          suite_id,
          rootId,
          isRootSuite,
          hasChildren,
          suiteName: targetSuite.name || targetSuite.title
        });

        // Step 5: Get test cases using appropriate method
        let testCases: any[];
        let filterDescription: string;

        if ((isRootSuite || hasChildren) && include_sub_suites) {
          // For root suites OR suites with children, use the enhanced filtering approach
          if (get_all) {
            // Count child suites for summary
            const childSuites = processedSuites.filter(s =>
              isRootSuite ? s.rootSuiteId === suite_id : s.parentSuiteId === suite_id
            );
            const childSuitesWithTestCases = childSuites.length;

            debugLog(`Processing ${isRootSuite ? 'root' : 'parent'} suite with ${childSuitesWithTestCases} sub-suites`, { suite_id, childSuitesWithTestCases });

            if (isRootSuite) {
              // Use existing root suite logic
              testCases = await client.getTestCasesByRootSuiteWithFilter(project_key, suite_id, processedSuites);
              filterDescription = `root suite ${suite_id} (includes all sub-suites) - all results`;
            } else {
              // New logic for parent suites that aren't root suites
              const childSuiteIds: number[] = [suite_id]; // Include parent suite itself

              // Find ALL descendants recursively (not just direct children)
              function findAllDescendants(parentId: number, processedSuites: any[]): number[] {
                const descendants: number[] = [];
                const directChildren = processedSuites.filter(s => s.parentSuiteId === parentId);

                for (const child of directChildren) {
                  descendants.push(child.id);
                  // Recursively find descendants of this child
                  const childDescendants = findAllDescendants(child.id, processedSuites);
                  descendants.push(...childDescendants);
                }

                return descendants;
              }

              const allDescendants = findAllDescendants(suite_id, processedSuites);
              childSuiteIds.push(...allDescendants);

              debugLog(`Found ${allDescendants.length} total descendants for parent suite ${suite_id}`, {
                descendants: allDescendants
              });

              const filter = `testSuite.id IN [${childSuiteIds.join(',')}]`;
              testCases = await client.getAllTestCases(project_key, { filter });
              filterDescription = `parent suite ${suite_id} with ${allDescendants.length} descendants (all levels) - all results`;
            }
          } else {
            // Get paginated results with filter for root/parent suites
            const childSuiteIds: number[] = [suite_id]; // Include suite itself

            // Find all child suites using processed suites (recursive for parent suites)
            if (isRootSuite) {
              // For root suites, use existing logic
              for (const suite of processedSuites) {
                if (suite.rootSuiteId === suite_id && suite.id !== suite_id) {
                  childSuiteIds.push(suite.id);
                }
              }
            } else {
              // For parent suites, find ALL descendants recursively
              function findAllDescendants(parentId: number, processedSuites: any[]): number[] {
                const descendants: number[] = [];
                const directChildren = processedSuites.filter(s => s.parentSuiteId === parentId);

                for (const child of directChildren) {
                  descendants.push(child.id);
                  // Recursively find descendants of this child
                  const childDescendants = findAllDescendants(child.id, processedSuites);
                  descendants.push(...childDescendants);
                }

                return descendants;
              }

              const allDescendants = findAllDescendants(suite_id, processedSuites);
              childSuiteIds.push(...allDescendants);
            }

            const filter = `testSuite.id IN [${childSuiteIds.join(',')}]`;
            const response = await client.getTestCases(project_key, {
              filter,
              page,
              size
            });

            testCases = response.items;
            filterDescription = `${isRootSuite ? 'root' : 'parent'} suite ${suite_id} with filter (${childSuiteIds.length - 1} child suites) - page ${page + 1}`;
          }
        } else {
          // For leaf suites (no children), use direct filtering
          if (get_all) {
            testCases = await client.getAllTestCases(project_key, {
              filter: `testSuite.id=${suite_id}`
            });
            filterDescription = `direct suite ${suite_id} - all results`;
          } else {
            const response = await client.getTestCases(project_key, {
              filter: `testSuite.id=${suite_id}`,
              page,
              size
            });
            testCases = response.items;
            filterDescription = `direct suite ${suite_id} - page ${page + 1}`;
          }
        }

        debugLog("Retrieved test cases", { count: testCases.length, filterDescription });

        // Step 6: Create summary information for root/parent suites
        let summaryInfo = '';
        if ((isRootSuite || hasChildren) && get_all && include_sub_suites) {
          if (isRootSuite) {
            const childSuites = processedSuites.filter(s => s.rootSuiteId === suite_id);
            summaryInfo = `\n📊 Summary: Processed ${childSuites.length} sub-suites from root suite ${suite_id}`;
          } else {
            // For parent suites, count all descendants
            function countAllDescendants(parentId: number, processedSuites: any[]): number {
              let count = 0;
              const directChildren = processedSuites.filter(s => s.parentSuiteId === parentId);

              for (const child of directChildren) {
                count++;
                count += countAllDescendants(child.id, processedSuites);
              }

              return count;
            }

            const totalDescendants = countAllDescendants(suite_id, processedSuites);
            summaryInfo = `\n📊 Summary: Processed ${totalDescendants} descendants (all levels) from parent suite ${suite_id}`;
          }
        }

        // Step 6: Include detailed steps if requested (limit to first 5 for performance)
        if (include_steps && testCases.length > 0) {
          debugLog("Fetching detailed steps for test cases", { count: Math.min(5, testCases.length) });

          const casesToFetch = testCases.slice(0, 5).filter((tc): tc is (typeof tc & { key: string }) => Boolean(tc?.key));

          const detailedCases = await Promise.allSettled(
            casesToFetch.map(async (testCase) => {
              try {
                return await client.getTestCaseByKey(project_key, testCase.key);
              } catch (error) {
                debugLog(`Failed to fetch detailed case ${testCase.key}`, { error });
                return testCase; // Fallback to original data
              }
            })
          );

          // Replace original cases with detailed versions where successful
          const detailedMap = new Map();
          detailedCases.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
              const originalCase = casesToFetch[index];
              if (originalCase?.key) {
                detailedMap.set(originalCase.key, result.value);
              }
            }
          });

          testCases = testCases.map((tc) => {
            if (tc?.key && detailedMap.has(tc.key)) {
              return detailedMap.get(tc.key);
            }
            return tc;
          });
        }

        // Step 6: Build response with metadata
        const metadata = {
          suite: {
            id: suite_id,
            name: targetSuite.name || targetSuite.title,
            isRootSuite,
            rootSuiteId: rootId
          },
          filtering: {
            method: isRootSuite ? 'filter with child suites' : 'filter direct suite',
            description: filterDescription,
            usesFilter: true
          },
          results: {
            count: testCases.length,
            getAllResults: get_all,
            page: get_all ? undefined : page,
            size: get_all ? undefined : size,
            includesSteps: include_steps
          }
        };

        const result = {
          metadata,
          testCases
        };

        const formattedData = FormatProcessor.format(result, format);

        // Add helpful summary message
        let summaryMessage = `✅ Found ${testCases.length} test cases from ${filterDescription}${summaryInfo}\n` +
          `📊 Suite: "${targetSuite.name || targetSuite.title}" (ID: ${suite_id})\n` +
          `🎯 Filter method: ${isRootSuite ? 'Root suite filtering with child suites' : hasChildren && include_sub_suites ? 'Parent suite filtering with child suites' : 'Direct suite filtering'} (filter-based)\n` +
          `🔄 Results: ${get_all ? 'All results' : `Page ${page + 1} (size: ${size})`}\n`;

        if (include_steps) {
          summaryMessage += `📝 Detailed steps included for first ${Math.min(5, testCases.length)} cases\n`;
        }

        summaryMessage += `\n${typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)}`;

        return {
          content: [{
            type: "text" as const,
            text: summaryMessage
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_test_cases_by_suite_smart", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting test cases from suite ${args.suite_id} in ${args.project_key}: ${error.message}`
          }]
        };
      }
    }
  );

  // ========== NEW REPORTING API TOOLS ==========

  server.tool(
    "get_launch_details",
    "🚀 Get comprehensive launch details including test sessions (uses new reporting API with enhanced authentication)",
    {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      includeLaunchDetails: z.boolean().default(true).describe("Include detailed launch information"),
      includeTestSessions: z.boolean().default(true).describe("Include test sessions data"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("get_launch_details called", args);
        return await reportingHandlers.getLauncherDetails(args);
      } catch (error: any) {
        debugLog("Error in get_launch_details", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting launcher details: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_launch_test_summary",
    "📊 Get lightweight launch test summary with statistics (auto-paginated, token-optimized)",
    {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'MCP') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 119783)"),
      statusFilter: z.array(z.string()).optional().describe("Filter by status (e.g., ['FAILED', 'SKIPPED'])"),
      minStability: z.number().min(0).max(100).optional().describe("Minimum stability percentage (0-100)"),
      maxStability: z.number().min(0).max(100).optional().describe("Maximum stability percentage (0-100)"),
      sortBy: z.enum(['stability', 'duration', 'name']).default('stability').describe("Sort order (stability=most unstable first)"),
      limit: z.number().int().positive().optional().describe("Limit number of tests returned (e.g., 10 for first 10 tests)"),
      summaryOnly: z.boolean().default(false).describe("Return only statistics without full test list (most lightweight)"),
      includeLabels: z.boolean().default(false).describe("Include labels array (increases token usage)"),
      includeTestCases: z.boolean().default(false).describe("Include testCases array (increases token usage)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("get_launch_test_summary called", args);
        return await reportingHandlers.getLaunchTestSummary(args);
      } catch (error: any) {
        debugLog("Error in get_launch_test_summary", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting launch test summary: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_launch_summary",
    "📋 Get quick launch summary without detailed test sessions (uses new reporting API)",
    {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("get_launch_summary called", args);
        return await reportingHandlers.getLauncherSummary(args);
      } catch (error: any) {
        debugLog("Error in get_launch_summary", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting launcher summary: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "analyze_test_failure",
    "🔍 Deep forensic analysis of failed test including logs, screenshots, error classification, and similar failures. 💡 NEW: Compare with last passed execution to see what changed! 💡 TIP: Can be auto-invoked from Zebrunner test URLs like: https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID/tests/TEST_ID",
    {
      testId: z.number().int().positive().describe("Test ID (e.g., 5451420)"),
      testRunId: z.number().int().positive().describe("Test Run ID / Launch ID (e.g., 120806)"),
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'MCP') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID - alternative to projectKey"),
      includeScreenshots: z.boolean().default(true).describe("Include screenshot links"),
      includeLogs: z.boolean().default(true).describe("Include log analysis"),
      includeArtifacts: z.boolean().default(true).describe("Include all test artifacts"),
      includePageSource: z.boolean().default(true).describe("Include page source analysis"),
      includeVideo: z.boolean().default(false).describe("Include video URL"),
      analyzeSimilarFailures: z.boolean().default(true).describe("Find similar failures in the launch"),
      analyzeScreenshotsWithAI: z.boolean().default(true).describe("Download and analyze screenshots with AI (Claude Vision)"),
      screenshotAnalysisType: z.enum(['basic', 'detailed']).default('detailed').describe("Screenshot analysis type: basic (metadata+OCR) or detailed (includes Claude Vision)"),
      format: z.enum(['detailed', 'summary', 'jira']).default('detailed').describe("Output format: detailed, summary, or jira (ready for Jira ticket creation)"),
      compareWithLastPassed: z.object({
        enabled: z.boolean().describe("Enable comparison with last passed execution"),
        includeLogs: z.boolean().optional().describe("Compare logs (default: true)"),
        includeScreenshots: z.boolean().optional().describe("Compare screenshots (default: true)"),
        includeVideo: z.boolean().optional().describe("Compare video frames (default: false)"),
        includeEnvironment: z.boolean().optional().describe("Compare environment (device, platform, etc.) (default: true)"),
        includeDuration: z.boolean().optional().describe("Compare execution duration (default: true)")
      }).optional().describe("Compare current failure with last passed execution to identify what changed")
    },
    async (args) => {
      try {
        debugLog("analyze_test_failure called", args);
        return await reportingHandlers.analyzeTestFailureById(args);
      } catch (error: any) {
        debugLog("Error in analyze_test_failure", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error analyzing test failure: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_execution_history",
    "📊 Get execution history for a test across multiple launches - shows pass/fail history, last passed execution, and pass rate",
    {
      testId: z.number().int().positive().describe("Test ID"),
      testRunId: z.number().int().positive().describe("Test Run ID / Launch ID containing the test"),
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'MCP') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID - alternative to projectKey"),
      limit: z.number().int().positive().default(10).describe("Number of history items to return (default: 10, max: 50)"),
      format: z.enum(['dto', 'json', 'string']).default('string').describe("Output format: dto (structured), json, or string (markdown table)")
    },
    async (args) => {
      try {
        debugLog("get_test_execution_history called", args);
        return await reportingHandlers.getTestExecutionHistory(args);
      } catch (error: any) {
        debugLog("Error in get_test_execution_history", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error retrieving test execution history: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "download_test_screenshot",
    "📸 Download test screenshot with authentication from Zebrunner",
    {
      screenshotUrl: z.string().describe("Screenshot URL (e.g., 'https://your-workspace.zebrunner.com/files/abc123' or '/files/abc123')"),
      testId: z.number().int().positive().optional().describe("Test ID for context"),
      projectKey: z.string().min(1).optional().describe("Project key for context"),
      outputPath: z.string().optional().describe("Custom output path (default: temp directory)"),
      returnBase64: z.boolean().default(false).describe("Return base64 encoded image")
    },
    async (args) => {
      try {
        debugLog("download_test_screenshot called", args);
        return await reportingHandlers.downloadTestScreenshot(args);
      } catch (error: any) {
        debugLog("Error in download_test_screenshot", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error downloading screenshot: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "analyze_screenshot",
    "🔍 Analyze test screenshot with OCR and visual analysis - returns image to Claude Vision for detailed analysis",
    {
      screenshotUrl: z.string().optional().describe("Screenshot URL to download and analyze"),
      screenshotPath: z.string().optional().describe("Local path to screenshot file"),
      testId: z.number().int().positive().optional().describe("Test ID for context"),
      enableOCR: z.boolean().default(false).describe("Enable OCR text extraction (slower)"),
      analysisType: z.enum(['basic', 'detailed']).default('detailed').describe("basic=metadata+OCR only, detailed=includes image for Claude Vision"),
      expectedState: z.string().optional().describe("Expected UI state for comparison")
    },
    async (args) => {
      try {
        debugLog("analyze_screenshot called", args);
        return await reportingHandlers.analyzeScreenshotTool(args);
      } catch (error: any) {
        debugLog("Error in analyze_screenshot", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error analyzing screenshot: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "analyze_test_execution_video",
    "🎬 Download and analyze test execution video with Claude Vision - extracts frames, compares with test case, and predicts if failure is bug or test issue. NEW: Analysis depth modes (quick/standard/detailed), parallel frame extraction, similar failures search, and historical trends analysis!",
    {
      testId: z.number().int().positive().describe("Test ID from Zebrunner"),
      testRunId: z.number().int().positive().describe("Launch ID / Test Run ID"),
      projectKey: z.string().min(1).optional().describe("Project key (MCP, etc.)"),
      projectId: z.number().int().positive().optional().describe("Project ID (alternative to projectKey)"),
      extractionMode: z.enum(['failure_focused', 'full_test', 'smart']).default('smart').describe("Frame extraction mode: failure_focused (10 frames), smart (20 frames), full_test (30 frames)"),
      frameInterval: z.number().int().positive().default(5).describe("Seconds between frames for full_test mode"),
      failureWindowSeconds: z.number().int().positive().default(30).describe("Time window around failure (seconds)"),
      compareWithTestCase: z.boolean().default(true).describe("Compare with test case steps"),
      testCaseKey: z.string().optional().describe("Override test case key"),
      analysisDepth: z.enum(['quick_text_only', 'standard', 'detailed']).default('standard').describe("Analysis depth: quick_text_only (no frames, ~10-20s), standard (8-12 frames for failure+coverage, ~30-60s), detailed (20-30 frames with OCR, ~60-120s)"),
      includeOCR: z.boolean().default(false).describe("Extract text from frames using OCR (slow, adds 2-3s per frame)"),
      analyzeSimilarFailures: z.boolean().default(true).describe("Find similar failures in project (last 30 days, top 10)"),
      includeHistoricalTrends: z.boolean().default(true).describe("Analyze test stability and flakiness (last 30 runs)"),
      includeLogCorrelation: z.boolean().default(true).describe("Correlate frames with log timestamps"),
      format: z.enum(['detailed', 'summary', 'jira']).default('detailed').describe("Output format"),
      generateVideoReport: z.boolean().default(true).describe("Generate timestamped report")
    },
    async (args) => {
      try {
        console.error("[DEBUG] analyze_test_execution_video called", JSON.stringify(args));
        debugLog("analyze_test_execution_video called", args);
        const result = await reportingHandlers.analyzeTestExecutionVideoTool(args);
        console.error("[DEBUG] analyze_test_execution_video completed successfully");
        return result;
      } catch (error: any) {
        console.error("[DEBUG] Error in analyze_test_execution_video:", error.message, error.stack);
        debugLog("Error in analyze_test_execution_video", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error analyzing test execution video: ${error.message}\n\nPlease ensure:\n1. The test has a video recording\n2. FFmpeg is installed\n3. You have sufficient disk space`
          }]
        };
      }
    }
  );

  server.tool(
    "detailed_analyze_launch_failures",
    "🚀 Analyze failed tests WITHOUT linked issues in a launch with grouping, statistics, and recommendations. Automatically analyzes all tests if ≤10, otherwise first 10 (use offset/limit for more). Use filterType: 'all' to include tests with issues. Supports pagination and screenshot analysis. **NEW:** Jira format with smart grouping - creates combined tickets for similar errors! 💡 TIP: Can be auto-invoked from Zebrunner launch URLs like: https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID",
    {
      testRunId: z.number().int().positive().describe("Launch ID / Test Run ID (e.g., 120806)"),
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'MCP') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID - alternative to projectKey"),
      filterType: z.enum(['all', 'without_issues']).default('without_issues').describe("Filter: 'without_issues' = only tests without linked Jira tickets (DEFAULT), 'all' = all failed tests"),
      includeScreenshotAnalysis: z.boolean().default(false).describe("Download and analyze screenshots with AI for each test (increases analysis time)"),
      screenshotAnalysisType: z.enum(['basic', 'detailed']).default('detailed').describe("Screenshot analysis type if enabled"),
      format: z.enum(['detailed', 'summary', 'jira']).default('summary').describe("Output format: 'detailed' = full analysis, 'summary' = condensed, 'jira' = ready for Jira tickets with smart grouping"),
      jiraDetailLevel: z.enum(['basic', 'full']).default('full').describe("Jira detail level: 'basic' = fast (no deep analysis), 'full' = comprehensive with deep analysis (DEFAULT, slower but thorough)"),
      executionMode: z.enum(['sequential', 'parallel', 'batches']).default('sequential').describe("Execution mode: sequential (safe), parallel (fast), or batches (balanced)"),
      batchSize: z.number().int().positive().default(5).describe("Batch size if executionMode is 'batches' (default: 5)"),
      offset: z.number().int().min(0).default(0).describe("Pagination offset - start from test N (e.g., 0 for first 20, 20 for next 20)"),
      limit: z.number().int().positive().default(20).describe("Number of tests to analyze (default: 20, max recommended: 30)")
    },
    async (args) => {
      try {
        debugLog("analyze_launch_failures called", args);
        return await reportingHandlers.analyzeLaunchFailures(args);
      } catch (error: any) {
        debugLog("Error in analyze_launch_failures", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error analyzing launch failures: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_all_launches_for_project",
    "📋 Get all launches for a project with pagination (uses new reporting API)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      page: z.number().int().positive().default(1).describe("Page number (starts from 1)"),
      pageSize: z.number().int().positive().max(100).default(20).describe("Number of launches per page (max 100)"),
      format: z.enum(['raw', 'formatted']).default('formatted').describe("Output format - 'raw' for full API response, 'formatted' for user-friendly display")
    },
    async (args) => {
      try {
        debugLog("get_all_launches_for_project called", args);

        // Resolve project ID using the same logic as other tools
        const { projectId } = await resolveProjectId(args.project);

        // Get launches using the new API method
        const launchesData = await reportingClient.getLaunches(projectId, {
          page: args.page,
          pageSize: args.pageSize
        });

        if (args.format === 'raw') {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(launchesData, null, 2)
            }]
          };
        }

        // Formatted output
        const { items, _meta } = launchesData;

        if (items.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `📋 No launches found for project ${args.project}\n\nPagination: Page ${args.page} of ${_meta.totalPages} (${_meta.total} total launches)`
            }]
          };
        }

        let output = `📋 **Launches for Project ${args.project}**\n\n`;
        output += `**Pagination:** Page ${args.page} of ${_meta.totalPages} (${_meta.total} total launches)\n\n`;

        items.forEach((launch: any, index: number) => {
          const number = (args.page - 1) * args.pageSize + index + 1;
          output += `**${number}. ${launch.name}** (ID: ${launch.id})\n`;
          output += `   📊 Status: ${launch.status}\n`;

          if (launch.milestone) {
            output += `   🎯 Milestone: ${launch.milestone.name}\n`;
          }

          if (launch.buildNumber) {
            output += `   🔨 Build: ${launch.buildNumber}\n`;
          }

          if (launch.startedAt) {
            output += `   ⏰ Started: ${new Date(launch.startedAt).toLocaleString()}\n`;
          }

          if (launch.finishedAt) {
            output += `   ✅ Finished: ${new Date(launch.finishedAt).toLocaleString()}\n`;
          }

          if (launch.duration) {
            const durationMin = Math.round(launch.duration / 60000);
            output += `   ⏱️ Duration: ${durationMin} minutes\n`;
          }

          // Test results summary
          const total = launch.total || 0;
          const passed = launch.passed || 0;
          const failed = launch.failed || 0;
          const skipped = launch.skipped || 0;

          if (total > 0) {
            output += `   📈 Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)\n`;
          }

          output += '\n';
        });

        return {
          content: [{
            type: "text" as const,
            text: output.trim()
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_all_launches_for_project", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting launches: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_all_launches_with_filter",
    "🔍 Get launches with filtering by milestone, build number, or launch name (uses new reporting API)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      milestone: z.string().optional().describe("Filter by milestone name (e.g., '25.39.0')"),
      query: z.string().optional().describe("Search query for build number or launch name (e.g., 'your-app-25.39.0-45915' or 'Performance')"),
      page: z.number().int().positive().default(1).describe("Page number (starts from 1)"),
      pageSize: z.number().int().positive().max(100).default(20).describe("Number of launches per page (max 100)"),
      format: z.enum(['raw', 'formatted']).default('formatted').describe("Output format - 'raw' for full API response, 'formatted' for user-friendly display")
    },
    async (args) => {
      try {
        debugLog("get_all_launches_with_filter called", args);

        // Validate that at least one filter is provided
        if (!args.milestone && !args.query) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Please provide at least one filter: milestone or query parameter`
            }]
          };
        }

        // Resolve project ID using the same logic as other tools
        const { projectId } = await resolveProjectId(args.project);

        // Get launches using the new API method with filters
        const launchesData = await reportingClient.getLaunches(projectId, {
          page: args.page,
          pageSize: args.pageSize,
          milestone: args.milestone,
          query: args.query
        });

        if (args.format === 'raw') {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(launchesData, null, 2)
            }]
          };
        }

        // Formatted output
        const { items, _meta } = launchesData;

        // Build filter description
        let filterDesc = '';
        if (args.milestone && args.query) {
          filterDesc = `milestone "${args.milestone}" and query "${args.query}"`;
        } else if (args.milestone) {
          filterDesc = `milestone "${args.milestone}"`;
        } else if (args.query) {
          filterDesc = `query "${args.query}"`;
        }

        if (items.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `🔍 No launches found for project ${args.project} with ${filterDesc}\n\nPagination: Page ${args.page} of ${_meta.totalPages} (${_meta.total} total launches)`
            }]
          };
        }

        let output = `🔍 **Filtered Launches for Project ${args.project}**\n\n`;
        output += `**Filter:** ${filterDesc}\n`;
        output += `**Pagination:** Page ${args.page} of ${_meta.totalPages} (${_meta.total} total launches)\n\n`;

        items.forEach((launch: any, index: number) => {
          const number = (args.page - 1) * args.pageSize + index + 1;
          output += `**${number}. ${launch.name}** (ID: ${launch.id})\n`;
          output += `   📊 Status: ${launch.status}\n`;

          if (launch.milestone) {
            output += `   🎯 Milestone: ${launch.milestone.name}\n`;
          }

          if (launch.buildNumber) {
            output += `   🔨 Build: ${launch.buildNumber}\n`;
          }

          if (launch.startedAt) {
            output += `   ⏰ Started: ${new Date(launch.startedAt).toLocaleString()}\n`;
          }

          if (launch.finishedAt) {
            output += `   ✅ Finished: ${new Date(launch.finishedAt).toLocaleString()}\n`;
          }

          if (launch.duration) {
            const durationMin = Math.round(launch.duration / 60000);
            output += `   ⏱️ Duration: ${durationMin} minutes\n`;
          }

          // Test results summary
          const total = launch.total || 0;
          const passed = launch.passed || 0;
          const failed = launch.failed || 0;
          const skipped = launch.skipped || 0;

          if (total > 0) {
            output += `   📈 Results: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)\n`;
          }

          output += '\n';
        });

        return {
          content: [{
            type: "text" as const,
            text: output.trim()
          }]
        };

      } catch (error: any) {
        debugLog("Error in get_all_launches_with_filter", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting filtered launches: ${error.message}`
          }]
        };
      }
    }
  );

  server.tool(
    "test_reporting_connection",
    "🔌 Test connection to Zebrunner Reporting API with new authentication",
    {},
    async () => {
      try {
        debugLog("test_reporting_connection called");
        const result = await reportingClient.testConnection();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error: any) {
        debugLog("Error in test_reporting_connection", { error: error.message });
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ Reporting API Connection failed: ${error.message}`
            }
          ]
        };
      }
    }
  );

  // ========== ZEBRUNNER WIDGET TOOLS ==========

  // === Tool #1: Platform test results by period ===
  server.tool(
    "get_platform_results_by_period",
    "📊 Get test results by platform for a given period (SQL widget, templateId: 8)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      period: z.enum(["Last 7 Days","Week","Month"])
        .default("Last 7 Days")
        .describe("Time period"),
      platform: z.union([z.enum(["web","android","ios","api"]), z.array(z.string())])
        .optional()
        .describe("Platform alias or explicit array for paramsConfig.PLATFORM"),
      browser: z.array(z.string())
        .default([])
        .describe("Optional BROWSER filter, e.g., ['chrome'] for web"),
      milestone: z.array(z.string())
        .default([])
        .describe("Optional MILESTONE filter, e.g., ['25.39.0'] for milestone filtering"),
      templateId: z.number()
        .default(TEMPLATE.RESULTS_BY_PLATFORM)
        .describe("Override templateId if needed"),
      dashboardName: z.string().optional()
        .describe("Override dashboard title"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw widget response or formatted data")
    },
    async (args) => {
      try {
        debugLog("get_platform_results_by_period called", args);

        // Resolve project ID with enhanced discovery and suggestions
        const { projectId } = await resolveProjectId(args.project);

        const paramsConfig = buildParamsConfig({
          period: args.period,
          platform: args.platform ?? (typeof args.project === 'string' ? args.project : undefined),   // default to project alias
          browser: args.browser,
          milestone: args.milestone,
          dashboardName: args.dashboardName
        });

        const data = await callWidgetSql(projectId, args.templateId, paramsConfig);

        if (DEBUG_MODE) {
          console.error("get_platform_results_by_period ok", {
            projectId, templateId: args.templateId, period: args.period
          });
        }

        let result;
        if (args.format === 'raw') {
          result = data;
        } else {
          // Format the data for better readability
          result = {
            summary: {
              project: args.project,
              period: args.period,
              platform: args.platform ?? args.project,
              browser: args.browser.length > 0 ? args.browser : undefined,
              milestone: args.milestone.length > 0 ? args.milestone : undefined
            },
            data: data
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error: any) {
        debugLog("Error in get_platform_results_by_period", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting platform results: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // === Tool #2: Top N most frequent bugs (with optional links) ===
  server.tool(
    "get_top_bugs",
    "🐞 Top N most frequent defects with optional issue links (SQL widget, templateId: 4)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      period: z.enum(["Last 7 Days","Week","Month"])
        .default("Last 7 Days")
        .describe("Time period"),
      limit: z.number().int().positive().max(100)
        .default(10)
        .describe("How many bugs to return"),
      templateId: z.number()
        .default(TEMPLATE.TOP_BUGS)
        .describe("Override templateId if needed"),
      issueUrlPattern: z.string().optional()
        .describe("e.g., 'https://yourcompany.atlassian.net/browse/{key}'"),
      platform: z.union([z.enum(["web","android","ios","api"]), z.array(z.string())])
        .optional()
        .describe("Optional platform filter; defaults to [] for this widget"),
      milestone: z.array(z.string())
        .default([])
        .describe("Optional MILESTONE filter, e.g., ['25.39.0'] for milestone filtering"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw widget response or formatted data")
    },
    async (args) => {
      try {
        debugLog("get_top_bugs called", args);

        // Resolve project ID with enhanced discovery and suggestions
        const { projectId } = await resolveProjectId(args.project);

        // Keep PLATFORM empty by default as per your examples
        const paramsConfig = buildParamsConfig({
          period: args.period,
          platform: args.platform ?? [],
          milestone: args.milestone,
          dashboardName: "Bugs repro rate (last 7 days)"
        });

        const raw = await callWidgetSql(projectId, args.templateId, paramsConfig);

        if (args.format === 'raw') {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(raw, null, 2) }]
          };
        }

        // Normalize returned rows - widget returns array directly
        const rows: any[] = Array.isArray(raw) ? raw : [];

        if (rows.length === 0) {
          const formatValue = args.format as 'raw' | 'formatted';
          return {
            content: [{ type: "text" as const, text: formatValue === 'raw' ? JSON.stringify(raw, null, 2) : "No bug data found" }]
          };
        }

        // Parse the widget response which contains HTML in DEFECT field
        const parseDefectHtml = (html: string) => {
          if (!html) return { key: "N/A", title: "", existingLink: null };

          // Extract ticket ID from href or text content
          const hrefMatch = html.match(/href="([^"]*\/browse\/([^"]+))"/);
          const textMatch = html.match(/>([^<]+)</);

          if (hrefMatch && hrefMatch[2]) {
            return {
              key: hrefMatch[2], // Ticket ID like "POW-5130"
              title: textMatch ? textMatch[1] : hrefMatch[2],
              existingLink: hrefMatch[1]
            };
          }

          // Handle "TO REVIEW" case or other non-ticket entries
          // Security: Use stripHtmlTags for complete HTML sanitization (CodeQL fix)
          const cleanText = textMatch ? textMatch[1] : stripHtmlTags(html);
          return {
            key: cleanText,
            title: cleanText,
            existingLink: null
          };
        };

        const parseFailures = (failuresStr: string) => {
          // Parse "24 of 225" format
          const match = failuresStr.match(/(\d+)\s+of\s+(\d+)/);
          if (match) {
            return {
              failures: parseInt(match[1]),
              total: parseInt(match[2]),
              failureCount: parseInt(match[1])
            };
          }
          return { failures: 0, total: 0, failureCount: 0 };
        };

        const top = rows
          .slice()
          .map(row => {
            const defectInfo = parseDefectHtml(row.DEFECT || "");
            const failureInfo = parseFailures(row.FAILURES || "0 of 0");
            const percentage = parseFloat(row["%"] || "0");

            // Use existing link from HTML or construct new one
            let link = defectInfo.existingLink;
            if (args.issueUrlPattern && defectInfo.key !== "N/A" && !link) {
              link = args.issueUrlPattern.replace("{key}", defectInfo.key);
            }

            return {
              key: defectInfo.key,
              title: defectInfo.title,
              failures: failureInfo.failures,
              total: failureInfo.total,
              percentage: percentage,
              failureCount: failureInfo.failureCount, // For sorting
              link: link
            };
          })
          .sort((a, b) => b.failureCount - a.failureCount)
          .slice(0, args.limit);

        if (DEBUG_MODE) {
          console.error("get_top_bugs ok", {
            projectId, templateId: args.templateId, period: args.period, returned: top.length
          });
        }

        // Return formatted or raw output based on format parameter
        const formatValue = args.format as 'raw' | 'formatted';
        if (formatValue === 'raw') {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(top, null, 2) }]
          };
        }

        // Return formatted output
        const formatted = `📊 **Top ${top.length} Most Frequent Bugs** (${args.period})\n\n` +
          top.map((bug, i) => {
            const rank = i + 1;
            const linkText = bug.link ? `[${bug.key}](${bug.link})` : bug.key;
            const failureText = `${bug.failures} of ${bug.total} tests (${bug.percentage}%)`;
            return `${rank}. **${linkText}** - ${failureText}\n   ${bug.title || bug.key}`;
          }).join('\n\n');

        return {
          content: [{ type: "text" as const, text: formatted }]
        };
      } catch (error: any) {
        debugLog("Error in get_top_bugs", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting top bugs: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // === Tool #2.1: Get detailed bug review for project and period ===
  server.tool(
    "get_bug_review",
    "🔍 Get detailed bug review with failures, defects, and reproduction dates (SQL widget, templateId: 9)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      period: z.enum(["Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "Week", "Month", "Quarter"])
        .default("Last 7 Days")
        .describe("Time period for bug review"),
      limit: z.number().int().positive().max(500)
        .default(100)
        .describe("Maximum number of bugs to return (default: 100, max: 500)"),
      templateId: z.number()
        .default(TEMPLATE.BUG_REVIEW)
        .describe("Override templateId if needed (default: 9 for Bug Review)"),
      format: z.enum(['detailed', 'summary', 'json']).default('detailed')
        .describe("Output format: detailed (full info with markdown links), summary (concise), or json (raw data)")
    },
    async (args) => {
      try {
        debugLog("get_bug_review called", args);

        // Resolve project ID with enhanced discovery and suggestions
        const { projectId } = await resolveProjectId(args.project);

        // Build params config for bug review widget
        const paramsConfig = {
          BROWSER: [],
          DEFECT: [],
          APPLICATION: [],
          BUILD: [],
          PRIORITY: [],
          RUN: [],
          USER: [],
          ENV: [],
          MILESTONE: [],
          PLATFORM: [],
          STATUS: [],
          LOCALE: [],
          PERIOD: args.period,
          ERROR_COUNT: "0",
          dashboardName: "Bug review",
          isReact: true
        };

        const raw = await callWidgetSql(projectId, args.templateId, paramsConfig);

        // Normalize returned rows - widget returns array directly
        const rows: any[] = Array.isArray(raw) ? raw : [];

        if (rows.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No bug review data found for the specified period" }]
          };
        }

        // Apply limit to results
        const limitedRows = rows.slice(0, args.limit);

        // Parse and process bug review data
        const baseUrl = WIDGET_BASE_URL; // Use the configured base URL
        
        const bugs = limitedRows.map((row, index) => {
          const projectInfo = parseDashboardAnchor(row.PROJECT || "", baseUrl);
          const defectInfo = parseHtmlAnchor(row.DEFECT || "");
          const failureInfo = parseFailureLink(row["#"] || "", baseUrl);
          
          return {
            rank: index + 1,
            project: projectInfo.text,
            projectUrl: projectInfo.url,
            projectDashboardId: projectInfo.dashboardId,
            reason: (row.REASON || "").replace(/\\n/g, '\n'), // Unescape newlines
            defectKey: defectInfo.text || "No defect linked",
            defectUrl: defectInfo.url,
            failureCount: failureInfo.text,
            failureUrl: failureInfo.url,
            dashboardId: failureInfo.dashboardId,
            hashcode: failureInfo.hashcode,
            since: row.SINCE || "Unknown",
            lastRepro: row.REPRO || "Unknown"
          };
        });

        // Format output based on format parameter
        if (args.format === 'json') {
          return {
            content: [{ 
              type: "text" as const, 
              text: JSON.stringify({ 
                period: args.period, 
                totalBugs: rows.length,
                returnedBugs: bugs.length,
                bugs 
              }, null, 2) 
            }]
          };
        }

        if (args.format === 'summary') {
          const summary = `📋 **Bug Review Summary** (${args.period})

**Total Bugs Found:** ${rows.length}
**Showing:** ${bugs.length} bugs

**Top Issues:**
${bugs.slice(0, 10).map(bug => {
  const defectLink = toMarkdownLink(bug.defectUrl, bug.defectKey);
  const failureLink = toMarkdownLink(bug.failureUrl, `${bug.failureCount} failures`);
  return `${bug.rank}. ${defectLink} - ${failureLink}
   First seen: ${bug.since} | Last repro: ${bug.lastRepro}
   ${bug.reason.split('\n')[0].substring(0, 100)}${bug.reason.length > 100 ? '...' : ''}`;
}).join('\n\n')}

${bugs.length > 10 ? `\n*...and ${bugs.length - 10} more bugs*` : ''}`;

          return {
            content: [{ type: "text" as const, text: summary }]
          };
        }

        // Detailed format (default)
        const detailed = `🔍 **Detailed Bug Review** (${args.period})

**Total Bugs Found:** ${rows.length}
**Showing:** ${bugs.length} bugs

---

${bugs.map(bug => {
  const projectLink = toMarkdownLink(bug.projectUrl, bug.project);
  const defectLink = toMarkdownLink(bug.defectUrl, bug.defectKey);
  const failureLink = toMarkdownLink(bug.failureUrl, `View ${bug.failureCount} failures`);
  
  // Truncate reason to first 200 chars of first line for readability
  const reasonPreview = bug.reason.split('\n')[0];
  const truncatedReason = reasonPreview.length > 200 
    ? reasonPreview.substring(0, 200) + '...' 
    : reasonPreview;
  
  return `### ${bug.rank}. ${defectLink}

**Project:** ${projectLink}
**Failures:** ${failureLink}
**First Seen:** ${bug.since}
**Last Reproduced:** ${bug.lastRepro}

**Failure Reason:**
\`\`\`
${truncatedReason}
\`\`\`

${bug.hashcode ? `**Hashcode:** ${bug.hashcode}` : ''}`;
}).join('\n\n---\n\n')}`;

        return {
          content: [{ type: "text" as const, text: detailed }]
        };
      } catch (error: any) {
        debugLog("Error in get_bug_review", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting bug review: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // === Tool #2.2: Get detailed failure information by hashcode ===
  server.tool(
    "get_bug_failure_info",
    "🔬 Get comprehensive failure information including failure summary and detailed test runs (SQL widgets, templateId: 6 & 10)",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      dashboardId: z.number()
        .describe("Dashboard ID from bug review (e.g., 99)"),
      hashcode: z.string()
        .describe("Hashcode from bug review failure link (e.g., '1051677506')"),
      period: z.enum(["Last 7 Days", "Last 14 Days", "Last 30 Days", "Last 90 Days", "Week", "Month", "Quarter"])
        .default("Last 14 Days")
        .describe("Time period for failure analysis"),
      format: z.enum(['detailed', 'summary', 'json']).default('detailed')
        .describe("Output format: detailed (full info), summary (concise), or json (raw data)")
    },
    async (args) => {
      try {
        debugLog("get_bug_failure_info called", args);

        // Resolve project ID with enhanced discovery and suggestions
        const { projectId } = await resolveProjectId(args.project);

        // Build params config for both widgets
        const failureInfoParams = {
          PERIOD: args.period,
          dashboardName: "Failures analysis",
          hashcode: args.hashcode,
          isReact: true
        };

        const failureDetailsParams = {
          PERIOD: args.period,
          dashboardName: "Failures analysis",
          hashcode: args.hashcode,
          isReact: true
        };

        // Call both widgets in parallel
        const [failureInfoRaw, failureDetailsRaw] = await Promise.all([
          callWidgetSql(projectId, TEMPLATE.FAILURE_INFO, failureInfoParams),
          callWidgetSql(projectId, TEMPLATE.FAILURE_DETAILS, failureDetailsParams)
        ]);

        // Normalize returned rows
        const failureInfo: any[] = Array.isArray(failureInfoRaw) ? failureInfoRaw : [];
        const failureDetails: any[] = Array.isArray(failureDetailsRaw) ? failureDetailsRaw : [];

        if (failureInfo.length === 0 && failureDetails.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No failure information found for the specified hashcode" }]
          };
        }

        const baseUrl = WIDGET_BASE_URL;

        // Parse failure info (high-level summary)
        const summaryInfo = failureInfo.map(row => ({
          failureCount: row["#"] || "0",
          errorStability: (row["ERROR/STABILITY"] || "").replace(/\\n/g, '\n')
        }));

        // Parse failure details (individual test runs)
        const detailsInfo = failureDetails.map(row => {
          const testInfo = parseHtmlAnchor(row.TEST || "");
          const defectInfo = parseHtmlAnchor(row.DEFECT || "");
          
          return {
            runId: row.RUN_ID,
            testId: row.TEST_ID,
            runName: row.RUN || "Unknown",
            testName: testInfo.text,
            testUrl: testInfo.url,
            defectKey: defectInfo.text || "No defect",
            defectUrl: defectInfo.url
          };
        });

        // Format output based on format parameter
        if (args.format === 'json') {
          return {
            content: [{ 
              type: "text" as const, 
              text: JSON.stringify({ 
                dashboardId: args.dashboardId,
                hashcode: args.hashcode,
                period: args.period,
                summary: summaryInfo,
                totalFailures: detailsInfo.length,
                failures: detailsInfo
              }, null, 2) 
            }]
          };
        }

        if (args.format === 'summary') {
          const summary = `🔬 **Failure Analysis Summary**

**Dashboard ID:** ${args.dashboardId}
**Hashcode:** ${args.hashcode}
**Period:** ${args.period}

**Overview:**
${summaryInfo.length > 0 ? summaryInfo.map(s => `- **${s.failureCount}** failures detected
- Error: ${s.errorStability.split('\n')[0].substring(0, 150)}${s.errorStability.length > 150 ? '...' : ''}`).join('\n\n') : 'No summary available'}

**Test Runs Affected:** ${detailsInfo.length}

**Recent Failures:**
${detailsInfo.slice(0, 5).map((detail, i) => {
  const testLink = toMarkdownLink(detail.testUrl, detail.testName || `Test ${detail.testId}`);
  const defectLink = toMarkdownLink(detail.defectUrl, detail.defectKey);
  return `${i + 1}. ${testLink}
   Run: ${detail.runName} | Defect: ${defectLink}`;
}).join('\n\n')}

${detailsInfo.length > 5 ? `\n*...and ${detailsInfo.length - 5} more failures*` : ''}`;

          return {
            content: [{ type: "text" as const, text: summary }]
          };
        }

        // Detailed format (default)
        const detailed = `🔬 **Comprehensive Failure Analysis**

**Dashboard ID:** ${args.dashboardId}
**Hashcode:** ${args.hashcode}
**Period:** ${args.period}

---

## 📊 Failure Summary

${summaryInfo.length > 0 ? summaryInfo.map(s => `**Total Occurrences:** ${s.failureCount}

**Error Details:**
\`\`\`
${s.errorStability}
\`\`\``).join('\n\n') : 'No summary information available'}

---

## 🧪 Affected Test Runs (${detailsInfo.length} total)

${detailsInfo.map((detail, i) => {
  const testLink = toMarkdownLink(detail.testUrl, detail.testName || `Test ${detail.testId}`);
  const defectLink = toMarkdownLink(detail.defectUrl, detail.defectKey);
  
  return `### ${i + 1}. ${testLink}

**Run:** ${detail.runName}
**Run ID:** ${detail.runId}
**Test ID:** ${detail.testId}
**Defect:** ${defectLink}`;
}).join('\n\n')}`;

        return {
          content: [{ type: "text" as const, text: detailed }]
        };
      } catch (error: any) {
        debugLog("Error in get_bug_failure_info", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting failure info: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // === Tool #3: Get project milestones ===
  server.tool(
    "get_project_milestones",
    "🎯 Get available milestones for a project with pagination and filtering",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      page: z.number().int().positive()
        .default(1)
        .describe("Page number for pagination (1-based)"),
      pageSize: z.number().int().positive().max(100)
        .default(10)
        .describe("Number of milestones per page (max 100)"),
      status: z.enum(["incomplete", "completed", "overdue", "all"])
        .default("incomplete")
        .describe("Filter by completion status: incomplete (default, excludes overdue), completed, overdue (incomplete but past due date), or all"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data")
    },
    async (args) => {
      try {
        debugLog("get_project_milestones called", args);

        // Resolve project ID with enhanced discovery and suggestions
        const { projectId } = await resolveProjectId(args.project);

        // Convert status to API parameter - get raw data first, then filter client-side
        let completed: boolean | "all";
        if (args.status === "all") {
          completed = "all";
        } else if (args.status === "completed") {
          completed = true;
        } else {
          // For "incomplete" and "overdue", get all incomplete milestones and filter client-side
          completed = false;
        }

        const milestonesData = await reportingClient.getMilestones(projectId, {
          page: args.page,
          pageSize: args.pageSize,
          completed
        });

        // Helper function to check if a milestone is overdue
        const isOverdue = (milestone: any): boolean => {
          if (!milestone.dueDate || milestone.completed) {
            return false; // No due date or already completed = not overdue
          }

          // Get current date in user's timezone
          const now = new Date();
          const dueDate = new Date(milestone.dueDate);

          // Compare dates using UTC to avoid timezone issues (ignore time, just check if due date has passed)
          const nowDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const dueDateOnly = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));

          return dueDateOnly < nowDateOnly;
        };

        // Filter milestones based on status if needed
        let filteredItems = milestonesData.items;
        if (args.status === "incomplete") {
          // Show only incomplete milestones that are NOT overdue
          filteredItems = milestonesData.items.filter(milestone =>
            !milestone.completed && !isOverdue(milestone)
          );
        } else if (args.status === "overdue") {
          // Show only overdue milestones (incomplete but past due date)
          filteredItems = milestonesData.items.filter(milestone =>
            !milestone.completed && isOverdue(milestone)
          );
        }

        // Update the response with filtered items
        const filteredMilestonesData = {
          ...milestonesData,
          items: filteredItems,
          _meta: {
            ...milestonesData._meta,
            total: filteredItems.length // Update total to reflect filtered count
          }
        };

        if (DEBUG_MODE) {
          console.error("get_project_milestones ok", {
            projectId,
            page: args.page,
            pageSize: args.pageSize,
            status: args.status,
            totalElements: filteredMilestonesData._meta.total,
            originalTotal: milestonesData._meta.total
          });
        }

        let result;
        if (args.format === 'raw') {
          result = filteredMilestonesData;
        } else {
          // Format the data for better readability
          const milestones = filteredMilestonesData.items.map(milestone => {
            const isOverdueFlag = !milestone.completed && milestone.dueDate &&
              new Date(milestone.dueDate) < new Date();

            return {
              name: milestone.name,
              completed: milestone.completed,
              overdue: isOverdueFlag,
              description: milestone.description,
              startDate: milestone.startDate,
              dueDate: milestone.dueDate,
              id: milestone.id
            };
          });

          result = {
            summary: {
              project: args.project,
              status: args.status,
              page: args.page,
              pageSize: args.pageSize,
              totalElements: filteredMilestonesData._meta.total,
              totalPages: Math.ceil(filteredMilestonesData._meta.total / args.pageSize),
              filteredFrom: milestonesData._meta.total
            },
            milestones: milestones
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error: any) {
        debugLog("Error in get_project_milestones", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting project milestones: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // === Tool #4: Get available projects ===
  server.tool(
    "get_available_projects",
    "🏗️ Discover available projects with their keys and IDs for dynamic project selection",
    {
      starred: z.boolean().optional()
        .describe("Filter by starred projects (true=only starred, false=only non-starred, undefined=all)"),
      publiclyAccessible: z.boolean().optional()
        .describe("Filter by public accessibility (true=only public, false=only private, undefined=all)"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data"),
      includePaginationInfo: z.boolean().default(false)
        .describe("Include pagination metadata from projects-limit endpoint")
    },
    async (args) => {
      try {
        debugLog("get_available_projects called", args);

        // Get projects data
        const projectsData = await reportingClient.getAvailableProjects({
          starred: args.starred,
          publiclyAccessible: args.publiclyAccessible
        });

        // Optionally get pagination info
        let paginationInfo = null;
        if (args.includePaginationInfo) {
          try {
            paginationInfo = await reportingClient.getProjectsLimit();
          } catch (error) {
            debugLog("Failed to get pagination info", error);
            // Continue without pagination info if it fails
          }
        }

        if (DEBUG_MODE) {
          console.error("get_available_projects ok", {
            totalProjects: projectsData.items.length,
            starred: args.starred,
            publiclyAccessible: args.publiclyAccessible,
            paginationInfo: paginationInfo?.data
          });
        }

        let result;
        if (args.format === 'raw') {
          result = {
            projects: projectsData,
            ...(paginationInfo && { pagination: paginationInfo })
          };
        } else {
          // Format the data for better readability
          const projects = projectsData.items.map(project => ({
            name: project.name,
            key: project.key,
            id: project.id,
            starred: project.starred,
            publiclyAccessible: project.publiclyAccessible,
            logoUrl: project.logoUrl,
            createdAt: project.createdAt,
            leadId: project.leadId
          }));

          // Create helpful mapping for users
          const keyToIdMapping = projectsData.items.reduce((acc, project) => {
            acc[project.key] = project.id;
            return acc;
          }, {} as Record<string, number>);

          result = {
            summary: {
              totalProjects: projectsData.items.length,
              starred: args.starred,
              publiclyAccessible: args.publiclyAccessible,
              ...(paginationInfo && {
                systemLimit: paginationInfo.data.limit,
                systemTotal: paginationInfo.data.currentTotal
              })
            },
            projects: projects,
            keyToIdMapping: keyToIdMapping,
            usage: {
              note: "Use 'key' field for project parameter in other tools",
              examples: [
                "project: \"android\" (for Android app)",
                "project: \"ios\" (for iOS app)",
                "project: \"web\" (for Web app)"
              ]
            }
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error: any) {
        debugLog("Error in get_available_projects", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting available projects: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== TEST CASE VALIDATION TOOL ==========

  server.tool(
    "validate_test_case",
    "🔍 Validate a test case against quality standards and best practices (Dynamic Rules Support + Improvement)",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      caseKey: z.string().min(1).describe("Test case key (e.g., 'ANDROID-29')"),
      rulesFilePath: z.string().optional().describe("Path to custom rules markdown file"),
      checkpointsFilePath: z.string().optional().describe("Path to custom checkpoints markdown file"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      improveIfPossible: z.boolean().default(true).describe("Attempt to automatically improve the test case"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      try {
        debugLog("validate_test_case called", args);

        // Import handlers here to avoid circular dependencies
        const { ZebrunnerToolHandlers } = await import("./handlers/tools.js");
        // Create a basic client instance for validation since enhanced client has different interface
        const { ZebrunnerApiClient } = await import("./api/client.js");
        const basicClient = new ZebrunnerApiClient(config);
        const toolHandlers = new ZebrunnerToolHandlers(basicClient);

        return await toolHandlers.validateTestCase(args);
      } catch (error: any) {
        debugLog("Error in validate_test_case", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error validating test case: ${error?.message || error}`
          }]
        };
      }
    }
  );

  server.tool(
    "improve_test_case",
    "🔧 Analyze and improve a test case with detailed suggestions and optional automatic fixes",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      caseKey: z.string().min(1).describe("Test case key (e.g., 'ANDROID-29')"),
      rulesFilePath: z.string().optional().describe("Path to custom rules markdown file"),
      checkpointsFilePath: z.string().optional().describe("Path to custom checkpoints markdown file"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      applyHighConfidenceChanges: z.boolean().default(true).describe("Automatically apply high-confidence improvements"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    },
    async (args) => {
      try {
        debugLog("improve_test_case called", args);

        // Import handlers here to avoid circular dependencies
        const { ZebrunnerToolHandlers } = await import("./handlers/tools.js");
        // Create a basic client instance for improvement since enhanced client has different interface
        const { ZebrunnerApiClient } = await import("./api/client.js");
        const basicClient = new ZebrunnerApiClient(config);
        const toolHandlers = new ZebrunnerToolHandlers(basicClient);

        return await toolHandlers.improveTestCase(args);
      } catch (error: any) {
        debugLog("Error in improve_test_case", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error improving test case: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== PUBLIC API TEST RUN TOOLS ==========

  server.tool(
    "list_test_runs",
    "🏃 List Test Runs from Public API with advanced filtering",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      pageToken: z.string().optional()
        .describe("Token for pagination (from previous response)"),
      maxPageSize: z.number().int().positive().max(100)
        .default(10)
        .describe("Number of test runs per page (max 100)"),
      nameFilter: z.string().optional()
        .describe("Filter by test run name (partial match)"),
      milestoneFilter: z.union([z.string(), z.number()]).optional()
        .describe("Filter by milestone ID (use get_project_milestones to find ID) or milestone name (will be converted to ID)"),
      buildNumberFilter: z.string().optional()
        .describe("Filter by build number (searches in configurations, title, and description)"),
      closedFilter: z.boolean().optional()
        .describe("Filter by closed status (true=closed, false=open)"),
      sortBy: z.enum(["-createdAt", "createdAt", "-title", "title"])
        .default("-createdAt")
        .describe("Sort order: -createdAt (newest first), createdAt (oldest first), -title (Z-A), title (A-Z)"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data")
    },
    async (args) => {
      try {
        debugLog("list_test_runs called", args);

        // Resolve project using dynamic resolution (same as Reporting API tools)
        const { projectId, suggestions } = await resolveProjectId(args.project);

        // For Public API, we need the project key, not the project ID
        // First check if it's a known alias, otherwise treat as direct project key
        const projectKey = typeof args.project === 'string'
          ? (PROJECT_ALIASES[args.project] || args.project)
          : undefined;

        if (!projectKey || projectKey.length === 0) {
          throw new Error(`Invalid project: ${args.project}. Use aliases like 'android', 'ios', 'web', 'api' or direct project keys.`);
        }

        // Build filter expression using Resource Query Language
        const filters: string[] = [];

        if (args.nameFilter) {
          filters.push(`title ~= '${args.nameFilter.replace(/'/g, "\\'")}'`);
        }

        // Handle milestone filtering - need to convert name to ID if necessary
        if (args.milestoneFilter !== undefined) {
          let milestoneId: number;

          if (typeof args.milestoneFilter === 'number') {
            // Already an ID
            milestoneId = args.milestoneFilter;
          } else {
            // It's a name, need to look up the ID
            try {
              const milestonesData = await reportingClient.getMilestones(projectId, {
                page: 1,
                pageSize: 100,
                completed: 'all' // Get all milestones to find the one we need
              });

              const milestone = milestonesData.items.find((m: any) => m.name === args.milestoneFilter);
              if (!milestone) {
                throw new Error(`Milestone '${args.milestoneFilter}' not found. Use get_project_milestones to see available milestones.`);
              }
              milestoneId = milestone.id;
            } catch (error: any) {
              throw new Error(`Failed to lookup milestone '${args.milestoneFilter}': ${error.message}`);
            }
          }

          filters.push(`milestone.id = ${milestoneId}`);
        }

        if (args.buildNumberFilter) {
          // Search in configurations.optionName for build numbers (this is where build info is typically stored)
          // Also search in title and description as fallback
          filters.push(`(configurations.optionName ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}' OR title ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}' OR description ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}')`);
        }

        if (args.closedFilter !== undefined) {
          filters.push(`closed = ${args.closedFilter}`);
        }

        const filter = filters.length > 0 ? filters.join(' AND ') : undefined;

        const testRunsData = await client.listPublicTestRuns({
          projectKey,
          pageToken: args.pageToken,
          maxPageSize: args.maxPageSize,
          filter,
          sortBy: args.sortBy
        });

        let result: any;
        if (args.format === 'raw') {
          result = testRunsData;
        } else {
          // Formatted output
          const testRuns = testRunsData.items.map((run: any) => ({
            id: run.id,
            title: run.title,
            description: run.description,
            milestone: run.milestone ? {
              id: run.milestone.id,
              name: run.milestone.name,
              completed: run.milestone.completed,
              dueDate: run.milestone.dueDate
            } : null,
            environment: run.environment ? {
              key: run.environment.key,
              name: run.environment.name
            } : null,
            configurations: run.configurations.map((config: any) => `${config.group.name}: ${config.option.name}`),
            requirements: run.requirements.map((req: any) => `${req.source}: ${req.reference}`),
            closed: run.closed,
            createdBy: `${run.createdBy.username} (${run.createdBy.email})`,
            createdAt: run.createdAt,
            testCasesSummary: run.executionSummaries.map((summary: any) =>
              `${summary.status.name}: ${summary.testCasesCount}`
            ).join(', ') || 'No test cases'
          }));

          result = {
            summary: {
              totalTestRuns: testRuns.length,
              projectKey,
              filters: {
                name: args.nameFilter,
                milestone: args.milestoneFilter,
                buildNumber: args.buildNumberFilter,
                closed: args.closedFilter
              },
              sorting: args.sortBy,
              hasNextPage: !!testRunsData._meta?.nextPageToken
            },
            testRuns,
            pagination: testRunsData._meta?.nextPageToken ? {
              nextPageToken: testRunsData._meta.nextPageToken,
              usage: "Use this token in the 'pageToken' parameter for the next page"
            } : null
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error: any) {
        debugLog("Error in list_test_runs", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error listing test runs: ${error?.message || error}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_run_by_id",
    "🔍 Get detailed Test Run information by ID from Public API",
    {
      id: z.number().int().positive()
        .describe("Test Run ID"),
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data")
    },
    async (args) => {
      try {
        debugLog("get_test_run_by_id called", args);

        // Resolve project using dynamic resolution (same as Reporting API tools)
        const { projectId, suggestions } = await resolveProjectId(args.project);

        // For Public API, we need the project key, not the project ID
        // First check if it's a known alias, otherwise treat as direct project key
        const projectKey = typeof args.project === 'string'
          ? (PROJECT_ALIASES[args.project] || args.project)
          : undefined;

        if (!projectKey || projectKey.length === 0) {
          throw new Error(`Invalid project: ${args.project}. Use aliases like 'android', 'ios', 'web', 'api' or direct project keys.`);
        }

        const testRunData = await client.getPublicTestRunById({
          id: args.id,
          projectKey
        });

        let result: any;
        if (args.format === 'raw') {
          result = testRunData;
        } else {
          // Formatted output
          const run = testRunData.data;
          result = {
            testRun: {
              id: run.id,
              title: run.title,
              description: run.description,
              milestone: run.milestone ? {
                id: run.milestone.id,
                name: run.milestone.name,
                completed: run.milestone.completed,
                description: run.milestone.description,
                startDate: run.milestone.startDate,
                dueDate: run.milestone.dueDate
              } : null,
              environment: run.environment ? {
                id: run.environment.id,
                key: run.environment.key,
                name: run.environment.name
              } : null,
              configurations: run.configurations.map((config: any) => ({
                group: config.group.name,
                option: config.option.name,
                display: `${config.group.name}: ${config.option.name}`
              })),
              requirements: run.requirements.map((req: any) => ({
                source: req.source,
                reference: req.reference,
                display: `${req.source}: ${req.reference}`
              })),
              status: {
                closed: run.closed,
                createdBy: {
                  id: run.createdBy.id,
                  username: run.createdBy.username,
                  email: run.createdBy.email,
                  display: `${run.createdBy.username} (${run.createdBy.email})`
                },
                createdAt: run.createdAt
              },
              executionSummary: {
                totalStatuses: run.executionSummaries.length,
                details: run.executionSummaries.map((summary: any) => ({
                  status: summary.status.name,
                  count: summary.testCasesCount,
                  color: summary.status.colorHex,
                  display: `${summary.status.name}: ${summary.testCasesCount} test cases`
                })),
                totalTestCases: run.executionSummaries.reduce((sum: any, summary: any) => sum + summary.testCasesCount, 0)
              }
            },
            projectKey,
            note: "Use 'list_test_run_test_cases' tool to get the test cases for this test run"
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error: any) {
        debugLog("Error in get_test_run_by_id", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting test run: ${error?.message || error}`
          }]
        };
      }
    }
  );

  server.tool(
    "list_test_run_test_cases",
    "📝 List all Test Cases in a Test Run from Public API",
    {
      testRunId: z.number().int().positive()
        .describe("Test Run ID"),
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data")
    },
    async (args) => {
      try {
        debugLog("list_test_run_test_cases called", args);

        // Resolve project using dynamic resolution (same as Reporting API tools)
        const { projectId, suggestions } = await resolveProjectId(args.project);

        // For Public API, we need the project key, not the project ID
        // First check if it's a known alias, otherwise treat as direct project key
        const projectKey = typeof args.project === 'string'
          ? (PROJECT_ALIASES[args.project] || args.project)
          : undefined;

        if (!projectKey || projectKey.length === 0) {
          throw new Error(`Invalid project: ${args.project}. Use aliases like 'android', 'ios', 'web', 'api' or direct project keys.`);
        }

        const testCasesData = await client.listPublicTestRunTestCases({
          testRunId: args.testRunId,
          projectKey
        });

        let result: any;
        if (args.format === 'raw') {
          result = testCasesData;
        } else {
          // Formatted output
          const testCases = testCasesData.items.map((item: any) => ({
            testCase: {
              id: item.testCase.id,
              key: item.testCase.key,
              title: item.testCase.title
            },
            assignee: item.assignee ? {
              id: item.assignee.id,
              username: item.assignee.username,
              email: item.assignee.email,
              display: `${item.assignee.username} (${item.assignee.email})`
            } : null,
            result: item.result ? {
              status: {
                id: item.result.status.id,
                name: item.result.status.name,
                aliases: item.result.status.aliases
              },
              details: item.result.details,
              issue: item.result.issue ? {
                type: item.result.issue.type,
                id: item.result.issue.id,
                display: `${item.result.issue.type}: ${item.result.issue.id}`
              } : null,
              executionTime: item.result.executionTimeInMillis ?
                `${item.result.executionTimeInMillis}ms` : null,
              executionType: item.result.executionType,
              attachments: item.result.attachments.length
            } : null
          }));

          // Group by status for summary
          const statusSummary = testCases.reduce((acc: any, tc: any) => {
            const status = tc.result?.status.name || 'No Result';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          result = {
            summary: {
              testRunId: args.testRunId,
              totalTestCases: testCases.length,
              projectKey,
              statusBreakdown: statusSummary,
              withResults: testCases.filter((tc: any) => tc.result).length,
              withAssignees: testCases.filter((tc: any) => tc.assignee).length
            },
            testCases,
            note: "Test cases are returned without pagination as per Public API specification"
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }]
        };
      } catch (error: any) {
        debugLog("Error in list_test_run_test_cases", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error listing test run test cases: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== TEST RUN SETTINGS TOOLS ==========

  server.tool(
    "get_test_run_result_statuses",
    "Get list of Result Statuses configured for a project. These statuses are used when assigning results to Test Cases.",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(["raw", "formatted"]).default("formatted").describe("Output format")
    },
    async (args) => {
      debugLog("get_test_run_result_statuses called", args);

      try {
        // Resolve project using dynamic resolution (same as other tools)
        const { projectId, suggestions } = await resolveProjectId(args.project);

        // For Public API, we need the project key, not the project ID
        const projectKey = typeof args.project === 'string' && args.project.length > 3
          ? args.project
          : PROJECT_ALIASES[args.project as keyof typeof PROJECT_ALIASES];

        if (!projectKey) {
          throw new Error(`Invalid project: ${args.project}. ${suggestions || 'Use web, android, ios, api, or a valid project key.'}`);
        }

        const publicClient = new EnhancedZebrunnerClient(config);
        const response = await publicClient.listResultStatuses({ projectKey });

        if (args.format === "raw") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }]
          };
        }

        // Formatted output
        const statuses = response.items;
        let result = `📊 **Result Statuses for Project ${projectKey}**\n\n`;

        if (statuses.length === 0) {
          result += "No result statuses found.\n";
        } else {
          result += `Found ${statuses.length} result status${statuses.length === 1 ? '' : 'es'}:\n\n`;

          statuses.forEach((status: any) => {
            result += `**${status.name}** (ID: ${status.id})\n`;
            if (status.aliases) {
              result += `  • Aliases: ${status.aliases}\n`;
            }
            result += `  • Color: ${status.colorHex}\n`;
            result += `  • Enabled: ${status.enabled ? '✅' : '❌'}\n`;
            result += `  • Completed: ${status.isCompleted ? '✅' : '❌'}\n`;
            result += `  • Success: ${status.isSuccess ? '✅' : '❌'}\n`;
            result += `  • Failure: ${status.isFailure ? '✅' : '❌'}\n`;
            result += `  • Assignable: ${status.isAssignable ? '✅' : '❌'}\n\n`;
          });
        }

        return {
          content: [{ type: "text" as const, text: result }]
        };
      } catch (error: any) {
        debugLog("Error in get_test_run_result_statuses", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting result statuses: ${error?.message || error}`
          }]
        };
      }
    }
  );

  server.tool(
    "get_test_run_configuration_groups",
    "Get list of Configuration Groups and their Options for a project. These are used to configure Test Runs.",
    {
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(["raw", "formatted"]).default("formatted").describe("Output format")
    },
    async (args) => {
      debugLog("get_test_run_configuration_groups called", args);

      try {
        // Resolve project using dynamic resolution (same as other tools)
        const { projectId, suggestions } = await resolveProjectId(args.project);

        // For Public API, we need the project key, not the project ID
        const projectKey = typeof args.project === 'string' && args.project.length > 3
          ? args.project
          : PROJECT_ALIASES[args.project as keyof typeof PROJECT_ALIASES];

        if (!projectKey) {
          throw new Error(`Invalid project: ${args.project}. ${suggestions || 'Use web, android, ios, api, or a valid project key.'}`);
        }

        const publicClient = new EnhancedZebrunnerClient(config);
        const response = await publicClient.listConfigurationGroups({ projectKey });

        if (args.format === "raw") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }]
          };
        }

        // Formatted output
        const groups = response.items;
        let result = `⚙️ **Configuration Groups for Project ${projectKey}**\n\n`;

        if (groups.length === 0) {
          result += "No configuration groups found.\n";
        } else {
          result += `Found ${groups.length} configuration group${groups.length === 1 ? '' : 's'}:\n\n`;

          groups.forEach((group: any) => {
            result += `**${group.name}** (ID: ${group.id})\n`;
            if (group.options && group.options.length > 0) {
              result += `  Options (${group.options.length}):\n`;
              group.options.forEach((option: any) => {
                result += `    • ${option.name} (ID: ${option.id})\n`;
              });
            } else {
              result += `  No options available\n`;
            }
            result += `\n`;
          });
        }

        return {
          content: [{ type: "text" as const, text: result }]
        };
      } catch (error: any) {
        debugLog("Error in get_test_run_configuration_groups", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error getting configuration groups: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== DUPLICATE ANALYSIS TOOL ==========

  server.tool(
    "analyze_test_cases_duplicates",
    "🔍 Analyze test cases for duplicates and group similar ones by step similarity (80-90%)",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'ANDROID', 'IOS')"),
      suite_id: z.number().optional().describe("Optional: Analyze specific test suite ID"),
      test_case_keys: z.array(z.string()).optional().describe("Optional: Analyze specific test case keys instead of suite"),
      similarity_threshold: z.number().min(50).max(100).default(80).describe("Similarity threshold percentage (50-100, default: 80)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      include_similarity_matrix: z.boolean().default(false).describe("Include detailed similarity matrix in output"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI (markdown format only)")
    },
    async (args) => {
      try {
        const { project_key, suite_id, test_case_keys, similarity_threshold, format, include_similarity_matrix, include_clickable_links } = args;

        debugLog("analyze_test_cases_duplicates called", { args });

        // Import the analyzer
        const { TestCaseDuplicateAnalyzer } = await import('./utils/duplicate-analyzer.js');
        const analyzer = new TestCaseDuplicateAnalyzer(similarity_threshold);

        let testCases: ZebrunnerTestCase[] = [];

        // Get test cases either from suite or specific keys
        if (test_case_keys && test_case_keys.length > 0) {
          // Get specific test cases by keys
          debugLog("Getting test cases by keys", { keys: test_case_keys });

          for (const caseKey of test_case_keys) {
            try {
              const testCase = await client.getTestCaseByKey(project_key, caseKey, {
                includeSuiteHierarchy: false
              });
              if (testCase) {
                testCases.push(testCase);
              }
            } catch (error) {
              debugLog(`Failed to get test case ${caseKey}`, { error });
            }
          }
        } else if (suite_id) {
          // Get test cases from specific suite (including child suites for root suites)
          debugLog("Getting test cases from suite using hierarchy-aware method", { suite_id });

          try {
            // Use getAllTCMTestCasesBySuiteId which handles root suite hierarchies
            const shortTestCases = await client.getAllTCMTestCasesBySuiteId(project_key, suite_id, true); // basedOnRootSuites = true

            if (shortTestCases && shortTestCases.length > 0) {
              // Fetch detailed test cases with steps
              const detailedTestCases: ZebrunnerTestCase[] = [];
              for (const testCase of shortTestCases) {
                try {
                  const detailed = await client.getTestCaseByKey(project_key, testCase.key || `tc-${testCase.id}`, {
                    includeSuiteHierarchy: false
                  });
                  if (detailed) {
                    detailedTestCases.push(detailed);
                  }
                } catch (error) {
                  debugLog(`Failed to get detailed test case ${testCase.key}`, { error });
                }
              }
              testCases = detailedTestCases;
            }
          } catch (error) {
            debugLog("Failed to get test cases from suite", { error });
            return {
              content: [{
                type: "text" as const,
                text: `❌ Error getting test cases from suite ${suite_id}: ${error}`
              }]
            };
          }
        } else {
          // Get all test cases from project
          debugLog("Getting all test cases from project", { project_key });

          try {
            const response = await client.getTestCases(project_key, {
              page: 0,
              size: 1000 // Large size to get many cases
            });

            if (response?.items) {
              // Fetch detailed test cases with steps (limit to first 50 for performance)
              const detailedTestCases: ZebrunnerTestCase[] = [];
              const limitedItems = response.items.slice(0, 50); // Limit for performance

              for (const testCase of limitedItems) {
                try {
                  const detailed = await client.getTestCaseByKey(project_key, testCase.key || `tc-${testCase.id}`, {
                    includeSuiteHierarchy: false
                  });
                  if (detailed) {
                    detailedTestCases.push(detailed);
                  }
                } catch (error) {
                  debugLog(`Failed to get detailed test case ${testCase.key}`, { error });
                }
              }
              testCases = detailedTestCases;
            }
          } catch (error) {
            debugLog("Failed to get test cases from project", { error });
            return {
              content: [{
                type: "text" as const,
                text: `❌ Error getting test cases from project ${project_key}: ${error}`
              }]
            };
          }
        }

        if (testCases.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "❌ No test cases found to analyze"
            }]
          };
        }

        if (testCases.length < 2) {
          return {
            content: [{
              type: "text" as const,
              text: "❌ Need at least 2 test cases to analyze for duplicates"
            }]
          };
        }

        debugLog(`Analyzing ${testCases.length} test cases for duplicates`);

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Perform duplicate analysis
        const result = analyzer.analyzeDuplicates(testCases, project_key, suite_id);

        debugLog("Duplicate analysis completed", {
          clustersFound: result.clustersFound,
          duplicateTestCases: result.potentialSavings.duplicateTestCases
        });

        // Format output
        if (format === 'dto' || format === 'json') {
          // Add webUrl fields to test cases if clickable links are enabled
          const enhancedResult = {
            ...result,
            clusters: result.clusters.map((cluster: any) => ({
              ...cluster,
              testCases: cluster.testCases.map((tc: any) =>
                addTestCaseWebUrl(tc, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
              )
            }))
          };

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(enhancedResult, null, 2)
            }]
          };
        }

        if (format === 'string') {
          let output = `Duplicate Analysis Results\n`;
          output += `Project: ${result.projectKey}\n`;
          if (result.suiteId) output += `Suite ID: ${result.suiteId}\n`;
          output += `Total Test Cases: ${result.totalTestCases}\n`;
          output += `Clusters Found: ${result.clustersFound}\n`;
          output += `Potential Savings: ${result.potentialSavings.duplicateTestCases} duplicates (${result.potentialSavings.estimatedTimeReduction})\n\n`;

          result.clusters.forEach((cluster: any, index: number) => {
            output += `Cluster ${index + 1} (${cluster.averageSimilarity}% similarity):\n`;
            cluster.testCases.forEach((tc: any) => {
              const testCaseDisplay = generateTestCaseLink(project_key, tc.key, tc.id, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
              output += `  - ${testCaseDisplay}: ${tc.title} [${tc.automationState}]\n`;
            });
            output += `  Shared Logic: ${cluster.sharedLogicSummary}\n`;
            const baseTestCaseDisplay = generateTestCaseLink(project_key, cluster.recommendedBase.testCaseKey, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
            output += `  Recommended Base: ${baseTestCaseDisplay} (${cluster.recommendedBase.reason})\n`;
            output += `  Strategy: ${cluster.mergingStrategy}\n\n`;
          });

          return {
            content: [{
              type: "text" as const,
              text: output
            }]
          };
        }

        // Markdown format (default)
        let markdown = `# 🔍 Test Case Duplicate Analysis\n\n`;
        markdown += `**Project:** ${result.projectKey}\n`;
        if (result.suiteId) markdown += `**Suite ID:** ${result.suiteId}\n`;
        markdown += `**Total Test Cases Analyzed:** ${result.totalTestCases}\n`;
        markdown += `**Similarity Threshold:** ${similarity_threshold}%\n\n`;

        markdown += `## 📊 Summary\n\n`;
        markdown += `- **Clusters Found:** ${result.clustersFound}\n`;
        markdown += `- **Duplicate Test Cases:** ${result.potentialSavings.duplicateTestCases}\n`;
        markdown += `- **Estimated Time Reduction:** ${result.potentialSavings.estimatedTimeReduction}\n\n`;

        if (result.clustersFound === 0) {
          markdown += `✅ **No duplicates found** above ${similarity_threshold}% similarity threshold.\n\n`;
          markdown += `Consider lowering the threshold or checking if test cases have detailed steps.\n`;
        } else {
          markdown += `## 🗂️ Duplicate Clusters\n\n`;

          result.clusters.forEach((cluster: any, index: number) => {
            markdown += `### Cluster ${index + 1}: ${cluster.averageSimilarity}% Average Similarity\n\n`;

            // Test cases table
            markdown += `| Test Case | Title | Automation | Steps |\n`;
            markdown += `|-----------|-------|------------|-------|\n`;
            cluster.testCases.forEach((tc: any) => {
              const testCaseDisplay = generateTestCaseLink(project_key, tc.key, tc.id, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
              markdown += `| **${testCaseDisplay}** | ${tc.title} | ${tc.automationState} | ${tc.stepCount} |\n`;
            });
            markdown += `\n`;

            // Automation mix
            const { manual, automated, mixed } = cluster.automationMix;
            markdown += `**Automation Mix:** `;
            if (automated > 0) markdown += `${automated} Automated `;
            if (manual > 0) markdown += `${manual} Manual `;
            if (mixed > 0) markdown += `${mixed} Mixed `;
            markdown += `\n\n`;

            // Shared logic
            if (cluster.sharedLogicSummary) {
              markdown += `**Shared Steps:**\n`;
              const steps = cluster.sharedLogicSummary.split('; ');
              steps.slice(0, 3).forEach((step: string) => {
                markdown += `- ${step}\n`;
              });
              if (steps.length > 3) {
                markdown += `- *(${steps.length - 3} more similar steps...)*\n`;
              }
              markdown += `\n`;
            }

            // Recommendations
            markdown += `**💡 Recommendations:**\n`;
            const baseTestCaseDisplay = generateTestCaseLink(project_key, cluster.recommendedBase.testCaseKey, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
            markdown += `- **Base Test Case:** ${baseTestCaseDisplay}\n`;
            markdown += `- **Reason:** ${cluster.recommendedBase.reason}\n`;
            markdown += `- **Strategy:** ${cluster.mergingStrategy}\n\n`;

            markdown += `---\n\n`;
          });

          // Include similarity matrix if requested
          if (include_similarity_matrix && result.similarityMatrix && result.similarityMatrix.length > 0) {
            markdown += `## 📈 Similarity Matrix\n\n`;
            markdown += `| Test Case 1 | Test Case 2 | Similarity | Pattern Type | Shared Steps | Summary |\n`;
            markdown += `|-------------|-------------|------------|--------------|--------------|----------|\n`;

            result.similarityMatrix.slice(0, 20).forEach((sim: any) => { // Limit to top 20
              const summary = sim.sharedStepsSummary.slice(0, 2).join(', ');
              const patternType = sim.patternType || 'other';
              const patternEmoji = patternType === 'user_type' ? '👤' :
                                 patternType === 'theme' ? '🎨' :
                                 patternType === 'entry_point' ? '🚪' :
                                 patternType === 'component' ? '🧩' :
                                 patternType === 'permission' ? '🔐' : '❓';
              const testCase1Display = generateTestCaseLink(project_key, sim.testCase1Key, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
              const testCase2Display = generateTestCaseLink(project_key, sim.testCase2Key, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
              markdown += `| ${testCase1Display} | ${testCase2Display} | ${sim.similarityPercentage}% | ${patternEmoji} ${patternType} | ${sim.sharedSteps}/${Math.max(sim.totalSteps1, sim.totalSteps2)} | ${summary} |\n`;
            });

            if (result.similarityMatrix.length > 20) {
              markdown += `\n*Showing top 20 similarities out of ${result.similarityMatrix.length} total pairs*\n`;
            }
            markdown += `\n`;
          }
        }

        markdown += `## 🎯 Next Steps\n\n`;
        if (result.clustersFound > 0) {
          markdown += `1. **Review each cluster** to confirm similarity assessment\n`;
          markdown += `2. **Choose base test cases** from recommendations\n`;
          markdown += `3. **Implement parameterization** for automated tests\n`;
          markdown += `4. **Retire duplicate test cases** after validation\n`;
          markdown += `5. **Update test execution plans** to reflect changes\n\n`;
        } else {
          markdown += `1. **Consider lowering similarity threshold** (try 60-70%)\n`;
          markdown += `2. **Ensure test cases have detailed steps** for better analysis\n`;
          markdown += `3. **Review test case titles** for potential duplicates\n\n`;
        }

        markdown += `*Analysis completed with ${similarity_threshold}% similarity threshold*\n`;

        return {
          content: [{
            type: "text" as const,
            text: markdown
          }]
        };

      } catch (error: any) {
        debugLog("Error in analyze_test_cases_duplicates", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error analyzing test case duplicates: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== SEMANTIC DUPLICATE ANALYSIS TOOL ==========

  server.tool(
    "analyze_test_cases_duplicates_semantic",
    "🧠 Advanced semantic duplicate analysis using LLM-powered step clustering and two-phase analysis",
    {
      project_key: z.string().min(1).describe("Project key (e.g., 'ANDROID', 'IOS')"),
      suite_id: z.number().optional().describe("Optional: Analyze specific test suite ID"),
      test_case_keys: z.array(z.string()).optional().describe("Optional: Analyze specific test case keys instead of suite"),
      similarity_threshold: z.number().min(50).max(100).default(80).describe("Test case similarity threshold percentage (50-100, default: 80)"),
      step_clustering_threshold: z.number().min(50).max(100).default(85).describe("Step clustering threshold percentage (50-100, default: 85)"),
      analysis_mode: z.enum(['basic', 'semantic', 'hybrid']).default('hybrid').describe("Analysis mode: basic (fast), semantic (LLM-powered), hybrid (both)"),
      use_step_clustering: z.boolean().default(true).describe("Enable two-phase clustering (step clusters first, then test case clusters)"),
      use_medoid_selection: z.boolean().default(true).describe("Use medoid-based representative selection instead of heuristic"),
      include_semantic_insights: z.boolean().default(true).describe("Generate semantic insights about workflows and patterns"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      include_similarity_matrix: z.boolean().default(false).describe("Include detailed similarity matrix in output"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI (markdown format only)")
    },
    async (args) => {
      try {
        const {
          project_key,
          suite_id,
          test_case_keys,
          similarity_threshold,
          step_clustering_threshold,
          analysis_mode,
          use_step_clustering,
          use_medoid_selection,
          include_semantic_insights,
          format,
          include_similarity_matrix,
          include_clickable_links
        } = args;

        debugLog("analyze_test_cases_duplicates_semantic called", { args });

        // Import the semantic analyzer
        const { SemanticDuplicateAnalyzer } = await import('./utils/semantic-duplicate-analyzer.js');

        const options = {
          stepClusteringThreshold: step_clustering_threshold / 100,
          testCaseClusteringThreshold: similarity_threshold / 100,
          useStepClustering: use_step_clustering,
          useMedoidSelection: use_medoid_selection,
          includeSemanticPatterns: include_semantic_insights
        };

        const analyzer = new SemanticDuplicateAnalyzer(similarity_threshold, options);

        let testCases: ZebrunnerTestCase[] = [];

        // Get test cases (same logic as basic analyzer)
        if (test_case_keys && test_case_keys.length > 0) {
          debugLog("Getting test cases by keys", { keys: test_case_keys });

          for (const caseKey of test_case_keys) {
            try {
              const testCase = await client.getTestCaseByKey(project_key, caseKey, {
                includeSuiteHierarchy: false
              });
              if (testCase) {
                testCases.push(testCase);
              }
            } catch (error) {
              debugLog(`Failed to get test case ${caseKey}`, { error });
            }
          }
        } else if (suite_id) {
          // Get test cases from specific suite (including child suites for root suites)
          debugLog("Getting test cases from suite using hierarchy-aware method", { suite_id });

          try {
            // Use getAllTCMTestCasesBySuiteId which handles root suite hierarchies
            const shortTestCases = await client.getAllTCMTestCasesBySuiteId(project_key, suite_id, true); // basedOnRootSuites = true

            if (shortTestCases && shortTestCases.length > 0) {
              // Fetch detailed test cases with steps
              const detailedTestCases: ZebrunnerTestCase[] = [];
              for (const testCase of shortTestCases) {
                try {
                  const detailed = await client.getTestCaseByKey(project_key, testCase.key || `tc-${testCase.id}`, {
                    includeSuiteHierarchy: false
                  });
                  if (detailed) {
                    detailedTestCases.push(detailed);
                  }
                } catch (error) {
                  debugLog(`Failed to get detailed test case ${testCase.key}`, { error });
                }
              }
              testCases = detailedTestCases;
            }
          } catch (error) {
            debugLog("Failed to get test cases from suite", { error });
            return {
              content: [{
                type: "text" as const,
                text: `❌ Error getting test cases from suite ${suite_id}: ${error}`
              }]
            };
          }
        } else {
          debugLog("Getting all test cases from project", { project_key });

          try {
            const response = await client.getTestCases(project_key, {
              page: 0,
              size: 1000
            });

            if (response?.items) {
              const detailedTestCases: ZebrunnerTestCase[] = [];
              const limitedItems = response.items.slice(0, 50); // Limit for performance

              for (const testCase of limitedItems) {
                try {
                  const detailed = await client.getTestCaseByKey(project_key, testCase.key || `tc-${testCase.id}`, {
                    includeSuiteHierarchy: false
                  });
                  if (detailed) {
                    detailedTestCases.push(detailed);
                  }
                } catch (error) {
                  debugLog(`Failed to get detailed test case ${testCase.key}`, { error });
                }
              }
              testCases = detailedTestCases;
            }
          } catch (error) {
            debugLog("Failed to get test cases from project", { error });
            return {
              content: [{
                type: "text" as const,
                text: `❌ Error getting test cases from project ${project_key}: ${error}`
              }]
            };
          }
        }

        if (testCases.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "❌ No test cases found to analyze"
            }]
          };
        }

        if (testCases.length < 2) {
          return {
            content: [{
              type: "text" as const,
              text: "❌ Need at least 2 test cases to analyze for duplicates"
            }]
          };
        }

        debugLog(`Analyzing ${testCases.length} test cases with semantic analysis`);

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Create LLM analysis function if semantic mode is enabled
        let llmAnalysisFunction: ((prompt: string) => Promise<string>) | undefined;

        if (analysis_mode === 'semantic' || analysis_mode === 'hybrid') {
          // Note: In a real MCP environment, this would be provided by the host (Claude)
          // For now, we'll use a placeholder that indicates LLM analysis is requested
          llmAnalysisFunction = async (prompt: string) => {
            // This is a placeholder - in actual use, the MCP host (Claude) would process this
            throw new Error("LLM analysis requires host support - please use this tool in Claude Desktop/Code for full semantic analysis");
          };
        }

        // Perform semantic analysis
        const result = await analyzer.analyzeSemanticDuplicates(
          testCases,
          project_key,
          suite_id,
          llmAnalysisFunction
        );

        debugLog("Semantic analysis completed", {
          clustersFound: result.clustersFound,
          stepClusters: result.stepClusters?.length || 0,
          analysisMode: result.analysisMode
        });

        // Format output
        if (format === 'dto' || format === 'json') {
          // Add webUrl fields to test cases if clickable links are enabled
          const enhancedResult = {
            ...result,
            semanticClusters: result.semanticClusters?.map((cluster: any) => ({
              ...cluster,
              testCases: cluster.testCases.map((tc: any) =>
                addTestCaseWebUrl(tc, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
              )
            }))
          };

          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(enhancedResult, null, 2)
            }]
          };
        }

        if (format === 'string') {
          let output = `Semantic Duplicate Analysis Results\n`;
          output += `Project: ${result.projectKey}\n`;
          if (result.suiteId) output += `Suite ID: ${result.suiteId}\n`;
          output += `Total Test Cases: ${result.totalTestCases}\n`;
          output += `Analysis Mode: ${result.analysisMode}\n`;
          output += `Step Clusters: ${result.stepClusters?.length || 0}\n`;
          output += `Test Case Clusters: ${result.clustersFound}\n`;
          output += `Potential Savings: ${result.potentialSavings.duplicateTestCases} duplicates (${result.potentialSavings.estimatedTimeReduction})\n\n`;

          if (result.semanticClusters) {
            result.semanticClusters.forEach((cluster: any, index: number) => {
              output += `Cluster ${index + 1} (${cluster.averageSimilarity}% similarity, ${cluster.clusterType}):\n`;
              cluster.testCases.forEach((tc: any) => {
                const testCaseDisplay = generateTestCaseLink(project_key, tc.key, tc.id, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
                output += `  - ${testCaseDisplay}: ${tc.title} [${tc.automationState}]\n`;
              });
              const medoidDisplay = generateTestCaseLink(project_key, cluster.medoidTestCase, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
              output += `  Medoid: ${medoidDisplay}\n`;
              output += `  Strategy: ${cluster.mergingStrategy}\n\n`;
            });
          }

          return {
            content: [{
              type: "text" as const,
              text: output
            }]
          };
        }

        // Markdown format (default)
        let markdown = `# 🧠 Semantic Test Case Duplicate Analysis\n\n`;
        markdown += `**Project:** ${result.projectKey}\n`;
        if (result.suiteId) markdown += `**Suite ID:** ${result.suiteId}\n`;
        markdown += `**Total Test Cases Analyzed:** ${result.totalTestCases}\n`;
        markdown += `**Analysis Mode:** ${result.analysisMode}\n`;
        markdown += `**Step Clustering Threshold:** ${step_clustering_threshold}%\n`;
        markdown += `**Test Case Similarity Threshold:** ${similarity_threshold}%\n\n`;

        markdown += `## 📊 Analysis Summary\n\n`;
        markdown += `- **Step Clusters Created:** ${result.stepClusters?.length || 0}\n`;
        markdown += `- **Test Case Clusters Found:** ${result.clustersFound}\n`;
        markdown += `- **Duplicate Test Cases:** ${result.potentialSavings.duplicateTestCases}\n`;
        markdown += `- **Estimated Time Reduction:** ${result.potentialSavings.estimatedTimeReduction}\n\n`;

        // Step clusters summary
        if (result.stepClusters && result.stepClusters.length > 0) {
          markdown += `## 🗂️ Step Clusters (Top 10)\n\n`;
          markdown += `| Cluster | Representative Step | Frequency | Summary |\n`;
          markdown += `|---------|-------------------|-----------|----------|\n`;

          result.stepClusters.slice(0, 10).forEach((cluster: any) => {
            markdown += `| ${cluster.id} | ${cluster.representativeStep} | ${cluster.frequency} | ${cluster.semanticSummary} |\n`;
          });
          markdown += `\n`;
        }

        if (result.clustersFound === 0) {
          markdown += `✅ **No duplicates found** above ${similarity_threshold}% similarity threshold.\n\n`;
          markdown += `Consider lowering the threshold or checking if test cases have detailed steps.\n`;
        } else {
          markdown += `## 🧩 Semantic Test Case Clusters\n\n`;

          const clusters = result.semanticClusters || result.clusters;
          clusters.forEach((cluster: any, index: number) => {
            const clusterType = cluster.clusterType ? ` (${cluster.clusterType})` : '';
            markdown += `### Cluster ${index + 1}: ${cluster.averageSimilarity}% Similarity${clusterType}\n\n`;

            // Test cases table
            markdown += `| Test Case | Title | Automation | Steps |\n`;
            markdown += `|-----------|-------|------------|-------|\n`;
            cluster.testCases.forEach((tc: any) => {
              const isMediad = cluster.medoidTestCase === tc.key ? ' 🎯' : '';
              const testCaseDisplay = generateTestCaseLink(project_key, tc.key, tc.id, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
              markdown += `| **${testCaseDisplay}**${isMediad} | ${tc.title} | ${tc.automationState} | ${tc.stepCount} |\n`;
            });
            markdown += `\n`;

            // Automation mix and semantic info
            const { manual, automated, mixed } = cluster.automationMix;
            markdown += `**Automation Mix:** `;
            if (automated > 0) markdown += `${automated} Automated `;
            if (manual > 0) markdown += `${manual} Manual `;
            if (mixed > 0) markdown += `${mixed} Mixed `;
            markdown += `\n\n`;

            if (cluster.semanticCoherence) {
              markdown += `**Semantic Coherence:** ${cluster.semanticCoherence}%\n`;
            }

            // Shared logic
            if (cluster.sharedLogicSummary) {
              markdown += `**Shared Steps:**\n`;
              const steps = cluster.sharedLogicSummary.split('; ');
              steps.slice(0, 3).forEach((step: string) => {
                markdown += `- ${step}\n`;
              });
              if (steps.length > 3) {
                markdown += `- *(${steps.length - 3} more similar steps...)*\n`;
              }
              markdown += `\n`;
            }

            // Recommendations
            markdown += `**💡 Recommendations:**\n`;
            const representativeTestCase = cluster.medoidTestCase || cluster.recommendedBase?.testCaseKey;
            const representativeDisplay = generateTestCaseLink(project_key, representativeTestCase, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
            markdown += `- **Representative Test Case:** ${representativeDisplay} 🎯\n`;
            if (cluster.recommendedBase?.reason) {
              markdown += `- **Selection Reason:** ${cluster.recommendedBase.reason}\n`;
            }
            markdown += `- **Consolidation Strategy:** ${cluster.mergingStrategy}\n\n`;

            markdown += `---\n\n`;
          });
        }

        // Semantic insights
        if (result.semanticInsights && include_semantic_insights) {
          markdown += `## 🔍 Semantic Insights\n\n`;

          if (result.semanticInsights.commonStepPatterns.length > 0) {
            markdown += `### Common Step Patterns\n`;
            result.semanticInsights.commonStepPatterns.forEach((pattern: string) => {
              markdown += `- ${pattern}\n`;
            });
            markdown += `\n`;
          }

          if (result.semanticInsights.discoveredWorkflows.length > 0) {
            markdown += `### Discovered Workflows\n`;
            result.semanticInsights.discoveredWorkflows.forEach((workflow: string) => {
              markdown += `- ${workflow}\n`;
            });
            markdown += `\n`;
          }

          if (result.semanticInsights.automationOpportunities.length > 0) {
            markdown += `### Automation Opportunities\n`;
            result.semanticInsights.automationOpportunities.forEach((opportunity: string) => {
              markdown += `- ${opportunity}\n`;
            });
            markdown += `\n`;
          }
        }

        // Include similarity matrix if requested
        if (include_similarity_matrix && result.similarityMatrix && result.similarityMatrix.length > 0) {
          markdown += `## 📈 Semantic Similarity Matrix\n\n`;
          markdown += `| Test Case 1 | Test Case 2 | Overall | Step Clusters | Semantic | Pattern Type |\n`;
          markdown += `|-------------|-------------|---------|---------------|----------|-------------|\n`;

          result.similarityMatrix.slice(0, 20).forEach((sim: any) => {
            const patternType = sim.patternType || 'other';
            const patternEmoji = patternType === 'user_type' ? '👤' :
                               patternType === 'theme' ? '🎨' :
                               patternType === 'entry_point' ? '🚪' :
                               patternType === 'component' ? '🧩' :
                               patternType === 'permission' ? '🔐' : '❓';

            const stepClusterSim = sim.stepClusterOverlap || 'N/A';
            const semanticConf = sim.semanticConfidence || 'N/A';

            const testCase1Display = generateTestCaseLink(project_key, sim.testCase1Key, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
            const testCase2Display = generateTestCaseLink(project_key, sim.testCase2Key, undefined, clickableLinkConfig.baseWebUrl, clickableLinkConfig);

            markdown += `| ${testCase1Display} | ${testCase2Display} | ${sim.similarityPercentage}% | ${stepClusterSim}% | ${semanticConf}% | ${patternEmoji} ${patternType} |\n`;
          });

          if (result.similarityMatrix.length > 20) {
            markdown += `\n*Showing top 20 similarities out of ${result.similarityMatrix.length} total pairs*\n`;
          }
          markdown += `\n`;
        }

        markdown += `## 🎯 Next Steps\n\n`;
        if (result.clustersFound > 0) {
          markdown += `1. **Review semantic clusters** - medoid test cases (🎯) are most representative\n`;
          markdown += `2. **Implement parameterization** based on discovered patterns\n`;
          markdown += `3. **Consider automation opportunities** from insights section\n`;
          markdown += `4. **Validate step clusters** for reusable test components\n`;
          markdown += `5. **Update test execution plans** to reflect consolidation\n\n`;
        } else {
          markdown += `1. **Lower similarity thresholds** for more lenient matching\n`;
          markdown += `2. **Review step clustering results** for optimization opportunities\n`;
          markdown += `3. **Check semantic insights** for workflow improvements\n\n`;
        }

        if (analysis_mode === 'basic' || result.analysisMode === 'hybrid') {
          markdown += `💡 **Tip:** For full semantic analysis with LLM-powered insights, use this tool in Claude Desktop/Code.\n\n`;
        }

        markdown += `*Semantic analysis completed with ${step_clustering_threshold}% step clustering and ${similarity_threshold}% test case similarity thresholds*\n`;

        return {
          content: [{
            type: "text" as const,
            text: markdown
          }]
        };

      } catch (error: any) {
        debugLog("Error in analyze_test_cases_duplicates_semantic", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error in semantic duplicate analysis: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== SERVER STARTUP ==========

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Always print startup message for tests and debugging
  console.error("✅ Zebrunner Unified MCP Server started successfully");

  if (DEBUG_MODE) {
    console.error(`🔍 Debug mode: ${DEBUG_MODE}`);
    console.error(`🌐 Zebrunner URL: ${ZEBRUNNER_URL}`);
  }
}

// Enhanced error handling and process management
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  if (DEBUG_MODE) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.error('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Handle EPIPE errors gracefully by ignoring SIGPIPE
process.on('SIGPIPE', () => {
  console.error('⚠️  SIGPIPE received, client disconnected');
});

// Error handling for server startup
main().catch((error) => {
  console.error("❌ Failed to start Zebrunner MCP Server:", error.message);
  if (DEBUG_MODE) {
    console.error("Stack trace:", error.stack);
  }
  process.exit(1);
});

export { main as startServer };
