import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ConfigManager } from "./config/manager.js";

// Enhanced imports
import { EnhancedZebrunnerClient } from "./api/enhanced-client.js";
import { ZebrunnerReportingClient, type FieldsLayout } from "./api/reporting-client.js";
import { ZebrunnerReportingToolHandlers } from "./handlers/reporting-tools.js";
import { ReportHandler } from "./handlers/report-handler.js";
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
import { stealthIntegrityCheck } from "./stealth-integrity.js";
import { sanitizeRqlString } from "./utils/security.js";
import { buildChartResponse, type ChartConfig } from "./utils/chart-generator.js";
import { matchesField, filterByField, type FieldFilter, type FieldMatchMode } from "./utils/custom-field-filter.js";
import {
  ALL_PERIODS as SHARED_ALL_PERIODS,
  TEMPLATE as SHARED_TEMPLATE,
  PLATFORM_MAP as SHARED_PLATFORM_MAP,
  buildParamsConfig as sharedBuildParamsConfig,
  createWidgetSqlCaller,
  type WidgetSqlCaller,
} from "./utils/widget-sql.js";
import {
  loadToolIntelSnapshot,
  markdownForAllTools,
  markdownForToolDetails
} from "./utils/tool-intel.js";

// Mutation tools imports
import { ZebrunnerMutationClient } from "./api/mutation-client.js";
import { writeAuditLog } from "./helpers/audit.js";
import { steeringHint } from "./helpers/steering.js";
import { computeDiff, formatDiff } from "./helpers/diff.js";
// Pre-validation removed from the hot path — the API validates server-side.
// On error, we enrich the message with valid options to help the user fix the request.
async function enrichMutationError(
  error: any,
  projectKey: string,
  mc: ZebrunnerMutationClient,
): Promise<string> {
  const base = error.message || String(error);
  try {
    const hints: string[] = [];
    const msg = base.toLowerCase();
    if (msg.includes("priority") || msg.includes("field error")) {
      const res = await mc.getPriorities(projectKey);
      hints.push(`Valid priorities: ${res.items.map((i: any) => i.name).join(", ")}`);
    }
    if (msg.includes("automation") || msg.includes("field error")) {
      const res = await mc.getAutomationStates(projectKey);
      hints.push(`Valid automation states: ${res.items.map((i: any) => i.name).join(", ")}`);
    }
    return hints.length > 0 ? `${base}\n${hints.join("\n")}` : base;
  } catch {
    return base;
  }
}
import {
  collectAllFileUuids,
  reUploadFiles,
  applyUuidMapping,
  stripFailedFileRefs,
  buildFileTransferReport,
  processFilePathAttachments,
  describeFilePathAttachments,
} from "./helpers/file-refs.js";

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

/** Enhanced API client configuration — timeout sourced from TIMEOUT env var (default: 60s) */
const API_TIMEOUT = appConfig.timeout ?? 60_000;

const config: ZebrunnerConfig = {
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN,
  timeout: API_TIMEOUT,
  retryAttempts: 3,
  retryDelay: 1000,
  debug: DEBUG_MODE,
  defaultPageSize: DEFAULT_PAGE_SIZE,
  maxPageSize: MAX_PAGE_SIZE
};

const client = new EnhancedZebrunnerClient(config);
const mutationClient = new ZebrunnerMutationClient(config);

// Initialize reporting client (new authentication method)
const reportingConfig: ZebrunnerReportingConfig = {
  baseUrl: ZEBRUNNER_URL.replace('/api/public/v1', ''),
  accessToken: ZEBRUNNER_TOKEN,
  timeout: API_TIMEOUT,
  debug: DEBUG_MODE
};

const reportingClient = new ZebrunnerReportingClient(reportingConfig);
const reportingHandlers = new ZebrunnerReportingToolHandlers(reportingClient, client);

// Wire up resolvers: automation states and priorities live on the TCM API (Bearer auth),
// not the Public API (Basic auth), so the enhanced client delegates to the reporting client.
client.setAutomationStatesResolver(async (projectKey: string) => {
  const { projectId } = await resolveProjectId(projectKey);
  return reportingClient.getAutomationStates(projectId);
});
client.setPrioritiesResolver(async (projectKey: string) => {
  const { projectId } = await resolveProjectId(projectKey);
  return reportingClient.getPriorities(projectId);
});

// === Auto-detect test case review rules/checkpoints files ===
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const REVIEW_RULES_FILE = (() => {
  const p = path.resolve(process.cwd(), "test_case_review_rules.md");
  if (fs.existsSync(p)) { console.error(`✅ Auto-detected review rules: ${p}`); return p; }
  return undefined;
})();
const REVIEW_CHECKPOINTS_FILE = (() => {
  const p = path.resolve(process.cwd(), "test_case_analysis_checkpoints.md");
  if (fs.existsSync(p)) { console.error(`✅ Auto-detected review checkpoints: ${p}`); return p; }
  return undefined;
})();
const REVIEW_FILES_AVAILABLE = !!(REVIEW_RULES_FILE && REVIEW_CHECKPOINTS_FILE);

// === Widget mini-config ===
const WIDGET_BASE_URL = ZEBRUNNER_URL.replace('/api/public/v1', '');

// Project aliases mapping to project keys (dynamically resolved to IDs)
const PROJECT_ALIASES: Record<string, string> = {
  web: "MFPWEB", android: "MFPAND", ios: "MFPIOS", api: "MFPAPI"
};

const ALL_PERIODS = SHARED_ALL_PERIODS;
type Period = (typeof ALL_PERIODS)[number];
const PLATFORM_MAP = SHARED_PLATFORM_MAP;
const TEMPLATE = SHARED_TEMPLATE;

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

// === Generic SQL widget caller (delegates to shared factory) ===
const callWidgetSql: WidgetSqlCaller = createWidgetSqlCaller(
  WIDGET_BASE_URL,
  () => reportingClient.authenticate()
);

// === Report handler (replaces DashboardHandler) ===
const reportHandler = new ReportHandler(
  reportingClient,
  client,
  reportingHandlers,
  callWidgetSql,
  resolveProjectId,
  PROJECT_ALIASES,
);

// === Build paramsConfig for widget requests (delegates to shared utility) ===
const buildParamsConfig = sharedBuildParamsConfig;

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

/**
 * Analyze bug priorities and trends for comprehensive reporting
 */
function analyzeBugPriorities(bugs: any[]): {
  critical: any[];
  high: any[];
  medium: any[];
  low: any[];
  trends: {
    recentlyIntroduced: any[];
    longStanding: any[];
    frequentlyReproduced: any[];
  };
  statistics: {
    totalBugs: number;
    withDefects: number;
    withoutDefects: number;
    avgFailureCount: number;
  };
  prioritySummary: string;
} {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  // Parse failure counts
  const bugsWithCounts = bugs.map(bug => ({
    ...bug,
    failureCountNum: parseInt(bug.failureCount) || 0,
    sinceDate: bug.since ? new Date(bug.since) : null,
    lastReproDate: bug.lastRepro ? new Date(bug.lastRepro) : null
  }));
  
  // Categorize by priority based on failure count and recency
  const critical = bugsWithCounts.filter(b => 
    b.failureCountNum >= 20 || 
    (b.lastReproDate && b.lastReproDate >= sevenDaysAgo && b.failureCountNum >= 10)
  );
  
  const high = bugsWithCounts.filter(b => 
    !critical.includes(b) && 
    (b.failureCountNum >= 10 || 
     (b.lastReproDate && b.lastReproDate >= sevenDaysAgo && b.failureCountNum >= 5))
  );
  
  const medium = bugsWithCounts.filter(b => 
    !critical.includes(b) && !high.includes(b) && 
    (b.failureCountNum >= 3 || 
     (b.lastReproDate && b.lastReproDate >= thirtyDaysAgo))
  );
  
  const low = bugsWithCounts.filter(b => 
    !critical.includes(b) && !high.includes(b) && !medium.includes(b)
  );
  
  // Identify trends
  const recentlyIntroduced = bugsWithCounts.filter(b => 
    b.sinceDate && b.sinceDate >= sevenDaysAgo
  );
  
  const longStanding = bugsWithCounts.filter(b => 
    b.sinceDate && b.sinceDate < thirtyDaysAgo
  );
  
  const frequentlyReproduced = bugsWithCounts
    .filter(b => b.lastReproDate && b.lastReproDate >= sevenDaysAgo)
    .sort((a, b) => b.failureCountNum - a.failureCountNum)
    .slice(0, 10);
  
  // Calculate statistics
  const totalFailures = bugsWithCounts.reduce((sum, b) => sum + b.failureCountNum, 0);
  const withDefects = bugs.filter(b => b.defectKey && b.defectKey !== "No defect linked").length;
  
  // Generate priority summary
  const prioritySummary = `
🔴 **CRITICAL (${critical.length})**: ${critical.length > 0 ? 'Immediate attention required' : 'None'}
🟠 **HIGH (${high.length})**: ${high.length > 0 ? 'Should be addressed soon' : 'None'}
🟡 **MEDIUM (${medium.length})**: ${medium.length > 0 ? 'Plan for next sprint' : 'None'}
🟢 **LOW (${low.length})**: ${low.length > 0 ? 'Monitor and address when possible' : 'None'}

📊 **Key Insights:**
- **${recentlyIntroduced.length}** bugs introduced in the last 7 days
- **${longStanding.length}** bugs older than 30 days (tech debt)
- **${frequentlyReproduced.length}** bugs actively reproducing
- **${withDefects}** of ${bugs.length} bugs have linked defects (${((withDefects / bugs.length) * 100).toFixed(0)}% coverage)
`.trim();

  return {
    critical,
    high,
    medium,
    low,
    trends: {
      recentlyIntroduced,
      longStanding,
      frequentlyReproduced
    },
    statistics: {
      totalBugs: bugs.length,
      withDefects,
      withoutDefects: bugs.length - withDefects,
      avgFailureCount: bugs.length > 0 ? Math.round(totalFailures / bugs.length) : 0
    },
    prioritySummary
  };
}

/** Enhanced markdown rendering with debug info */
async function getFieldsLayoutForProject(projectKey?: string): Promise<FieldsLayout | undefined> {
  if (!projectKey) return undefined;
  try {
    const { projectId } = await resolveProjectId(projectKey);
    return await reportingClient.getFieldsLayout(projectId);
  } catch {
    return undefined;
  }
}

async function renderTestCaseMarkdown(
  testCase: ZebrunnerTestCase,
  includeDebugInfo: boolean = false,
  includeSuiteHierarchy: boolean = false,
  projectKey?: string,
  clickableLinkConfig?: any
): Promise<string> {
  const fieldsLayout = await getFieldsLayoutForProject(projectKey);
  let markdown = FormatProcessor.formatTestCaseMarkdown(testCase, fieldsLayout);

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
  await stealthIntegrityCheck();

  const server = new McpServer(
    {
      name: "mcp-zebrunner",
      version: "7.1.1"
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      }
    }
  );

  debugLog("🚀 Starting Zebrunner Unified MCP Server with Reporting API", {
    url: ZEBRUNNER_URL,
    debug: DEBUG_MODE,
    reportingApiEnabled: true
  });

  // ========== CORE WORKING FEATURES ==========

  server.registerTool(
    "list_test_suites",
    {
      description: "📋 List test suites for a project (✅ Verified Working)",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      project_id: z.number().int().positive().optional().describe("Project ID (alternative to project_key)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      include_hierarchy: z.boolean().default(false).describe("Include hierarchy information"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(1000).default(50).describe("Page size (configurable via MAX_PAGE_SIZE env var)"),
      page_token: z.string().optional().describe("Page token for pagination"),
      count_only: z.boolean().default(false).describe(
        "When true, paginates through all pages and returns only the total count of suites without data. " +
        "Useful for metrics and dashboards. Bypasses MCP response size limits."
      ),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
    },
    async (args) => {
      const { project_key, project_id, format, include_hierarchy, page, size, page_token, count_only, include_clickable_links } = args;

      try {
        if (!project_key && !project_id) {
          throw new Error('Either project_key or project_id must be provided');
        }

        if (count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken: string | undefined = undefined;
          do {
            const response = await client.getTestSuites(project_key || '', {
              projectId: project_id,
              size: MAX_PAGE_SIZE,
              pageToken: currentPageToken
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken && pageCount < 1000);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            project_key: project_key || String(project_id)
          }, null, 2) }] };
        }

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

  server.registerTool(
    "get_test_case_by_key",
    {
      description: `🔍 Get detailed test case by key or numeric ID. Accepts:
• Test case key: 'MCP-29', 'MCP-2'
• Numeric ID: '86280' (requires project_key)
• From Zebrunner URL: extract project_key and caseId from URLs like https://example.zebrunner.com/projects/MCP/test-cases?caseId=86280 → project_key='MCP', case_key='86280'
Default format is 'json' which exposes all raw field values. Use 'json' when using this tool as a data source for create_test_case or update_test_case. 'markdown' format may omit some raw field content.`,
    inputSchema: {
      project_key: z.string().min(1).optional().describe("Project key (e.g., 'MCP', 'MCP'). Auto-detected from case_key if it contains a key pattern like 'MCP-29'. Required when case_key is a numeric ID."),
      case_key: z.string().min(1).describe("Test case key (e.g., 'MCP-29') OR numeric test case ID (e.g., '86280'). When providing a numeric ID, project_key is required."),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_debug: z.boolean().default(false).describe("Include debug information in markdown"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId with suite hierarchy path"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI"),
      include_execution_history: z.boolean().default(false).describe("Include TCM execution history (manual + automated runs). Shows last 10 executions with status, environment, and configurations.")
    }
    },
    async (args) => {
      const { case_key, format, include_debug, include_suite_hierarchy, include_clickable_links, include_execution_history } = args;

      const isNumericId = /^\d+$/.test(case_key.trim());

      let project_key = args.project_key;
      if (!isNumericId) {
        try {
          const resolved = FormatProcessor.resolveProjectKey(args);
          project_key = resolved.project_key;
        } catch (error: any) {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Error resolving project key: ${error.message}`
            }]
          };
        }
      }

      if (!project_key) {
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error: project_key is required when case_key is a numeric ID. Provide the project key (e.g., 'MCP') along with the numeric ID.`
          }]
        };
      }

      try {
        debugLog("Getting test case", { project_key, case_key, isNumericId, format, include_suite_hierarchy, include_clickable_links });

        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        let testCase;
        if (isNumericId) {
          testCase = await client.getTestCaseById(project_key, parseInt(case_key, 10), { includeSuiteHierarchy: include_suite_hierarchy });
        } else {
          testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });
        }

        if (!testCase) {
          throw new Error(`Test case ${case_key} not found`);
        }

        // Fetch execution history if requested
        let executionHistory: import("./api/reporting-client.js").TestCaseExecution[] | undefined;
        if (include_execution_history && testCase.id) {
          try {
            const { projectId } = await resolveProjectId(project_key);
            executionHistory = await reportingClient.getTestCaseExecutions(testCase.id, projectId, 10);
          } catch (err: any) {
            debugLog("Failed to fetch execution history", { error: err.message });
          }
        }

        if (format === 'markdown') {
          let markdown = await renderTestCaseMarkdown(testCase, include_debug, include_suite_hierarchy, project_key, clickableLinkConfig);
          if (executionHistory && executionHistory.length > 0) {
            markdown += '\n' + FormatProcessor.formatExecutionHistoryMarkdown(executionHistory);
          } else if (include_execution_history) {
            markdown += '\n## Execution History\n\nNo executions found.\n';
          }
          return {
            content: [{
              type: "text" as const,
              text: markdown
            }]
          };
        }

        const enhancedTestCase = addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig);
        if (executionHistory) {
          (enhancedTestCase as any).executionHistory = executionHistory;
        }
        const fieldsLayout = await getFieldsLayoutForProject(project_key);
        const formattedData = FormatProcessor.format(enhancedTestCase, format, fieldsLayout);

        return {
          content: [{
            type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }]
        };
      } catch (error: any) {
        debugLog("Error getting test case", { error: error.message, project_key, case_key });
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

  server.registerTool(
    "get_all_subsuites",
    {
      description: "📋 Get all subsuites from a root suite as flat list with pagination",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key"),
      root_suite_id: z.number().int().positive().describe("Root suite ID to get all subsuites from"),
      include_root: z.boolean().default(true).describe("Include the root suite in results"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(1000).default(50).describe("Page size (configurable via MAX_PAGE_SIZE env var)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of subsuites without data. " +
        "Loads all suites internally to compute the count, but skips formatting and pagination."
      )
    }
    },
    async (args) => {
      const { project_key, root_suite_id, include_root, format, page, size, count_only } = args;

      // Runtime validation for configured MAX_PAGE_SIZE
      if (!count_only && size > MAX_PAGE_SIZE) {
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

        if (count_only) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: allSubsuites.length,
            project_key,
            root_suite_id,
            root_suite_name: rootSuite.title || rootSuite.name,
            includes_root: include_root
          }, null, 2) }] };
        }

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

  server.registerTool(
    "get_test_cases_advanced",
    {
      description: "📊 Advanced test case retrieval with filtering and pagination (✨ Enhanced with automation state and date filtering)\n" +
    "⚠️  IMPORTANT: Use 'suite_id' for direct parent suites, 'root_suite_id' for root suites that contain sub-suites.\n" +
    "💡 TIP: Use 'get_test_cases_by_suite_smart' for automatic suite type detection!",
    inputSchema: {
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
      created_after: z.string().optional().describe("Filter test cases created after this date (ISO format: '2025-01-01' or '2025-01-01T10:00:00Z')"),
      created_before: z.string().optional().describe("Filter test cases created before this date (ISO format: '2025-12-31' or '2025-12-31T23:59:59Z')"),
      modified_after: z.string().optional().describe("Filter test cases modified after this date (ISO format: '2025-01-01' or '2025-01-01T10:00:00Z')"),
      modified_before: z.string().optional().describe("Filter test cases modified before this date (ISO format: '2025-12-31' or '2025-12-31T23:59:59Z')"),
      exclude_deprecated: z.boolean().default(false).describe("Exclude deprecated test cases from results"),
      exclude_draft: z.boolean().default(false).describe("Exclude draft test cases from results"),
      exclude_deleted: z.boolean().default(true).describe("Exclude deleted test cases from results (default: true)"),
      field_path: z.string().optional().describe("Filter by any field using dot-notation path. Top-level: 'title', 'key', 'deprecated'. Nested: 'priority.name', 'automationState.name', 'testSuite.id', 'createdBy.username'. Custom fields: 'customField.manualOnly', 'customField.caseStatus'. Triggers client-side filtering (paginates all pages)."),
      field_value: z.string().optional().describe("Value to match against the field. Required for 'exact', 'contains', and 'regex' modes. Not needed for 'exists' mode."),
      field_match: z.enum(["exact", "contains", "regex", "exists"]).default("exact").describe("Match mode: 'exact' (case-insensitive equality), 'contains' (substring), 'regex' (pattern), 'exists' (field is present and non-null)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(100).default(100).describe("Page size (configurable via MAX_PAGE_SIZE env var)"),
      count_only: z.boolean().default(false).describe(
        "When true, paginates through all pages and returns only the total count without test case data. " +
        "Efficient for metrics collection -- avoids 1MB response limit on large projects."
      ),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
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
        exclude_deprecated,
        exclude_draft,
        exclude_deleted,
        field_path,
        field_value,
        field_match,
        format,
        page,
        size,
        count_only,
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

        const hasFieldFilter = !!field_path;
        const fFilter: FieldFilter | null = hasFieldFilter
          ? { fieldPath: field_path!, fieldValue: field_value, matchMode: (field_match || "exact") as FieldMatchMode }
          : null;

        if (hasFieldFilter && fFilter!.matchMode !== "exists" && !field_value) {
          return { content: [{ type: "text" as const,
            text: `❌ Error: field_value is required when field_match is '${fFilter!.matchMode}'. Use 'exists' mode to check field presence only.`
          }] };
        }

        const baseSearchParams = {
          suiteId: suite_id,
          rootSuiteId: root_suite_id,
          automationState: automation_states,
          createdAfter: created_after,
          createdBefore: created_before,
          modifiedAfter: modified_after,
          modifiedBefore: modified_before,
          excludeDeprecated: exclude_deprecated,
          excludeDraft: exclude_draft,
          excludeDeleted: exclude_deleted
        };

        // Field-path filtering requires full pagination + client-side filter
        if (hasFieldFilter) {
          const allCases: any[] = [];
          let pageCount = 0;
          let currentPageToken: string | undefined = undefined;
          do {
            const response = await client.getTestCases(project_key, {
              ...baseSearchParams,
              size: MAX_PAGE_SIZE,
              pageToken: currentPageToken,
            });
            allCases.push(...(response.items || []));
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          const matched = filterByField(allCases, fFilter!);

          if (count_only) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
              total_count: matched.length,
              total_before_filter: allCases.length,
              pages_traversed: pageCount,
              field_filter: { path: fFilter!.fieldPath, value: fFilter!.fieldValue, mode: fFilter!.matchMode },
              project_key
            }, null, 2) }] };
          }

          const limited = matched.slice(0, size);
          const formattedData = FormatProcessor.format({
            items: limited,
            page_count: limited.length,
            total_matched: matched.length,
            total_before_filter: allCases.length,
            field_filter: { path: fFilter!.fieldPath, value: fFilter!.fieldValue, mode: fFilter!.matchMode },
            _notice: matched.length > limited.length
              ? `Showing first ${limited.length} of ${matched.length} matches. Increase 'size' to see more.`
              : undefined
          }, format);

          return { content: [{ type: "text" as const,
            text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
          }] };
        }

        if (count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken: string | undefined = undefined;
          do {
            const response = await client.getTestCases(project_key, {
              ...baseSearchParams,
              size: MAX_PAGE_SIZE,
              pageToken: currentPageToken,
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            project_key
          }, null, 2) }] };
        }

        const response = await client.getTestCases(project_key, { ...baseSearchParams, page, size });

        if (!validateApiResponse(response, 'array')) {
          throw new Error('Invalid API response format');
        }

        let processedCases = response.items || response;

        if (include_steps && processedCases.length > 0) {
          debugLog("Fetching detailed steps for test cases", { count: Math.min(5, processedCases.length) });

          const casesToFetch = processedCases.slice(0, 5).filter((tc): tc is (typeof tc & { key: string }) => Boolean(tc?.key));

          const detailedCases = await Promise.allSettled(
            casesToFetch.map(async (testCase) => {
              try {
                return await client.getTestCaseByKey(project_key, testCase.key);
              } catch (error) {
                debugLog(`Failed to fetch detailed case ${testCase.key}`, { error });
                return testCase;
              }
            })
          );

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

        const hasMorePages = !!response._meta?.nextPageToken;
        const responseData = {
          items: processedCases,
          page_count: processedCases.length,
          has_more_pages: hasMorePages,
          _meta: {
            ...(response._meta || {}),
            nextPageToken: response._meta?.nextPageToken || undefined
          },
          _notice: hasMorePages
            ? "More pages available. Pass the nextPageToken value to the page_token parameter to fetch the next page. Note: the Zebrunner Public API does not provide a total count."
            : undefined
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

  server.registerTool(
    "get_suite_hierarchy",
    {
      description: "🌳 Get hierarchical test suite tree with configurable depth",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key"),
      root_suite_id: z.number().int().positive().optional().describe("Start from specific root suite"),
      max_depth: z.number().int().positive().max(10).default(5).describe("Maximum tree depth"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
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

  server.registerTool(
    "get_test_cases_by_automation_state",
    {
      description: "🤖 Get test cases filtered by automation state with token-based pagination (💡 Use get_automation_states to see available states). Call repeatedly with page_token to paginate through all results.",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key"),
      automation_states: z.union([
        z.string(),
        z.number(),
        z.array(z.union([z.string(), z.number()]))
      ]).describe("Automation state(s) to filter by. Examples: 'Not Automated', ['Not Automated', 'To Be Automated'], [10, 12], or 'Automated'"),
      suite_id: z.number().int().positive().optional().describe("Optional: Filter by specific suite ID"),
      created_after: z.string().optional().describe("Optional: Filter test cases created after this date (ISO format: '2025-01-01')"),
      exclude_deprecated: z.boolean().default(false).describe("Exclude deprecated test cases from results"),
      exclude_draft: z.boolean().default(false).describe("Exclude draft test cases from results"),
      exclude_deleted: z.boolean().default(true).describe("Exclude deleted test cases from results (default: true)"),
      max_page_size: z.number().int().positive().max(100).default(100).describe("Maximum number of results per page"),
      page_token: z.string().optional().describe("Token for pagination (from previous response next_page_token). On first call, omit this."),
      get_all: z.boolean().default(false).describe("Get all matching test cases across all pages (uses page_token loop internally)"),
      count_only: z.boolean().default(false).describe(
        "When true with get_all, returns only the total count without test case data. " +
        "Efficient for metrics collection -- avoids 1MB response limit on large projects."
      ),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
    },
    async (args) => {
      const { project_key, automation_states, suite_id, created_after, exclude_deprecated, exclude_draft, exclude_deleted, max_page_size, page_token, get_all, count_only, format, include_clickable_links } = args;

      try {
        debugLog("Getting test cases by automation state", args);

        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        const automationStateInfo = Array.isArray(automation_states)
          ? automation_states.join(', ')
          : automation_states;

        if (get_all && count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken = page_token;
          do {
            const response = await client.getTestCases(project_key, {
              size: max_page_size,
              pageToken: currentPageToken,
              suiteId: suite_id,
              automationState: automation_states,
              createdAfter: created_after,
              excludeDeprecated: exclude_deprecated,
              excludeDraft: exclude_draft,
              excludeDeleted: exclude_deleted
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            automation_states: automationStateInfo,
            project_key
          }, null, 2) }] };
        }

        if (get_all) {
          const allTestCases: any[] = [];
          let currentPageToken = page_token;

          do {
            const searchParams = {
              size: max_page_size,
              pageToken: currentPageToken,
              suiteId: suite_id,
              automationState: automation_states,
              createdAfter: created_after,
              excludeDeprecated: exclude_deprecated,
              excludeDraft: exclude_draft,
              excludeDeleted: exclude_deleted
            };

            const response = await client.getTestCases(project_key, searchParams);
            if (!validateApiResponse(response, 'array')) {
              throw new Error('Invalid API response format');
            }

            const pageItems = response.items || response;
            allTestCases.push(...pageItems);

            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          let processedCases = allTestCases;
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

          const MAX_RESPONSE_BYTES = 900_000;
          if (resultText.length > MAX_RESPONSE_BYTES) {
            const avgItemSize = resultText.length / processedCases.length;
            const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
            const truncated = processedCases.slice(0, Math.max(safeCount, 1));
            const truncatedText = JSON.stringify(truncated, null, 2);
            return { content: [{ type: "text" as const, text:
              `Found ${processedCases.length} total for automation state(s): ${automationStateInfo}, returning first ${truncated.length} ` +
              `(response truncated to stay under MCP 1MB limit).\n` +
              `Use count_only=true with get_all=true to get just the count without data.\n\n${truncatedText}`
            }] };
          }

          const summary = `Found ${processedCases.length} test case(s) total for automation state(s): ${automationStateInfo}`;

          return {
            content: [{
              type: "text" as const,
              text: `${summary}\n\n${resultText}`
            }]
          };
        }

        // Single page
        const searchParams = {
          size: max_page_size,
          pageToken: page_token,
          suiteId: suite_id,
          automationState: automation_states,
          createdAfter: created_after,
          excludeDeprecated: exclude_deprecated,
          excludeDraft: exclude_draft,
          excludeDeleted: exclude_deleted
        };

        const response = await client.getTestCases(project_key, searchParams);
        if (!validateApiResponse(response, 'array')) {
          throw new Error('Invalid API response format');
        }
        const processedCases = response.items || response;
        const hasMorePages = !!response._meta?.nextPageToken;
        const nextPageToken = response._meta?.nextPageToken || undefined;

        

        if (format === 'markdown') {
          let markdown = `# Test Cases by Automation State\n\n`;
          markdown += `**Project:** ${project_key}\n`;
          markdown += `**Automation State(s):** ${automationStateInfo}\n`;
          if (suite_id) markdown += `**Suite ID:** ${suite_id}\n`;
          if (created_after) markdown += `**Created After:** ${created_after}\n`;
          markdown += `**Page Results:** ${processedCases.length}`;
          if (hasMorePages) markdown += ` (more pages available)`;
          markdown += `\n\n`;

          if (processedCases.length === 0) {
            markdown += `No test cases found matching the specified automation state(s).\n\n`;
            markdown += `💡 **Available automation states:**\n`;
            markdown += `- 🖐️ Not Automated\n`;
            markdown += `- 👤 To Be Automated\n`;
            markdown += `- ⚙️ Automated\n`;
          } else {
            markdown += `## Test Cases\n\n`;
            processedCases.forEach((testCase: any, index: number) => {
              const num = index + 1;
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

            if (hasMorePages) {
              markdown += `\n📄 **Pagination:** Use page_token="${nextPageToken}" to get next page, or set get_all=true to retrieve all results.\n`;
            }
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

        const result: any = {
          project_key,
          automation_states: automationStateInfo,
          suite_id,
          created_after,
          page_count: processedCases.length,
          has_more_pages: hasMorePages,
          ...(nextPageToken ? { next_page_token: nextPageToken } : {}),
          test_cases: enhancedTestCases
        };

        if (format === 'string') {
          let output = `Test Cases by Automation State\n`;
          output += `Project: ${project_key}\n`;
          output += `Automation State(s): ${automationStateInfo}\n`;
          if (suite_id) output += `Suite ID: ${suite_id}\n`;
          if (created_after) output += `Created After: ${created_after}\n`;
          output += `Count: ${processedCases.length}`;
          if (hasMorePages) output += ` (more pages available)`;
          output += `\n\n`;

          if (processedCases.length === 0) {
            output += `No test cases found matching the specified automation state(s).\n`;
          } else {
            processedCases.forEach((testCase: any, index: number) => {
              const num = index + 1;
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

          if (hasMorePages) {
            output += `\n📄 Pagination: Use page_token="${nextPageToken}" to get next page, or set get_all=true to retrieve all results.\n`;
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

  server.registerTool(
    "get_automation_states",
    {
      description: "🔧 Get available automation states for a project (names and IDs)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      format: z.enum(['json', 'markdown']).default('json').describe("Output format")
    }
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

  server.registerTool(
    "get_test_case_by_title",
    {
      description: "🔍 Get test cases by title using partial match search with pagination support",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key"),
      title: z.string().min(1).describe("Title to search for (partial match)"),
      max_page_size: z.number().int().positive().max(100).default(10).describe("Maximum number of results per page"),
      page_token: z.string().optional().describe("Token for pagination (from previous response next_page_token). On first call, omit this."),
      get_all: z.boolean().default(false).describe("Get all matching test cases across all pages (uses page_token loop internally)"),
      count_only: z.boolean().default(false).describe(
        "When true with get_all, returns only the total count without test case data. " +
        "Efficient for metrics collection -- avoids 1MB response limit on large projects."
      ),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
    },
    async (args) => {
      const { project_key, title, max_page_size, page_token, get_all, count_only, format, include_clickable_links } = args;

      try {
        debugLog("Getting test case by title", args);

        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        const filter = `title~="${sanitizeRqlString(title)}"`;

        if (get_all && count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken = page_token;
          do {
            const response = await client.getTestCases(project_key, {
              size: max_page_size,
              filter,
              pageToken: currentPageToken
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            title_filter: title,
            project_key
          }, null, 2) }] };
        }

        if (get_all) {
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

            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          let processedCases = allTestCases;
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

          const MAX_RESPONSE_BYTES = 900_000;
          if (resultText.length > MAX_RESPONSE_BYTES) {
            const avgItemSize = resultText.length / processedCases.length;
            const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
            const truncated = processedCases.slice(0, Math.max(safeCount, 1));
            const truncatedText = JSON.stringify(truncated, null, 2);
            return { content: [{ type: "text" as const, text:
              `Found ${processedCases.length} total matching title "${title}", returning first ${truncated.length} ` +
              `(response truncated to stay under MCP 1MB limit).\n` +
              `Use count_only=true with get_all=true to get just the count without data.\n\n${truncatedText}`
            }] };
          }

          const summary = `Found ${processedCases.length} test case(s) total matching title "${title}"`;

          return {
            content: [{
              type: "text" as const,
              text: `${summary}\n\n${resultText}`
            }]
          };
        }

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
        const hasMorePages = !!response._meta?.nextPageToken;
        const nextPageToken = response._meta?.nextPageToken || undefined;

        if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
          processedCases = processedCases.map(testCase =>
            addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
          );
        }

        const formattedData = FormatProcessor.format(processedCases, format);
        const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

        const summary = `Found ${processedCases.length} test case(s) on this page matching title "${title}"`;
        let paginationInfo = '';

        if (hasMorePages) {
          paginationInfo = `\n\n📄 **Pagination:** Use page_token="${nextPageToken}" to get next page, or set get_all=true to retrieve all results.`;
        }

        return {
          content: [{
            type: "text" as const,
            text: `${summary}${paginationInfo}\n\n${resultText}`
          }]
        };

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

  server.registerTool(
    "get_test_case_by_filter",
    {
      description: "🔍 Get test cases using advanced filtering options with exact matching",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key"),
      test_suite_id: z.number().int().positive().optional().describe("Filter by exact test suite ID"),
      created_after: z.string().optional().describe("Filter test cases created after this date (ISO format: '2025-01-01T00:00:00Z')"),
      created_before: z.string().optional().describe("Filter test cases created before this date (ISO format: '2025-12-31T23:59:59Z')"),
      last_modified_after: z.string().optional().describe("Filter test cases last modified after this date (ISO format: '2025-01-01T00:00:00Z')"),
      last_modified_before: z.string().optional().describe("Filter test cases last modified before this date (ISO format: '2025-12-31T23:59:59Z')"),
      priority_id: z.number().int().positive().optional().describe("Filter by priority ID (use get_automation_priorities to see available priorities)"),
      automation_state_id: z.number().int().positive().optional().describe("Filter by automation state ID (use get_automation_states to see available states)"),
      exclude_deprecated: z.boolean().default(false).describe("Exclude deprecated test cases from results"),
      exclude_draft: z.boolean().default(false).describe("Exclude draft test cases from results"),
      exclude_deleted: z.boolean().default(true).describe("Exclude deleted test cases from results (default: true)"),
      field_path: z.string().optional().describe("Filter by any field using dot-notation path. Top-level: 'title', 'key', 'deprecated'. Nested: 'priority.name', 'automationState.name', 'testSuite.id', 'createdBy.username'. Custom fields: 'customField.manualOnly', 'customField.caseStatus'. Triggers client-side filtering (paginates all pages)."),
      field_value: z.string().optional().describe("Value to match against the field. Required for 'exact', 'contains', and 'regex' modes. Not needed for 'exists' mode."),
      field_match: z.enum(["exact", "contains", "regex", "exists"]).default("exact").describe("Match mode: 'exact' (case-insensitive equality), 'contains' (substring), 'regex' (pattern), 'exists' (field is present and non-null)"),
      max_page_size: z.number().int().positive().max(100).default(20).describe("Maximum number of results per page"),
      page_token: z.string().optional().describe("Token for pagination (from previous response next_page_token). On first call, omit this."),
      get_all: z.boolean().default(false).describe("Get all matching test cases across all pages (uses page_token loop internally)"),
      count_only: z.boolean().default(false).describe(
        "When true with get_all, returns only the total count without test case data. " +
        "Efficient for metrics collection -- avoids 1MB response limit on large projects."
      ),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
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
        exclude_deprecated,
        exclude_draft,
        exclude_deleted,
        field_path,
        field_value,
        field_match,
        max_page_size,
        page_token,
        get_all,
        count_only,
        format,
        include_clickable_links
      } = args;

      try {
        debugLog("Getting test cases by filter", args);

        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        const hasFieldFilter = !!field_path;
        const fFilter: FieldFilter | null = hasFieldFilter
          ? { fieldPath: field_path!, fieldValue: field_value, matchMode: (field_match || "exact") as FieldMatchMode }
          : null;

        if (hasFieldFilter && fFilter!.matchMode !== "exists" && !field_value) {
          return { content: [{ type: "text" as const,
            text: `❌ Error: field_value is required when field_match is '${fFilter!.matchMode}'. Use 'exists' mode to check field presence only.`
          }] };
        }

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
        if (exclude_deprecated) {
          filters.push(`deprecated = false`);
        }
        if (exclude_draft) {
          filters.push(`draft = false`);
        }
        if (exclude_deleted) {
          filters.push(`deleted = false`);
        }

        if (filters.length === 0 && !hasFieldFilter) {
          throw new Error('At least one filter parameter must be provided (including field_path)');
        }

        const filter = filters.length > 0 ? filters.join(' AND ') : undefined;

        // Field-path filter requires full pagination + client-side filter
        if (hasFieldFilter) {
          const allCases: any[] = [];
          let pageCount = 0;
          let currentPageToken = page_token;
          do {
            const response = await client.getTestCases(project_key, {
              size: MAX_PAGE_SIZE,
              filter,
              pageToken: currentPageToken
            });
            allCases.push(...(response.items || []));
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          const matched = filterByField(allCases, fFilter!);

          if (count_only) {
            return { content: [{ type: "text" as const, text: JSON.stringify({
              total_count: matched.length,
              total_before_filter: allCases.length,
              pages_traversed: pageCount,
              rql_filters_applied: filter || "(none)",
              field_filter: { path: fFilter!.fieldPath, value: fFilter!.fieldValue, mode: fFilter!.matchMode },
              project_key
            }, null, 2) }] };
          }

          let processedCases = matched;
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map((testCase: any) =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const limited = processedCases.slice(0, max_page_size);
          const formattedData = FormatProcessor.format(limited, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

          const MAX_RESPONSE_BYTES = 900_000;
          if (resultText.length > MAX_RESPONSE_BYTES) {
            const avgItemSize = resultText.length / limited.length;
            const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
            const truncated = limited.slice(0, Math.max(safeCount, 1));
            const truncatedText = JSON.stringify(truncated, null, 2);
            return { content: [{ type: "text" as const, text:
              `Found ${matched.length} matching field filter (${allCases.length} total before filter), returning first ${truncated.length} ` +
              `(response truncated to stay under MCP 1MB limit).\n` +
              `Use count_only=true to get just the count.\n` +
              `Field filter: ${fFilter!.fieldPath} ${fFilter!.matchMode} ${fFilter!.fieldValue || ''}\n` +
              (filter ? `RQL filters: ${filter}\n` : '') + `\n${truncatedText}`
            }] };
          }

          const filterDesc = `Field filter: ${fFilter!.fieldPath} ${fFilter!.matchMode} ${fFilter!.fieldValue ?? '(any)'}`;
          const summary = `Found ${matched.length} test case(s) matching field filter (${allCases.length} total, ${pageCount} pages scanned)`;
          const showingInfo = matched.length > limited.length ? `\nShowing first ${limited.length} of ${matched.length}. Set max_page_size higher to see more.` : '';

          return { content: [{ type: "text" as const,
            text: `${summary}\n${filterDesc}${filter ? `\nRQL filters: ${filter}` : ''}${showingInfo}\n\n${resultText}`
          }] };
        }

        if (get_all && count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken = page_token;
          do {
            const response = await client.getTestCases(project_key, {
              size: max_page_size,
              filter,
              pageToken: currentPageToken
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            filters_applied: filter,
            project_key
          }, null, 2) }] };
        }

        if (get_all) {
          const allTestCases: any[] = [];
          let currentPageToken = page_token;

          do {
            const response = await client.getTestCases(project_key, {
              size: max_page_size,
              filter: filter,
              pageToken: currentPageToken
            });

            if (!validateApiResponse(response, 'array')) {
              throw new Error('Invalid API response format');
            }

            const pageItems = response.items || response;
            allTestCases.push(...pageItems);

            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          let processedCases = allTestCases;
          if (include_clickable_links && clickableLinkConfig.includeClickableLinks) {
            processedCases = processedCases.map(testCase =>
              addTestCaseWebUrl(testCase, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
            );
          }

          const formattedData = FormatProcessor.format(processedCases, format);
          const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

          const MAX_RESPONSE_BYTES = 900_000;
          if (resultText.length > MAX_RESPONSE_BYTES) {
            const avgItemSize = resultText.length / processedCases.length;
            const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
            const truncated = processedCases.slice(0, Math.max(safeCount, 1));
            const truncatedText = JSON.stringify(truncated, null, 2);
            return { content: [{ type: "text" as const, text:
              `Found ${processedCases.length} total matching filters, returning first ${truncated.length} ` +
              `(response truncated to stay under MCP 1MB limit).\n` +
              `Use count_only=true with get_all=true to get just the count without data.\n` +
              `Applied filters: ${filter}\n\n${truncatedText}`
            }] };
          }

          const summary = `Found ${processedCases.length} test case(s) total matching the specified filters`;
          const filterSummary = `Applied filters: ${filter}`;

          return {
            content: [{
              type: "text" as const,
              text: `${summary}\n${filterSummary}\n\n${resultText}`
            }]
          };
        }

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
        const hasMorePages = !!response._meta?.nextPageToken;
        const nextPageToken = response._meta?.nextPageToken || undefined;

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

        if (hasMorePages) {
          paginationInfo = `\n\n📄 **Pagination:** Use page_token="${nextPageToken}" to get next page, or set get_all=true to retrieve all results.`;
        }

        return {
          content: [{
            type: "text" as const,
            text: `${summary}\n${filterSummary}${paginationInfo}\n\n${resultText}`
          }]
        };

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

  server.registerTool(
    "get_automation_priorities",
    {
      description: "🎯 Get available priorities for a project (names and IDs)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      format: z.enum(['json', 'markdown']).default('json').describe("Output format")
    }
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

  server.registerTool(
    "get_test_coverage_by_test_case_steps_by_key",
    {
      description: "🔍 Analyze test case coverage against actual implementation with recommendations",
    inputSchema: {
      project_key: z.string().min(1).optional().describe("Project key (auto-detected from case_key if not provided)"),
      case_key: z.string().min(1).describe("Test case key (e.g., 'ANDROID-6')"),
      implementation_context: z.string().min(10).describe("Actual implementation details (code snippets, file paths, or implementation description)"),
      analysis_scope: z.enum(['steps', 'assertions', 'data', 'full']).default('full').describe("Scope of analysis: steps, assertions, data coverage, or full analysis"),
      output_format: z.enum(['chat', 'markdown', 'code_comments', 'all']).default('chat').describe("Output format: chat response, markdown file, code comments, or all formats"),
      include_recommendations: z.boolean().default(true).describe("Include improvement recommendations"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId in analysis"),
      file_path: z.string().optional().describe("File path for adding code comments or saving markdown (optional)"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
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

  server.registerTool(
    "generate_draft_test_by_key",
    {
      description: "🧪 Generate draft test code from Zebrunner test case with intelligent framework detection",
    inputSchema: {
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
    }
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

  server.registerTool(
    "get_enhanced_test_coverage_with_rules",
    {
      description: "🔍 Enhanced test coverage analysis with configurable rules validation and quality scoring",
    inputSchema: {
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
    }
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

  server.registerTool(
    "get_tcm_test_suites_by_project",
    {
      description: "📋 Get TCM test suites by project with pagination (Java methodology)",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      max_page_size: z.number().int().positive().max(1000).default(100).describe("Maximum page size for pagination"),
      page_token: z.string().optional().describe("Page token for pagination"),
      count_only: z.boolean().default(false).describe(
        "When true, paginates through all pages and returns only the total count of suites without data. " +
        "Useful for metrics and dashboards. Bypasses MCP response size limits."
      ),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    }
    },
    async (args) => {
      try {
        const { project_key, max_page_size, page_token, count_only, format } = args;

        if (count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken: string | undefined = undefined;
          do {
            const response = await client.getTestSuites(project_key, {
              size: MAX_PAGE_SIZE,
              pageToken: currentPageToken
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken && pageCount < 1000);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            project_key
          }, null, 2) }] };
        }

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

  server.registerTool(
    "get_all_tcm_test_case_suites_by_project",
    {
      description: "📋 Get ALL TCM test case suites by project using comprehensive pagination",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      include_hierarchy: z.boolean().default(true).describe("Include hierarchy information (rootSuiteId, parentSuiteName, etc.)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of suites without data. " +
        "Paginates internally to count all suites, but skips hierarchy processing and formatting."
      ),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    }
    },
    async (args) => {
      try {
        const { project_key, include_hierarchy, count_only, format } = args;

        debugLog("Getting all TCM test case suites", { project_key, include_hierarchy, count_only });

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

          hasMore = result.items.length === pageSize;
          page++;

          if (page > 100) {
            console.error(`⚠️ Stopped pagination after 100 pages for project ${project_key}`);
            break;
          }
        }

        if (count_only) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: allSuites.length,
            pages_traversed: page,
            project_key
          }, null, 2) }] };
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

  server.registerTool(
    "get_root_suites",
    {
      description: "🌳 Get root suites (suites with no parent) from project",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    }
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

  server.registerTool(
    "get_tcm_suite_by_id",
    {
      description: `🔍 Get test suite by its numeric ID. This is the primary tool for any "show me suite", "get suite by ID", or "find suite" request.
Supports two modes:
- simple (default): Fast direct API call. Returns suite fields (id, title, description, parentSuiteId, relativePosition). Best for quick lookups.
- full: Fetches all project suites and enriches with hierarchy (rootSuiteId, parent chain, clickable links). Use when hierarchy context is needed.`,
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      project_id: z.number().int().positive().optional().describe("Project ID (alternative to project_key)"),
      suite_id: z.number().int().positive().describe("Suite ID to find"),
      mode: z.enum(['simple', 'full']).default('simple').describe("'simple' = fast direct API call (default). 'full' = hierarchy-enriched with root suite chain and clickable links."),
      only_root_suites: z.boolean().default(false).describe("(full mode only) Search only in root suites"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("(full mode only) Include clickable links to Zebrunner web UI")
    }
    },
    async (args) => {
      try {
        const { project_key, suite_id, format } = args;
        const mode = args.mode || 'simple';

        debugLog("Getting TCM suite by ID", { project_key, suite_id, mode });

        // ---- Simple mode: direct Public API call ----
        if (mode === 'simple') {
          try {
            const body = await mutationClient.getTestSuiteById(project_key, suite_id);
            const suite = body.data;

            const formattedResult = FormatProcessor.format(suite, format as any);
            return {
              content: [{
                type: "text" as const,
                text: typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2)
              }]
            };
          } catch (directError: any) {
            if (directError.statusCode === 404) {
              return {
                content: [{
                  type: "text" as const,
                  text: `❌ Suite ID ${suite_id} not found in project ${project_key}`
                }]
              };
            }
            throw directError;
          }
        }

        // ---- Full mode: fetch all + hierarchy enrichment ----
        const { only_root_suites, include_clickable_links } = args;

        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        debugLog("Fetching all suites using getAllTestSuites method", { project_key, suite_id });
        const allSuites = await client.getAllTestSuites(project_key);

        debugLog("Fetched suites", {
          totalSuites: allSuites.length,
          searchingSuiteId: suite_id,
          sampleSuiteIds: allSuites.slice(0, 5).map(s => s.id)
        });

        let searchSuites = allSuites;
        if (only_root_suites) {
          searchSuites = HierarchyProcessor.getRootSuites(allSuites);
        }

        const suite = searchSuites.find((s: ZebrunnerTestSuite) => s.id === suite_id);

        if (suite) {
          const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
          const enhancedSuite = processedSuites.find(s => s.id === suite_id) || suite;

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

  // ========== MUTATION TOOLS (Beta) ==========

  // Boolean that also accepts string "true"/"false" from MCP clients that
  // serialise booleans as strings (e.g. Zebrunner MCP Inspector, some XML transports).
  const BoolParam = z.preprocess(
    (v) => (v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : v),
    z.boolean().default(false),
  );

  // --- Confirmation token enforcement ---
  // Ensures the preview step is always executed before mutation.
  // Preview generates a one-time-use token and stores the full args;
  // the confirm call only needs confirm + token (args are restored).
  const CONFIRMATION_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 min
  interface PendingConfirmation { timestamp: number; argsJson: string }
  const confirmationTokens = new Map<string, PendingConfirmation>();

  function generateConfirmationToken(argsJson: string): string {
    const now = Date.now();
    for (const [tok, pd] of confirmationTokens) {
      if (now - pd.timestamp > CONFIRMATION_TOKEN_TTL_MS) confirmationTokens.delete(tok);
    }
    const token = crypto.randomBytes(8).toString("hex");
    confirmationTokens.set(token, { timestamp: now, argsJson });
    return token;
  }

  function validateAndRestoreArgs<T extends Record<string, unknown>>(
    args: T,
  ): T | { error: string } {
    const token = (args as Record<string, unknown>).confirmation_token as string | undefined;
    if (!token) {
      return { error: "❌ confirmation_token is required when confirm is true. " +
        "Call without confirm first to get a preview and token." };
    }
    const pd = confirmationTokens.get(token);
    if (pd == null) {
      return { error: "❌ Invalid or already-used confirmation_token. " +
        "Call without confirm first to get a fresh preview and token." };
    }
    if (Date.now() - pd.timestamp > CONFIRMATION_TOKEN_TTL_MS) {
      confirmationTokens.delete(token);
      return { error: "❌ Confirmation token expired (10 min TTL). " +
        "Call without confirm first to get a new preview and token." };
    }
    confirmationTokens.delete(token); // one-time use
    const storedArgs = JSON.parse(pd.argsJson) as T;
    const reviewOverride = (args as Record<string, unknown>).review;
    Object.assign(args, storedArgs);
    (args as Record<string, unknown>).confirm = true;
    if (reviewOverride !== undefined) (args as Record<string, unknown>).review = reviewOverride;
    return args;
  }

  const CreateTestSuiteSchema = z.object({
    project_key: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID')"),
    project_id: z.number().int().positive().optional().describe("Project numeric ID (alternative to project_key)"),
    title: z.string().min(1).max(255).optional().describe("Suite name. Required for preview, auto-restored for confirm."),
    description: z.string().max(5000).optional().describe("Optional description."),
    parent_suite_id: z.number().int().positive().optional()
      .describe("ID of parent suite. Omit to create a root-level suite."),
    dry_run: BoolParam.describe("If true, returns raw payload for debugging (skips validation)."),
    confirm: BoolParam.describe("Must be true to execute. Without it, returns a preview for user approval."),
    confirmation_token: z.string().optional()
      .describe("Token returned by the preview step. Required when confirm is true."),
  });

  server.registerTool(
    "create_test_suite",
    {
      description: `🔧 (Beta) Create a new Test Suite in a Zebrunner project.
Requires Engineer role or higher in the target project.
Suites can be nested at any depth by providing parent_suite_id.
Omit parent_suite_id to create a root-level suite.
TWO-STEP FLOW: 1) Call with all fields (without confirm) to get a preview + confirmation_token. 2) After user approval, call with ONLY confirm: true and the confirmation_token. The full payload is stored server-side — do NOT re-send other fields.`,
      inputSchema: CreateTestSuiteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        // Restore full args from stored token when confirming
        if (args.confirm) {
          const restored = validateAndRestoreArgs(args);
          if ("error" in restored) return { content: [{ type: "text" as const, text: restored.error }] };
        }

        if (!args.project_key && !args.project_id) {
          return { content: [{ type: "text" as const, text: "❌ Either project_key or project_id must be provided" }] };
        }
        if (!args.title) {
          return { content: [{ type: "text" as const, text: "❌ title is required" }] };
        }
        const projectKey = args.project_key || String(args.project_id);

        const payload: Record<string, unknown> = { title: args.title };
        if (args.description !== undefined) payload.description = args.description;
        if (args.parent_suite_id !== undefined) payload.parentSuiteId = args.parent_suite_id;

        const url = `/test-suites?projectKey=${encodeURIComponent(projectKey)}`;

        if (args.dry_run) {
          return {
            content: [{ type: "text" as const, text:
              `DRY RUN — create_test_suite\nPOST ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }]
          };
        }

        const parentLabel = args.parent_suite_id != null
          ? `Suite ID ${args.parent_suite_id}`
          : "root level";

        if (!args.confirm) {
          const token = generateConfirmationToken(JSON.stringify(args));
          return {
            content: [{ type: "text" as const, text:
              `📋 Preview — create_test_suite\nPOST ${url}\n\n` +
              `Title: ${args.title}\n` +
              `Parent: ${parentLabel}\n` +
              `Description: ${args.description || "(none)"}\n\n` +
              `Payload:\n${JSON.stringify(payload, null, 2)}\n\n` +
              `confirmation_token: ${token}\n` +
              `⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`
            }]
          };
        }

        // Confirm — execute mutation
        writeAuditLog({
          timestamp: new Date().toISOString(),
          tool: "create_test_suite",
          method: "POST",
          url,
          projectKey,
          payload,
        });

        const body = await mutationClient.createTestSuite(projectKey, payload);
        const suite = body.data;
        const createdParent = suite.parentSuiteId != null
          ? `Suite ID ${suite.parentSuiteId}`
          : "root level";

        return {
          content: [{ type: "text" as const, text:
            `✅ Test Suite created successfully\n` +
            `ID: ${suite.id}\nTitle: ${suite.title}\n` +
            `Parent: ${createdParent}\n` +
            `Position: ${suite.relativePosition ?? "N/A"}\n\n` +
            `Full record:\n${JSON.stringify(suite, null, 2)}` +
            steeringHint("create_test_suite", { id: suite.id as number })
          }]
        };
      } catch (error: any) {
        const hint = error.statusCode === 409
          ? "\nHint: A concurrent modification is in progress. Wait a moment and retry."
          : "";
        return {
          content: [{ type: "text" as const, text:
            `❌ Error in create_test_suite: ${error.message}${hint}`
          }]
        };
      }
    }
  );

  const UpdateTestSuiteSchema = z.object({
    project_key: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID')"),
    project_id: z.number().int().positive().optional().describe("Project numeric ID (alternative to project_key)"),
    suite_id: z.number().int().positive().optional()
      .describe("Numeric ID of the Test Suite to update. Required for preview, auto-restored for confirm."),
    title: z.string().min(1).max(255).optional()
      .describe("Suite name. Required for preview — this is a full PUT replacement, all fields are overwritten."),
    description: z.string().max(5000).optional()
      .describe("Suite description. Omit to clear it."),
    parent_suite_id: z.number().int().positive().nullable().optional()
      .describe("Parent suite ID. Set to null or omit to make this a root-level suite."),
    dry_run: BoolParam.describe("If true, returns raw payload for debugging (skips validation)."),
    confirm: BoolParam.describe("Must be true to execute. Without it, returns a preview for user approval."),
    confirmation_token: z.string().optional()
      .describe("Token returned by the preview step. Required when confirm is true."),
  });

  server.registerTool(
    "update_test_suite",
    {
      description: `🔧 (Beta) Update an existing Test Suite by its numeric ID.
Requires Engineer role or higher in the target project.
⚠️ IMPORTANT: This uses PUT (full replacement). You must always provide 'title' even if you only want to change another field.
Setting parent_suite_id to null or omitting it will promote the suite to root level.
TWO-STEP FLOW: 1) Call with all fields (without confirm) to get a preview + confirmation_token. 2) After user approval, call with ONLY confirm: true and the confirmation_token. The full payload is stored server-side — do NOT re-send other fields.`,
      inputSchema: UpdateTestSuiteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        if (args.confirm) {
          const restored = validateAndRestoreArgs(args);
          if ("error" in restored) return { content: [{ type: "text" as const, text: restored.error }] };
        }

        if (!args.project_key && !args.project_id) {
          return { content: [{ type: "text" as const, text: "❌ Either project_key or project_id must be provided" }] };
        }
        if (!args.suite_id) {
          return { content: [{ type: "text" as const, text: "❌ suite_id is required" }] };
        }
        if (!args.title) {
          return { content: [{ type: "text" as const, text: "❌ title is required" }] };
        }
        const projectKey = args.project_key || String(args.project_id);

        const payload: Record<string, unknown> = { title: args.title };
        if (args.description !== undefined) payload.description = args.description;
        if (args.parent_suite_id !== undefined) payload.parentSuiteId = args.parent_suite_id;

        const url = `/test-suites/${args.suite_id}?projectKey=${encodeURIComponent(projectKey)}`;

        if (args.dry_run) {
          return {
            content: [{ type: "text" as const, text:
              `DRY RUN — update_test_suite\nPUT ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }]
          };
        }

        if (!args.confirm) {
          let beforeText = "";
          try {
            const before = await mutationClient.getTestSuiteById(projectKey, args.suite_id);
            const beforeData = before.data;
            beforeText =
              `Current values:\n` +
              `  Title: ${beforeData.title ?? "N/A"}\n` +
              `  Description: ${beforeData.description ?? "(none)"}\n` +
              `  Parent Suite ID: ${beforeData.parentSuiteId ?? "root level"}\n\n`;
          } catch {
            beforeText = "⚠️ Could not fetch current suite state for comparison.\n\n";
          }

          const token = generateConfirmationToken(JSON.stringify(args));
          return {
            content: [{ type: "text" as const, text:
              `📋 Preview — update_test_suite\nPUT ${url}\n\n` +
              beforeText +
              `Proposed values:\n` +
              `  Title: ${args.title}\n` +
              `  Description: ${args.description ?? "(will be cleared)"}\n` +
              `  Parent Suite ID: ${args.parent_suite_id ?? "root level"}\n\n` +
              `Payload:\n${JSON.stringify(payload, null, 2)}\n\n` +
              `confirmation_token: ${token}\n` +
              `⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`
            }]
          };
        }

        // Confirm — execute mutation
        let beforeData: Record<string, unknown> = {};
        try {
          const before = await mutationClient.getTestSuiteById(projectKey, args.suite_id);
          beforeData = before.data ?? {};
        } catch {
          // Non-fatal — proceed without diff
        }

        writeAuditLog({
          timestamp: new Date().toISOString(),
          tool: "update_test_suite",
          method: "PUT",
          url,
          projectKey,
          payload,
        });

        const body = await mutationClient.updateTestSuite(projectKey, args.suite_id, payload);
        const afterData = body.data ?? {};
        const diffs = computeDiff(beforeData, afterData);
        const parentLabel = afterData.parentSuiteId != null
          ? `Suite ID ${afterData.parentSuiteId}`
          : "root level";

        return {
          content: [{ type: "text" as const, text:
            `✅ Test Suite updated successfully\n` +
            `ID: ${afterData.id} | Title: ${afterData.title}\n` +
            `Parent: ${parentLabel} | Position: ${afterData.relativePosition ?? "N/A"}\n\n` +
            `Changed fields:\n${formatDiff(diffs)}\n\n` +
            `Full updated record:\n${JSON.stringify(afterData, null, 2)}`
          }]
        };
      } catch (error: any) {
        const hint = error.statusCode === 409
          ? "\nHint: A concurrent modification is in progress. Wait a moment and retry."
          : error.statusCode === 404
          ? "\nHint: No suite found with the provided suite_id in this project."
          : "";
        return {
          content: [{ type: "text" as const, text:
            `❌ Error in update_test_suite: ${error.message}${hint}`
          }]
        };
      }
    }
  );

  const IdOrName = z.union([
    z.object({ id: z.number().int().positive() }),
    z.object({ name: z.string().min(1) }),
  ]);

  // ========== manage_test_run (Beta) ==========

  const TestRunConfigurationSchema = z.object({
    group: IdOrName.describe("Configuration group — provide { id } or { name }"),
    option: IdOrName.describe("Configuration option — provide { id } or { name }"),
  });

  const TestRunRequirementSchema = z.object({
    source: z.enum(["JIRA", "AZURE_DEVOPS"]).describe("External system type"),
    reference: z.string().min(1).describe("Issue/requirement ID (e.g., 'ZEB-1703')"),
  });

  const TestSuiteSelectorSchema = z.object({
    id: z.number().int().positive().describe("Test Suite ID"),
    selectionMode: z.enum(["IMMEDIATE", "ALL_DESCENDANTS"]).default("ALL_DESCENDANTS")
      .describe("IMMEDIATE = direct children only; ALL_DESCENDANTS = full subtree"),
  });

  const ManageTestRunSchema = z.object({
    action: z.enum(["create", "update", "add_cases"])
      .describe("Action to perform: create a new test run, update an existing one, or add test cases to a run."),
    project_key: z.string().min(1).optional()
      .describe("Project key (e.g., 'MCP'). Provide either this or project_id."),
    project_id: z.number().int().positive().optional()
      .describe("Project numeric ID. Provide either this or project_key."),
    test_run_id: z.number().int().positive().optional()
      .describe("Test Run ID. Required for 'update' and 'add_cases' actions."),
    title: z.string().min(1).max(255).optional()
      .describe("Test run title. Required for 'create'. Optional for 'update' (PATCH — only provided fields change)."),
    description: z.string().max(10000).optional()
      .describe("Test run description. Max 10,000 characters."),
    milestone: IdOrName.optional()
      .describe("Milestone — provide { id } or { name } of an existing milestone."),
    environment: z.object({ key: z.string().min(1) }).optional()
      .describe("Environment — provide { key } (e.g., 'pre-prod')."),
    configurations: z.array(TestRunConfigurationSchema).max(100).optional()
      .describe("Configuration group/option pairs. WARNING on update: this list is ATOMIC — it REPLACES all existing configurations."),
    requirements: z.array(TestRunRequirementSchema).optional()
      .describe("Linked requirements (JIRA / AZURE_DEVOPS references)."),
    test_case_keys: z.array(z.string().min(1)).optional()
      .describe("Test case keys to add (e.g., ['MCP-82','MCP-83']). Only for 'add_cases' action."),
    test_suite_ids: z.array(TestSuiteSelectorSchema).optional()
      .describe("Test suites whose cases should be added. Only for 'add_cases' action."),
    all_project_test_cases: z.boolean().optional()
      .describe("If true, add ALL project test cases to the run. Only for 'add_cases' action."),
    skip_errors: BoolParam.describe("Tolerate non-fatal errors (e.g., unknown milestone). Default: true."),
    create_missing_configurations: BoolParam.optional()
      .describe("Auto-create configuration groups/options that don't exist. API default: true."),
    dry_run: BoolParam.describe("If true, returns raw payload for debugging (skips validation)."),
    confirm: BoolParam.describe("Must be true to execute. Without it, returns a preview for user approval."),
    confirmation_token: z.string().optional()
      .describe("Token returned by the preview step. Required when confirm is true."),
  });

  server.registerTool(
    "manage_test_run",
    {
      description: `🏃 (Beta) Create, update, or add test cases to a Zebrunner Test Run.
Requires Engineer role or higher in the target project.

ACTIONS:
  create   — Create a new (empty) test run. Requires 'title'.
  update   — Partial update (PATCH) of an existing test run. Only provided fields change.
             WARNING: 'configurations' is atomic — providing it REPLACES ALL existing configs.
  add_cases — Add test cases to an existing test run by keys, suite IDs, or all project cases.

Use 'get_test_run_configuration_groups' and 'get_test_run_result_statuses' to discover valid configuration values.

TWO-STEP FLOW: 1) Call with all fields (without confirm) to get a preview + confirmation_token. 2) After user approval, call with ONLY confirm: true and the confirmation_token. The full payload is stored server-side — do NOT re-send other fields.`,
      inputSchema: ManageTestRunSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        if (args.confirm) {
          const restored = validateAndRestoreArgs(args);
          if ("error" in restored) return { content: [{ type: "text" as const, text: restored.error }] };
        }

        if (!args.project_key && !args.project_id) {
          return { content: [{ type: "text" as const, text: "❌ Either project_key or project_id must be provided" }] };
        }
        const projectKey = args.project_key || String(args.project_id);

        const opts: { skipErrors?: boolean; createMissingConfigurations?: boolean } = {};
        if (args.skip_errors !== undefined) opts.skipErrors = !!args.skip_errors;
        if (args.create_missing_configurations !== undefined) opts.createMissingConfigurations = !!args.create_missing_configurations;

        // ─── ACTION: CREATE ───
        if (args.action === "create") {
          if (!args.title) {
            return { content: [{ type: "text" as const, text: "❌ title is required for action 'create'" }] };
          }
          const payload: Record<string, unknown> = { title: args.title };
          if (args.description !== undefined) payload.description = args.description;
          if (args.milestone !== undefined) payload.milestone = args.milestone;
          if (args.environment !== undefined) payload.environment = args.environment;
          if (args.configurations !== undefined) payload.configurations = args.configurations;
          if (args.requirements !== undefined) payload.requirements = args.requirements;

          const url = `/test-runs?projectKey=${encodeURIComponent(projectKey)}`;

          if (args.dry_run) {
            return { content: [{ type: "text" as const, text:
              `DRY RUN — manage_test_run (create)\nPOST ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }] };
          }

          if (!args.confirm) {
            const token = generateConfirmationToken(JSON.stringify(args));
            const lines = [
              `📋 Preview — manage_test_run (create)`,
              `POST ${url}\n`,
              `Fields to be set:`,
              `  title            → ${args.title}`,
            ];
            if (args.description !== undefined) lines.push(`  description      → ${args.description.slice(0, 80)}${args.description.length > 80 ? "..." : ""}`);
            if (args.milestone !== undefined) lines.push(`  milestone        → ${JSON.stringify(args.milestone)}`);
            if (args.environment !== undefined) lines.push(`  environment      → ${JSON.stringify(args.environment)}`);
            if (args.configurations !== undefined) lines.push(`  configurations   → ${args.configurations.length} config(s)`);
            if (args.requirements !== undefined) lines.push(`  requirements     → ${args.requirements.length} requirement(s)`);
            lines.push("");
            lines.push(`Payload:\n${JSON.stringify(payload, null, 2)}`);
            lines.push("");
            lines.push(`confirmation_token: ${token}`);
            lines.push(`⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`);
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          writeAuditLog({
            timestamp: new Date().toISOString(),
            tool: "manage_test_run",
            method: "POST",
            url,
            projectKey,
            payload,
          });

          const body = await mutationClient.createTestRun(projectKey, payload, opts);
          const run = body.data;
          return { content: [{ type: "text" as const, text:
            `✅ Test Run created successfully\n` +
            `ID: ${run.id}\nTitle: ${run.title}\nClosed: ${run.closed}\n` +
            `Created by: ${(run.createdBy as any)?.username ?? "N/A"}\n\n` +
            `Full record:\n${JSON.stringify(run, null, 2)}` +
            steeringHint("manage_test_run_create", { id: run.id as number })
          }] };
        }

        // ─── ACTION: UPDATE ───
        if (args.action === "update") {
          if (!args.test_run_id) {
            return { content: [{ type: "text" as const, text: "❌ test_run_id is required for action 'update'" }] };
          }
          const payload: Record<string, unknown> = {};
          if (args.title !== undefined) payload.title = args.title;
          if (args.description !== undefined) payload.description = args.description;
          if (args.milestone !== undefined) payload.milestone = args.milestone;
          if (args.environment !== undefined) payload.environment = args.environment;
          if (args.configurations !== undefined) payload.configurations = args.configurations;
          if (args.requirements !== undefined) payload.requirements = args.requirements;

          if (Object.keys(payload).length === 0) {
            return { content: [{ type: "text" as const, text: "❌ No fields provided to update. Supply at least one of: title, description, milestone, environment, configurations, requirements." }] };
          }

          const url = `/test-runs/${args.test_run_id}?projectKey=${encodeURIComponent(projectKey)}`;

          if (args.dry_run) {
            return { content: [{ type: "text" as const, text:
              `DRY RUN — manage_test_run (update)\nPATCH ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }] };
          }

          if (!args.confirm) {
            const lines = [
              `📋 Preview — manage_test_run (update)`,
              `PATCH ${url}\n`,
              `Fields to be updated:`,
            ];
            if (args.title !== undefined) lines.push(`  title            → ${args.title}`);
            if (args.description !== undefined) lines.push(`  description      → ${args.description.slice(0, 80)}${args.description.length > 80 ? "..." : ""}`);
            if (args.milestone !== undefined) lines.push(`  milestone        → ${JSON.stringify(args.milestone)}`);
            if (args.environment !== undefined) lines.push(`  environment      → ${JSON.stringify(args.environment)}`);
            if (args.configurations !== undefined) {
              lines.push(`  configurations   → ${args.configurations.length} config(s)`);
              lines.push(`  ⚠️ WARNING: configurations is ATOMIC — this will REPLACE ALL existing configurations!`);
            }
            if (args.requirements !== undefined) lines.push(`  requirements     → ${args.requirements.length} requirement(s)`);
            lines.push("");
            lines.push(`Payload:\n${JSON.stringify(payload, null, 2)}`);
            lines.push("");
            const token = generateConfirmationToken(JSON.stringify(args));
            lines.push(`confirmation_token: ${token}`);
            lines.push(`⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`);
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          writeAuditLog({
            timestamp: new Date().toISOString(),
            tool: "manage_test_run",
            method: "PATCH",
            url,
            projectKey,
            payload,
          });

          const body = await mutationClient.updateTestRun(projectKey, args.test_run_id, payload, opts);
          const run = body.data;
          return { content: [{ type: "text" as const, text:
            `✅ Test Run updated successfully\n` +
            `ID: ${run.id}\nTitle: ${run.title}\nClosed: ${run.closed}\n\n` +
            `Full updated record:\n${JSON.stringify(run, null, 2)}` +
            steeringHint("manage_test_run_update", { id: run.id as number })
          }] };
        }

        // ─── ACTION: ADD_CASES ───
        if (args.action === "add_cases") {
          if (!args.test_run_id) {
            return { content: [{ type: "text" as const, text: "❌ test_run_id is required for action 'add_cases'" }] };
          }
          if (!args.test_case_keys?.length && !args.test_suite_ids?.length && !args.all_project_test_cases) {
            return { content: [{ type: "text" as const, text: "❌ Provide at least one of: test_case_keys, test_suite_ids, or all_project_test_cases" }] };
          }

          const payload: Record<string, unknown> = {};
          const selector: Record<string, unknown> = {};
          if (args.all_project_test_cases) selector.allProjectTestCases = true;
          if (args.test_suite_ids?.length) {
            selector.testSuites = args.test_suite_ids.map(s => ({
              id: s.id,
              selectionMode: s.selectionMode,
            }));
          }
          if (Object.keys(selector).length > 0) payload.selector = selector;
          if (args.test_case_keys?.length) {
            payload.items = args.test_case_keys.map(k => ({ key: k }));
          }

          const url = `/test-runs/${args.test_run_id}/test-cases?projectKey=${encodeURIComponent(projectKey)}`;

          if (args.dry_run) {
            return { content: [{ type: "text" as const, text:
              `DRY RUN — manage_test_run (add_cases)\nPOST ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }] };
          }

          if (!args.confirm) {
            const lines = [
              `📋 Preview — manage_test_run (add_cases)`,
              `POST ${url}\n`,
              `Test cases to add to run ${args.test_run_id}:`,
            ];
            if (args.all_project_test_cases) lines.push(`  • ALL project test cases`);
            if (args.test_suite_ids?.length) {
              lines.push(`  • From ${args.test_suite_ids.length} suite(s):`);
              args.test_suite_ids.forEach(s => lines.push(`    - Suite ${s.id} (${s.selectionMode})`));
            }
            if (args.test_case_keys?.length) {
              lines.push(`  • ${args.test_case_keys.length} specific test case(s): ${args.test_case_keys.join(", ")}`);
            }
            lines.push("");
            lines.push(`Payload:\n${JSON.stringify(payload, null, 2)}`);
            lines.push("");
            const token = generateConfirmationToken(JSON.stringify(args));
            lines.push(`confirmation_token: ${token}`);
            lines.push(`⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`);
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          writeAuditLog({
            timestamp: new Date().toISOString(),
            tool: "manage_test_run",
            method: "POST",
            url,
            projectKey,
            payload,
          });

          await mutationClient.addTestCasesToRun(projectKey, args.test_run_id, payload);

          let verificationText = "";
          try {
            const updated = await client.listPublicTestRunTestCases({
              testRunId: args.test_run_id,
              projectKey,
            });
            verificationText = `\nVerification: Test run now contains ${updated.items.length} test case(s).`;
          } catch {
            verificationText = "\n⚠️ Could not verify updated test case count.";
          }

          return { content: [{ type: "text" as const, text:
            `✅ Test cases added to run ${args.test_run_id} successfully (204 No Content).${verificationText}` +
            steeringHint("manage_test_run_add_cases", { id: args.test_run_id })
          }] };
        }

        return { content: [{ type: "text" as const, text: `❌ Unknown action: ${args.action}. Use 'create', 'update', or 'add_cases'.` }] };
      } catch (error: any) {
        const hint = error.statusCode === 409
          ? "\nHint: A concurrent modification is in progress. Wait a moment and retry."
          : error.statusCode === 404
          ? "\nHint: Test run or referenced resource not found."
          : error.statusCode === 412
          ? "\nHint: Pre-condition failed (e.g., test run is closed)."
          : "";
        return { content: [{ type: "text" as const, text:
          `❌ Error in manage_test_run (${args.action}): ${error.message}${hint}`
        }] };
      }
    }
  );

  // ========== import_launch_results_to_test_run (Beta) ==========

  const DEFAULT_STATUS_MAP: Record<string, string> = {
    PASSED: "Passed",
    FAILED: "Failed",
    SKIPPED: "Skipped",
    ABORTED: "Blocked",
  };

  const ImportLaunchResultsSchema = z.object({
    project_key: z.string().min(1).optional()
      .describe("Project key (e.g., 'MCP'). Provide either this or project_id."),
    project_id: z.number().int().positive().optional()
      .describe("Project numeric ID. Provide either this or project_key."),
    test_run_id: z.number().int().positive().optional()
      .describe("TCM Test Run ID to import results into. Required for preview, auto-restored for confirm."),
    launch_id: z.number().int().positive().optional()
      .describe("Reporting API Launch ID to pull results from. Required for preview, auto-restored for confirm."),
    test_case_keys: z.array(z.string()).optional()
      .describe("Filter: only import results for these test case keys. Omit to import all mapped cases."),
    status_mapping: z.record(z.string(), z.string()).optional()
      .describe("Custom status overrides, e.g. { 'ABORTED': 'Skipped' }. Keys are Reporting statuses (PASSED/FAILED/SKIPPED/ABORTED), values are TCM status names."),
    execution_type: z.enum(["MANUAL", "AUTOMATED"]).default("AUTOMATED")
      .describe("Execution type to assign to imported results."),
    add_missing_test_cases: BoolParam
      .describe("If true, test cases from the launch not already in the run will be added. Default: false (safety)."),
    skip_errors: BoolParam.describe("Tolerate non-fatal errors during import. Default: true."),
    include_details: BoolParam.describe("Carry over test error messages as result details. Default: true."),
    dry_run: BoolParam.describe("If true, returns raw payload for debugging (skips validation)."),
    confirm: BoolParam.describe("Must be true to execute. Without it, returns a preview for user approval."),
    confirmation_token: z.string().optional()
      .describe("Token returned by the preview step. Required when confirm is true."),
  });

  server.registerTool(
    "import_launch_results_to_test_run",
    {
      description: `📊 (Beta) Import automation launch results into a TCM Test Run.

Bridges the Reporting API (launches/tests) to the Public API (test runs/test cases).
Reads test results from a launch, maps test case keys and statuses, and imports them
into the specified test run via the :import endpoint.

Default status mapping: PASSED→Passed, FAILED→Failed, SKIPPED→Skipped, ABORTED→Blocked.
Override with 'status_mapping'. Tests with IN_PROGRESS status are skipped.

Safety: 'add_missing_test_cases' defaults to false — only test cases already in the run are updated.
Set to true to auto-add new test cases from the launch.

TWO-STEP FLOW: 1) Call with all fields (without confirm) to get a preview + confirmation_token. 2) After user approval, call with ONLY confirm: true and the confirmation_token. The full payload is stored server-side — do NOT re-send other fields.`,
      inputSchema: ImportLaunchResultsSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        if (args.confirm) {
          const restored = validateAndRestoreArgs(args);
          if ("error" in restored) return { content: [{ type: "text" as const, text: restored.error }] };
        }

        if (!args.project_key && !args.project_id) {
          return { content: [{ type: "text" as const, text: "❌ Either project_key or project_id must be provided" }] };
        }
        if (!args.test_run_id) {
          return { content: [{ type: "text" as const, text: "❌ test_run_id is required" }] };
        }
        if (!args.launch_id) {
          return { content: [{ type: "text" as const, text: "❌ launch_id is required" }] };
        }
        const projectKey = args.project_key || String(args.project_id);

        // Resolve numeric project ID for Reporting API
        const numericProjectId = await reportingClient.getProjectId(projectKey);

        // Fetch all tests from the launch
        const launchTests = await reportingClient.getAllTestRuns(args.launch_id, numericProjectId);

        // Build test-case-key → result map from launch data
        const statusMap = { ...DEFAULT_STATUS_MAP, ...(args.status_mapping || {}) };
        const tcResultMap = new Map<string, {
          status: string; mappedStatus: string; durationMs: number | null;
          details: string | null; testName: string;
        }>();

        for (const test of launchTests.items) {
          const linkedCases = (test as any).testCases || [];
          for (const tc of linkedCases) {
            const tcKey = tc.testCaseId as string;
            if (!tcKey) continue;

            const rawStatus = ((test as any).status || "").toUpperCase();
            if (rawStatus === "IN_PROGRESS") continue;

            const mapped = statusMap[rawStatus];
            if (!mapped) continue;

            const startTime = (test as any).startTime as number | undefined;
            const finishTime = (test as any).finishTime as number | undefined;
            const durationMs = startTime && finishTime ? finishTime - startTime : null;
            const details = args.include_details && (test as any).message ? String((test as any).message) : null;

            tcResultMap.set(tcKey, {
              status: rawStatus,
              mappedStatus: mapped,
              durationMs,
              details,
              testName: (test as any).name || "Unknown",
            });
          }
        }

        // Filter by requested keys
        if (args.test_case_keys?.length) {
          const allowed = new Set(args.test_case_keys);
          for (const key of tcResultMap.keys()) {
            if (!allowed.has(key)) tcResultMap.delete(key);
          }
        }

        if (tcResultMap.size === 0) {
          return { content: [{ type: "text" as const, text:
            `⚠️ No mappable test case results found in launch ${args.launch_id}.\n` +
            `Total tests in launch: ${launchTests.items.length}\n` +
            `Ensure launch tests have linked test case keys (testCases[].testCaseId).`
          }] };
        }

        // Pre-flight: fetch current test run contents
        let runTestCases: Array<{ testCase: { key: string }; result?: { status?: { name: string } } | null }> = [];
        try {
          const runData = await client.listPublicTestRunTestCases({ testRunId: args.test_run_id, projectKey });
          runTestCases = runData.items as any[];
        } catch {
          // non-fatal — proceed without pre-flight validation
        }

        const runKeys = new Set(runTestCases.map(tc => tc.testCase.key));

        // Categorize
        const matched: Array<{ key: string; currentStatus: string; newStatus: string; durationMs: number | null; testName: string }> = [];
        const notInRun: string[] = [];
        for (const [key, result] of tcResultMap) {
          if (runKeys.has(key)) {
            const current = runTestCases.find(tc => tc.testCase.key === key);
            matched.push({
              key,
              currentStatus: current?.result?.status?.name || "Untested",
              newStatus: result.mappedStatus,
              durationMs: result.durationMs,
              testName: result.testName,
            });
          } else {
            notInRun.push(key);
          }
        }

        // Build import payload
        const importItems: Array<Record<string, unknown>> = [];
        for (const [key, result] of tcResultMap) {
          if (!args.add_missing_test_cases && !runKeys.has(key)) continue;

          const item: Record<string, unknown> = {
            testCase: { key },
            result: {
              status: { name: result.mappedStatus },
              executionType: args.execution_type,
              ...(result.durationMs != null ? { executionTimeInMillis: result.durationMs } : {}),
              ...(result.details ? { details: result.details.slice(0, 10000) } : {}),
            },
          };
          importItems.push(item);
        }

        const importPayload = { items: importItems };
        const url = `/test-runs/${args.test_run_id}/test-cases:import?projectKey=${encodeURIComponent(projectKey)}`;

        if (args.dry_run) {
          return { content: [{ type: "text" as const, text:
            `DRY RUN — import_launch_results_to_test_run\nPOST ${url}\n\nPayload (${importItems.length} items):\n${JSON.stringify(importPayload, null, 2)}`
          }] };
        }

        if (!args.confirm) {
          const lines = [
            `📋 Preview — import_launch_results_to_test_run`,
            `POST ${url}\n`,
            `Launch ${args.launch_id} → Test Run ${args.test_run_id} (project: ${projectKey})\n`,
            `Status mapping: ${Object.entries(statusMap).map(([k, v]) => `${k}→${v}`).join(", ")}\n`,
            `Results to import (${importItems.length} test case(s)):\n`,
          ];

          if (matched.length > 0) {
            lines.push(`  In run (will be updated): ${matched.length}`);
            for (const m of matched.slice(0, 30)) {
              const dur = m.durationMs != null ? ` (${Math.round(m.durationMs / 1000)}s)` : "";
              const change = m.currentStatus !== m.newStatus ? ` [${m.currentStatus} → ${m.newStatus}]` : ` [${m.newStatus} unchanged]`;
              lines.push(`    ${m.key}${change}${dur} — ${m.testName}`);
            }
            if (matched.length > 30) lines.push(`    ... and ${matched.length - 30} more`);
          }

          if (notInRun.length > 0) {
            if (args.add_missing_test_cases) {
              lines.push(`\n  Not in run (will be added): ${notInRun.length} — ${notInRun.slice(0, 10).join(", ")}${notInRun.length > 10 ? "..." : ""}`);
            } else {
              lines.push(`\n  Not in run (will be SKIPPED — add_missing_test_cases is false): ${notInRun.length} — ${notInRun.slice(0, 10).join(", ")}${notInRun.length > 10 ? "..." : ""}`);
            }
          }

          lines.push("");
          const token = generateConfirmationToken(JSON.stringify(args));
          lines.push(`confirmation_token: ${token}`);
          lines.push(`⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`);
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        // Confirm — execute import
        writeAuditLog({
          timestamp: new Date().toISOString(),
          tool: "import_launch_results_to_test_run",
          method: "POST",
          url,
          projectKey,
          payload: { launchId: args.launch_id, testRunId: args.test_run_id, itemCount: importItems.length },
        });

        const importOpts = {
          skipErrors: args.skip_errors !== false,
          addMissingTestCases: !!args.add_missing_test_cases,
        };
        const result = await mutationClient.importTestCaseResults(projectKey, args.test_run_id, importPayload, importOpts);

        const items = result.items || [];
        const succeeded = items.filter((i: any) => i.succeeded);
        const failed = items.filter((i: any) => !i.succeeded);

        const lines = [
          `✅ Import completed: ${succeeded.length} succeeded, ${failed.length} failed out of ${items.length} total.\n`,
        ];

        if (failed.length > 0) {
          lines.push(`Failed items:`);
          for (const f of failed.slice(0, 20)) {
            lines.push(`  ${(f as any).key}: ${(f as any).error?.reason || "UNKNOWN"} — ${(f as any).error?.message || ""}`);
          }
          if (failed.length > 20) lines.push(`  ... and ${failed.length - 20} more`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") + steeringHint("import_launch_results", { id: args.test_run_id }) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text:
          `❌ Error in import_launch_results_to_test_run: ${error.message}`
        }] };
      }
    }
  );

  const FileRef = z.union([
    z.object({ fileUuid: z.string().uuid().describe("UUID of a previously uploaded file") }),
    z.object({ file_path: z.string().min(1).describe("Absolute path to a local file to upload automatically") }),
  ]);

  const StepSchema = z.object({
    action: z.string().optional().describe("Step action text. Supports markdown."),
    expectedResult: z.string().optional().describe("Expected result text. Supports markdown."),
    sharedStepsId: z.number().int().positive().optional()
      .describe("ID of a shared steps group. If set, references reusable shared steps."),
    attachments: z.array(FileRef).optional(),
  });

  const RequirementSchema = z.object({
    source: z.enum(["JIRA", "AZURE_DEVOPS"]),
    reference: z.string().min(1),
  });

  const CreateTestCaseSchema = z.object({
    project_key: z.string().min(1).optional()
      .describe("Project key. Provide either this or project_id."),
    project_id: z.number().int().positive().optional()
      .describe("Project numeric ID. Provide either this or project_key."),
    test_suite_id: z.number().int().positive().optional()
      .describe("ID of the Test Suite to place this test case in. Required for preview, auto-restored for confirm."),
    title: z.string().min(1).max(255).optional()
      .describe("Test case title. Required unless source_case_key is provided (inherited from source)."),
    source_case_key: z.string().optional()
      .describe("Source test case key (e.g., 'MCP-123'). Fetches the source and uses its fields as defaults. Explicitly passed fields override source values. Cross-project file attachments are automatically re-uploaded to the target project."),
    description: z.string().max(5000).optional().describe("Rich text description. Supports markdown."),
    priority: IdOrName.optional()
      .describe("Priority reference. Pass { id: N } or { name: '...' }. Validated against project priorities."),
    automation_state: IdOrName.optional()
      .describe("Automation state reference. Pass { id: N } or { name: '...' }. Validated against project automation states."),
    draft: z.boolean().optional().describe("Ignored — always forced to true for safety. Use update_test_case to publish."),
    deprecated: z.boolean().optional().describe("Mark test case as deprecated. Defaults to false."),
    pre_conditions: z.string().max(2000).optional().describe("Pre-conditions (setup instructions). Supports markdown."),
    post_conditions: z.string().max(2000).optional().describe("Post-conditions (cleanup instructions). Supports markdown."),
    steps: z.array(StepSchema).optional()
      .describe("Test steps. Each step must have either sharedStepsId OR action/expectedResult."),
    requirements: z.array(RequirementSchema).optional()
      .describe("Linked requirements from JIRA or AZURE_DEVOPS."),
    custom_field: z.record(z.string(), z.unknown()).optional()
      .describe("Custom fields keyed by systemName. Values validated at runtime."),
    attachments: z.array(FileRef).optional()
      .describe("Files attached to this test case."),
    dry_run: BoolParam.describe("If true, returns raw payload for debugging (skips validation)."),
    confirm: BoolParam.describe("Must be true to execute. Without it, returns a preview for user approval."),
    confirmation_token: z.string().optional()
      .describe("Token returned by the preview step. Required when confirm is true."),
    review: BoolParam.describe("If true, runs quality review against rules after creation and appends improvement suggestions."),
  });

  server.registerTool(
    "create_test_case",
    {
      description: `🔧 (Beta) Create a new Test Case in a Zebrunner project.
Requires Engineer role or higher in the target project.
Available automation states and priorities can be discovered via list_automation_states and list_priorities tools.
Custom field keys must be systemName values (not display names) from list_custom_fields.
Attachments accept either { fileUuid } for pre-uploaded files or { file_path } for local files (uploaded automatically).
Optionally, pass source_case_key to pre-populate fields from an existing test case (explicit args override source values). When copying, the source test case URL is automatically prepended to the description for traceability.
SAFETY: All created test cases are forced to draft=true regardless of the provided value. Review it and update manually or use update_test_case to publish when ready.
Use dry_run: true to preview the raw payload without any validation.
Pass review: true to run a quality review against project rules after creation.
TWO-STEP FLOW: 1) Call with all fields (without confirm) to get a preview + confirmation_token. 2) After user approval, call with ONLY confirm: true and the confirmation_token (optionally review: true). The full payload is stored server-side — do NOT re-send other fields.`,
      inputSchema: CreateTestCaseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const handlerStart = Date.now();
      try {
        // Restore full args from stored token when confirming
        if (args.confirm) {
          const restored = validateAndRestoreArgs(args);
          if ("error" in restored) return { content: [{ type: "text" as const, text: restored.error }] };
        }

        debugLog("create_test_case: handler entered", { confirm: args.confirm, dry_run: args.dry_run, review: args.review });
        if (!args.project_key && !args.project_id) {
          return { content: [{ type: "text" as const, text: "❌ Either project_key or project_id must be provided" }] };
        }
        if (!args.test_suite_id) {
          return { content: [{ type: "text" as const, text: "❌ test_suite_id is required" }] };
        }
        const projectKey = args.project_key || String(args.project_id);

        // --- Source case resolution ---
        let sourceData: Record<string, unknown> | undefined;
        let sourceProjectKey: string | undefined;
        let fileTransferReport = "";

        if (args.source_case_key) {
          const keyMatch = args.source_case_key.match(/^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/);
          if (!keyMatch) {
            return { content: [{ type: "text" as const, text: "❌ source_case_key must be in format 'PROJECT-123'" }] };
          }
          sourceProjectKey = keyMatch[1];

          const sourceResp = await mutationClient.getTestCaseByKey(sourceProjectKey, args.source_case_key);
          sourceData = sourceResp.data ?? {};
        }

        // Merge source fields with explicit args (explicit args win)
        const eff = {
          title: args.title ?? (sourceData?.title as string | undefined),
          test_suite_id: args.test_suite_id,
          description: args.description !== undefined ? args.description : (sourceData?.description as string | undefined),
          priority: args.priority !== undefined ? args.priority
            : sourceData?.priority ? { name: (sourceData.priority as { name: string }).name } : undefined,
          automation_state: args.automation_state !== undefined ? args.automation_state
            : sourceData?.automationState ? { name: (sourceData.automationState as { name: string }).name } : undefined,
          draft: args.draft !== undefined ? args.draft : (sourceData?.draft as boolean | undefined),
          deprecated: args.deprecated !== undefined ? args.deprecated : (sourceData?.deprecated as boolean | undefined),
          pre_conditions: args.pre_conditions !== undefined ? args.pre_conditions : (sourceData?.preConditions as string | undefined),
          post_conditions: args.post_conditions !== undefined ? args.post_conditions : (sourceData?.postConditions as string | undefined),
          steps: args.steps !== undefined ? args.steps : (sourceData?.steps as Array<Record<string, unknown>> | undefined),
          requirements: args.requirements !== undefined ? args.requirements : (sourceData?.requirements as Array<Record<string, unknown>> | undefined),
          custom_field: args.custom_field !== undefined ? args.custom_field : (sourceData?.customField as Record<string, unknown> | undefined),
          attachments: args.attachments !== undefined ? args.attachments : (sourceData?.attachments as Array<{ fileUuid: string }> | undefined),
        };

        if (!eff.title) {
          return { content: [{ type: "text" as const, text: "❌ title is required (provide directly or via source_case_key)" }] };
        }

        if (args.source_case_key && sourceData) {
          const baseWebUrl = ZEBRUNNER_URL.replace("/api/public/v1", "");
          const sourceId = sourceData.id;
          const sourceLink = sourceId
            ? `[${args.source_case_key}](${baseWebUrl}/projects/${sourceProjectKey}/test-cases?caseId=${sourceId})`
            : args.source_case_key;
          const sourceHeader = `**Source:** ${sourceLink}`;
          eff.description = eff.description ? `${sourceHeader}\n\n${eff.description}` : sourceHeader;
        }

        // Safety: always create test cases as drafts
        eff.draft = true;

        // Build API payload (map snake_case → camelCase)
        const payload: Record<string, unknown> = {
          testSuite: { id: eff.test_suite_id },
          title: eff.title,
        };
        if (eff.description !== undefined) payload.description = eff.description;
        if (eff.priority !== undefined) payload.priority = eff.priority;
        if (eff.automation_state !== undefined) payload.automationState = eff.automation_state;
        payload.draft = true;
        if (eff.deprecated !== undefined) payload.deprecated = eff.deprecated;
        if (eff.pre_conditions !== undefined) payload.preConditions = eff.pre_conditions;
        if (eff.post_conditions !== undefined) payload.postConditions = eff.post_conditions;
        if (eff.steps !== undefined) payload.steps = eff.steps;
        if (eff.requirements !== undefined) payload.requirements = eff.requirements;
        if (eff.custom_field !== undefined) payload.customField = eff.custom_field;
        if (eff.attachments !== undefined) payload.attachments = eff.attachments;

        // Cross-project file handling: re-upload when source project differs
        const isCrossProject = sourceProjectKey && sourceProjectKey.toUpperCase() !== projectKey.toUpperCase();
        if (isCrossProject && sourceData) {
          try {
            const { attachmentUuids, inlineUuids, locations } = collectAllFileUuids(payload);
            const allUuids = [...new Set([...attachmentUuids, ...inlineUuids])];

            if (allUuids.length > 0) {
              const { uuidMap, failures } = await reUploadFiles(allUuids, mutationClient);

              if (uuidMap.size > 0) {
                Object.assign(payload, applyUuidMapping(payload, uuidMap));
              }
              if (failures.length > 0) {
                const { cleanedPayload, warnings } = stripFailedFileRefs(payload, failures);
                Object.assign(payload, cleanedPayload);
                fileTransferReport += warnings.length > 0 ? "\n" + warnings.join("\n") : "";
              }
              fileTransferReport = buildFileTransferReport(allUuids.length, uuidMap, failures, locations) +
                (fileTransferReport ? "\n" + fileTransferReport : "");
            }
          } catch (fileErr: unknown) {
            const msg = fileErr instanceof Error ? fileErr.message : String(fileErr);
            fileTransferReport = `⚠️ Cross-project file transfer failed: ${msg}\nAll file references from source have been stripped.`;
            const allUuids = [...collectAllFileUuids(payload).attachmentUuids, ...collectAllFileUuids(payload).inlineUuids];
            if (allUuids.length > 0) {
              const { cleanedPayload } = stripFailedFileRefs(payload, allUuids);
              Object.assign(payload, cleanedPayload);
            }
          }
        }

        const url = `/test-cases?projectKey=${encodeURIComponent(projectKey)}`;
        debugLog("create_test_case: payload built", { elapsed: `${Date.now() - handlerStart}ms`, stepsCount: (eff.steps as unknown[] | undefined)?.length ?? 0 });

        // Branch A: dry_run
        if (args.dry_run) {
          return {
            content: [{ type: "text" as const, text:
              `DRY RUN — create_test_case\nPOST ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }]
          };
        }

        // Branch B: preview (default)
        if (!args.confirm) {
          const fieldsToSet: string[] = [
            `  title            → ${JSON.stringify(eff.title)}`,
            `  test_suite_id    → ${eff.test_suite_id}`,
          ];
          if (eff.description !== undefined) fieldsToSet.push(`  description      → ${JSON.stringify(eff.description).slice(0, 80)}...`);
          if (eff.priority !== undefined) fieldsToSet.push(`  priority         → ${JSON.stringify(eff.priority)}`);
          if (eff.automation_state !== undefined) fieldsToSet.push(`  automation_state → ${JSON.stringify(eff.automation_state)}`);
          fieldsToSet.push(`  draft            → true (forced for safety — use update_test_case to publish)`);
          if (eff.deprecated !== undefined) fieldsToSet.push(`  deprecated       → ${eff.deprecated}`);
          if (eff.pre_conditions !== undefined) fieldsToSet.push(`  pre_conditions   → ${JSON.stringify(eff.pre_conditions).slice(0, 80)}...`);
          if (eff.post_conditions !== undefined) fieldsToSet.push(`  post_conditions  → ${JSON.stringify(eff.post_conditions).slice(0, 80)}...`);
          if (eff.steps !== undefined) fieldsToSet.push(`  steps            → ${(eff.steps as unknown[]).length} step(s)`);
          if (eff.requirements !== undefined) fieldsToSet.push(`  requirements     → ${(eff.requirements as unknown[]).length} requirement(s)`);
          if (eff.custom_field !== undefined) fieldsToSet.push(`  custom_field     → keys: ${Object.keys(eff.custom_field as object).join(", ")}`);
          if (eff.attachments !== undefined) fieldsToSet.push(`  attachments      → ${(eff.attachments as unknown[]).length} file(s)`);

          // Describe any file_path entries pending upload
          const allAtts = [
            ...(Array.isArray(eff.attachments) ? eff.attachments : []),
            ...(Array.isArray(eff.steps)
              ? (eff.steps as Array<Record<string, unknown>>).flatMap((s) =>
                  Array.isArray(s.attachments) ? s.attachments : [])
              : []),
          ];
          const filePathLines = describeFilePathAttachments(allAtts as Array<{ fileUuid?: string; file_path?: string }>);

          const nullDefaults: string[] = [];
          if (eff.description === undefined) nullDefaults.push(`  description      → null`);
          if (eff.priority === undefined) nullDefaults.push(`  priority         → (project default)`);
          if (eff.automation_state === undefined) nullDefaults.push(`  automation_state → (project default)`);
          if (eff.deprecated === undefined) nullDefaults.push(`  deprecated       → false`);
          if (eff.pre_conditions === undefined) nullDefaults.push(`  pre_conditions   → null`);
          if (eff.post_conditions === undefined) nullDefaults.push(`  post_conditions  → null`);
          if (eff.steps === undefined) nullDefaults.push(`  steps            → (none)`);
          if (eff.requirements === undefined) nullDefaults.push(`  requirements     → []`);
          if (eff.custom_field === undefined) nullDefaults.push(`  custom_field     → (none)`);
          if (eff.attachments === undefined) nullDefaults.push(`  attachments      → []`);

          let previewText = `📋 Preview — create_test_case\nPOST ${url}\n`;
          if (args.source_case_key) {
            previewText += `\nSource: ${args.source_case_key}${isCrossProject ? ` (cross-project → ${projectKey})` : ""}\n`;
          }
          previewText += `\nFields to be set:\n${fieldsToSet.join("\n")}\n`;

          if (nullDefaults.length > 0) {
            previewText += `\n⚠️ Fields that will be null/default (not provided):\n${nullDefaults.join("\n")}\n`;
          }
          if (filePathLines.length > 0) {
            previewText += `\n📎 Attachments to upload:\n${filePathLines.join("\n")}\n`;
          }
          if (fileTransferReport) {
            previewText += `\n📎 ${fileTransferReport}\n`;
          }

          const token = generateConfirmationToken(JSON.stringify(args));
          previewText += steeringHint("create_test_case_preview", { id: 0 });
          previewText += `\nPayload:\n${JSON.stringify(payload, null, 2)}\n\n` +
            `confirmation_token: ${token}\n` +
            `⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`;

          return {
            content: [{ type: "text" as const, text: previewText }]
          };
        }

        // Confirm — execute
        debugLog("create_test_case: entering confirm branch", { elapsed: `${Date.now() - handlerStart}ms` });
        const t0 = Date.now();
        const uploadReportLines: string[] = [];
        const uploadWarnings: string[] = [];
        try {
          if (Array.isArray(payload.attachments)) {
            const { resolved, uploadReport, warnings: uw } = await processFilePathAttachments(
              payload.attachments as Array<{ fileUuid?: string; file_path?: string }>,
              mutationClient,
            );
            payload.attachments = resolved.length > 0 ? resolved : undefined;
            uploadReportLines.push(...uploadReport);
            uploadWarnings.push(...uw);
          }
          if (Array.isArray(payload.steps)) {
            for (const step of payload.steps as Array<Record<string, unknown>>) {
              if (Array.isArray(step.attachments)) {
                const { resolved, uploadReport, warnings: uw } = await processFilePathAttachments(
                  step.attachments as Array<{ fileUuid?: string; file_path?: string }>,
                  mutationClient,
                );
                step.attachments = resolved.length > 0 ? resolved : undefined;
                uploadReportLines.push(...uploadReport);
                uploadWarnings.push(...uw);
              }
            }
          }
        } catch (uploadErr: unknown) {
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          uploadWarnings.push(`⚠️ File upload processing failed: ${msg}. Proceeding without file attachments.`);
          delete payload.attachments;
        }
        debugLog("create_test_case: file uploads done", { elapsed: `${Date.now() - t0}ms` });

        writeAuditLog({
          timestamp: new Date().toISOString(),
          tool: "create_test_case",
          method: "POST",
          url,
          projectKey,
          payload,
          ...(args.source_case_key ? { source_case_key: args.source_case_key } : {}),
        });

        const body = await mutationClient.createTestCase(projectKey, payload);
        debugLog("create_test_case: API call done", { elapsed: `${Date.now() - t0}ms`, totalElapsed: `${Date.now() - handlerStart}ms` });
        const tc = body.data;

        let resultText =
          `✅ Test Case created successfully\n` +
          `ID: ${tc.id ?? "N/A"}\n` +
          `Key: ${tc.key ?? "N/A"}\n` +
          `Title: ${tc.title ?? "N/A"}\n` +
          `Suite ID: ${(tc.testSuite as { id: number })?.id ?? "N/A"}\n` +
          `Priority: ${tc.priority ? JSON.stringify(tc.priority) : "N/A"}\n` +
          `Automation State: ${tc.automationState ? JSON.stringify(tc.automationState) : "N/A"}\n` +
          `Draft: ${tc.draft ?? "N/A"}\n`;

        if (args.source_case_key) resultText += `Source: ${args.source_case_key}\n`;
        if (uploadReportLines.length > 0) resultText += `\n📎 Files uploaded:\n${uploadReportLines.join("\n")}\n`;
        if (uploadWarnings.length > 0) resultText += `\n${uploadWarnings.join("\n")}\n`;
        if (fileTransferReport) resultText += `\n📎 ${fileTransferReport}\n`;
        resultText += `\nFull record:\n${JSON.stringify(tc, null, 2)}`;

        // Optional quality review
        if (args.review && REVIEW_FILES_AVAILABLE && tc.key) {
          try {
            debugLog("create_test_case: running quality review", { key: tc.key });
            const { ZebrunnerToolHandlers } = await import("./handlers/tools.js");
            const { ZebrunnerApiClient } = await import("./api/client.js");
            const basicClient = new ZebrunnerApiClient(config);
            const toolHandlers = new ZebrunnerToolHandlers(basicClient);
            const fieldsLayout = await getFieldsLayoutForProject(projectKey);
            const reviewResult = await toolHandlers.validateTestCase({
              projectKey,
              caseKey: tc.key as string,
              rulesFilePath: REVIEW_RULES_FILE,
              checkpointsFilePath: REVIEW_CHECKPOINTS_FILE,
              format: "markdown",
              improveIfPossible: false,
            }, fieldsLayout);
            debugLog("create_test_case: review done", { elapsed: `${Date.now() - t0}ms` });
            const reviewText = reviewResult?.content?.[0]?.text;
            if (reviewText) {
              resultText += `\n\n📝 Quality Review\n${"─".repeat(40)}\n${reviewText}`;
            }
          } catch (reviewErr: unknown) {
            const msg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
            resultText += `\n\n⚠️ Quality review skipped: ${msg}`;
          }
        } else if (!args.review && REVIEW_FILES_AVAILABLE && tc.key) {
          resultText += `\n\n💡 Tip: pass review: true to run a quality review against project rules.`;
        }

        if (tc.key) {
          resultText += steeringHint("create_test_case", { id: tc.key as string, reviewUsed: !!args.review });
        }

        return {
          content: [{ type: "text" as const, text: resultText }]
        };
      } catch (error: any) {
        const enriched = await enrichMutationError(error, args.project_key || String(args.project_id), mutationClient);
        return {
          content: [{ type: "text" as const, text:
            `❌ Error in create_test_case: ${enriched}`
          }]
        };
      }
    }
  );

  const UpdateTestCaseSchema = z.object({
    project_key: z.string().min(1).optional()
      .describe("Project key. Provide either this or project_id."),
    project_id: z.number().int().positive().optional()
      .describe("Project numeric ID. Provide either this or project_key."),
    identifier: z.union([
      z.number().int().positive().describe("Numeric test case ID → calls PATCH /test-cases/{id}"),
      z.string().min(1).describe("Test case key (e.g. 'MCP-42') → calls PATCH /test-cases/key:{key}"),
    ]).optional().describe("Numeric ID or string key of the test case to update. Required for preview, auto-restored for confirm."),
    test_suite_id: z.number().int().positive().optional()
      .describe("Move test case to a different suite."),
    title: z.string().min(1).max(255).optional().describe("New title."),
    description: z.string().max(5000).optional().describe("Supports markdown."),
    priority: IdOrName.optional()
      .describe("Pass { id: N } or { name: '...' }. Validated at runtime."),
    automation_state: IdOrName.optional()
      .describe("Pass { id: N } or { name: '...' }. Validated at runtime."),
    draft: z.boolean().optional(),
    deprecated: z.boolean().optional(),
    pre_conditions: z.string().max(2000).optional().describe("Supports markdown."),
    post_conditions: z.string().max(2000).optional().describe("Supports markdown."),
    steps: z.array(StepSchema).optional()
      .describe("⚠️ ATOMIC: replaces ALL existing steps. To add one step, first fetch current steps and include them all."),
    requirements: z.array(RequirementSchema).optional()
      .describe("⚠️ ATOMIC: replaces ALL existing requirements."),
    custom_field: z.record(z.string(), z.unknown()).optional()
      .describe("Only specified keys are updated. Set a value to null to clear that field."),
    attachments: z.array(FileRef).optional(),
    dry_run: BoolParam.describe("If true, returns raw payload for debugging (skips validation)."),
    confirm: BoolParam.describe("Must be true to execute. Without it, returns a preview for user approval."),
    confirmation_token: z.string().optional()
      .describe("Token returned by the preview step. Required when confirm is true."),
    review: BoolParam.describe("If true, runs quality review against rules after update and appends improvement suggestions."),
  });

  server.registerTool(
    "update_test_case",
    {
      description: `🔧 (Beta) Partially update an existing Test Case by its numeric ID or string key.
Requires Engineer role or higher in the target project.
Auto-detects the endpoint: numeric identifier → /test-cases/{id}, string identifier → /test-cases/key:{key}.
Both use PATCH — only provided fields are updated.
Attachments accept either { fileUuid } for pre-uploaded files or { file_path } for local files (uploaded automatically).
⚠️ IMPORTANT: 'steps' and 'requirements' are atomic — providing a non-null list replaces ALL existing items. To add a single step, first retrieve the current steps via get_test_case_by_key and include all of them in the update.
TWO-STEP FLOW: 1) Call with all fields (without confirm) to get a preview + confirmation_token. 2) After user approval, call with ONLY confirm: true and the confirmation_token (optionally review: true). The full payload is stored server-side — do NOT re-send other fields.`,
      inputSchema: UpdateTestCaseSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const handlerStart = Date.now();
      try {
        // Restore full args from stored token when confirming
        if (args.confirm) {
          const restored = validateAndRestoreArgs(args);
          if ("error" in restored) return { content: [{ type: "text" as const, text: restored.error }] };
        }

        debugLog("update_test_case: handler entered", { confirm: args.confirm, dry_run: args.dry_run, review: args.review });
        if (!args.project_key && !args.project_id) {
          return { content: [{ type: "text" as const, text: "❌ Either project_key or project_id must be provided" }] };
        }
        if (!args.identifier) {
          return { content: [{ type: "text" as const, text: "❌ identifier is required (numeric ID or string key)" }] };
        }
        const projectKey = args.project_key || String(args.project_id);
        const isKeyIdentifier = typeof args.identifier === "string";

        // Build payload (only include explicitly provided fields)
        const payload: Record<string, unknown> = {};
        if (args.test_suite_id !== undefined) payload.testSuite = { id: args.test_suite_id };
        if (args.title !== undefined) payload.title = args.title;
        if (args.description !== undefined) payload.description = args.description;
        if (args.priority !== undefined) payload.priority = args.priority;
        if (args.automation_state !== undefined) payload.automationState = args.automation_state;
        if (args.draft !== undefined) payload.draft = args.draft;
        if (args.deprecated !== undefined) payload.deprecated = args.deprecated;
        if (args.pre_conditions !== undefined) payload.preConditions = args.pre_conditions;
        if (args.post_conditions !== undefined) payload.postConditions = args.post_conditions;
        if (args.steps !== undefined) payload.steps = args.steps;
        if (args.requirements !== undefined) payload.requirements = args.requirements;
        if (args.custom_field !== undefined) payload.customField = args.custom_field;
        if (args.attachments !== undefined) payload.attachments = args.attachments;

        if (Object.keys(payload).length === 0) {
          return { content: [{ type: "text" as const, text: "❌ At least one field to update must be provided" }] };
        }

        const resourcePath = isKeyIdentifier
          ? `/test-cases/key:${args.identifier}`
          : `/test-cases/${args.identifier}`;
        const url = `${resourcePath}?projectKey=${encodeURIComponent(projectKey)}`;
        const identifierType = isKeyIdentifier ? "key" : "ID";

        // Branch A: dry_run
        if (args.dry_run) {
          return {
            content: [{ type: "text" as const, text:
              `DRY RUN — update_test_case (by ${identifierType})\nPATCH ${url}\n\nPayload:\n${JSON.stringify(payload, null, 2)}`
            }]
          };
        }

        // Fetch before-state for preview/diff (non-fatal if it fails)
        let beforeData: Record<string, unknown> = {};
        try {
          const before = isKeyIdentifier
            ? await mutationClient.getTestCaseByKey(projectKey, args.identifier as string)
            : await mutationClient.getTestCaseById(projectKey, args.identifier as number);
          beforeData = before.data ?? {};
        } catch {
          // Non-fatal
        }

        // Branch B: preview (default) — no settings validation, returns fast
        if (!args.confirm) {
          const stepsWarning = args.steps !== undefined
            ? "\n⚠️ WARNING: steps are provided — this will REPLACE all existing steps.\n"
            : "";
          const reqsWarning = args.requirements !== undefined
            ? "\n⚠️ WARNING: requirements are provided — this will REPLACE all existing requirements.\n"
            : "";

          const allAtts = [
            ...(Array.isArray(args.attachments) ? args.attachments : []),
            ...(Array.isArray(args.steps)
              ? (args.steps as Array<Record<string, unknown>>).flatMap((s) =>
                  Array.isArray(s.attachments) ? s.attachments : [])
              : []),
          ];
          const filePathLines = describeFilePathAttachments(allAtts as Array<{ fileUuid?: string; file_path?: string }>);
          const filePathSection = filePathLines.length > 0
            ? `\n📎 Attachments to upload:\n${filePathLines.join("\n")}\n`
            : "";

          const token = generateConfirmationToken(JSON.stringify(args));
          return {
            content: [{ type: "text" as const, text:
              `📋 Preview — update_test_case (by ${identifierType})\nPATCH ${url}\n\n` +
              `Current record:\n${JSON.stringify(beforeData, null, 2)}\n\n` +
              `Proposed changes:\n${JSON.stringify(payload, null, 2)}\n` +
              stepsWarning + reqsWarning + filePathSection + `\n` +
              `confirmation_token: ${token}\n` +
              `⚠️ To proceed, call again with ONLY: { "confirm": true, "confirmation_token": "${token}" }`
            }]
          };
        }

        // Confirm — execute
        debugLog("update_test_case: entering confirm branch", { elapsed: `${Date.now() - handlerStart}ms` });
        const t0 = Date.now();
        const uploadReportLines: string[] = [];
        const uploadWarnings: string[] = [];
        try {
          if (Array.isArray(payload.attachments)) {
            const { resolved, uploadReport, warnings: uw } = await processFilePathAttachments(
              payload.attachments as Array<{ fileUuid?: string; file_path?: string }>,
              mutationClient,
            );
            payload.attachments = resolved.length > 0 ? resolved : undefined;
            uploadReportLines.push(...uploadReport);
            uploadWarnings.push(...uw);
          }
          if (Array.isArray(payload.steps)) {
            for (const step of payload.steps as Array<Record<string, unknown>>) {
              if (Array.isArray(step.attachments)) {
                const { resolved, uploadReport, warnings: uw } = await processFilePathAttachments(
                  step.attachments as Array<{ fileUuid?: string; file_path?: string }>,
                  mutationClient,
                );
                step.attachments = resolved.length > 0 ? resolved : undefined;
                uploadReportLines.push(...uploadReport);
                uploadWarnings.push(...uw);
              }
            }
          }
        } catch (uploadErr: unknown) {
          const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          uploadWarnings.push(`⚠️ File upload processing failed: ${msg}. Proceeding without file attachments.`);
          delete payload.attachments;
        }
        debugLog("update_test_case: file uploads done", { elapsed: `${Date.now() - t0}ms` });

        writeAuditLog({
          timestamp: new Date().toISOString(),
          tool: "update_test_case",
          method: "PATCH",
          url,
          projectKey,
          payload,
        });

        const body = isKeyIdentifier
          ? await mutationClient.updateTestCaseByKey(projectKey, args.identifier as string, payload)
          : await mutationClient.updateTestCaseById(projectKey, args.identifier as number, payload);
        debugLog("update_test_case: API call done", { elapsed: `${Date.now() - t0}ms`, totalElapsed: `${Date.now() - handlerStart}ms` });

        const afterData = body.data ?? {};
        const diffs = computeDiff(beforeData, afterData);

        let resultText =
          `✅ Test Case updated successfully\n` +
          `ID: ${afterData.id ?? "N/A"} | Key: ${afterData.key ?? "N/A"}\n\n` +
          `Changed fields:\n${formatDiff(diffs)}\n`;

        if (uploadReportLines.length > 0) resultText += `\n📎 Files uploaded:\n${uploadReportLines.join("\n")}\n`;
        if (uploadWarnings.length > 0) resultText += `\n${uploadWarnings.join("\n")}\n`;
        resultText += `\nFull updated record:\n${JSON.stringify(afterData, null, 2)}`;

        const caseKey = afterData.key as string | undefined;
        if (args.review && REVIEW_FILES_AVAILABLE && caseKey) {
          try {
            debugLog("update_test_case: running quality review", { key: caseKey });
            const { ZebrunnerToolHandlers } = await import("./handlers/tools.js");
            const { ZebrunnerApiClient } = await import("./api/client.js");
            const basicClient = new ZebrunnerApiClient(config);
            const toolHandlers = new ZebrunnerToolHandlers(basicClient);
            const fieldsLayout = await getFieldsLayoutForProject(projectKey);
            const reviewResult = await toolHandlers.validateTestCase({
              projectKey,
              caseKey,
              rulesFilePath: REVIEW_RULES_FILE,
              checkpointsFilePath: REVIEW_CHECKPOINTS_FILE,
              format: "markdown",
              improveIfPossible: false,
            }, fieldsLayout);
            debugLog("update_test_case: review done", { elapsed: `${Date.now() - t0}ms` });
            const reviewText = reviewResult?.content?.[0]?.text;
            if (reviewText) {
              resultText += `\n\n📝 Quality Review\n${"─".repeat(40)}\n${reviewText}`;
            }
          } catch (reviewErr: unknown) {
            const msg = reviewErr instanceof Error ? reviewErr.message : String(reviewErr);
            resultText += `\n\n⚠️ Quality review skipped: ${msg}`;
          }
        } else if (!args.review && REVIEW_FILES_AVAILABLE && caseKey) {
          resultText += `\n\n💡 Tip: pass review: true to run a quality review against project rules.`;
        }

        if (caseKey) {
          resultText += steeringHint("update_test_case", { id: caseKey, reviewUsed: !!args.review });
        }

        return {
          content: [{ type: "text" as const, text: resultText }]
        };
      } catch (error: any) {
        const hint = error.statusCode === 404
          ? "\nHint: No test case found with the provided identifier in this project."
          : error.statusCode === 409
          ? "\nHint: A concurrent modification is in progress. Wait a moment and retry."
          : "";
        const enriched = await enrichMutationError(error, args.project_key || String(args.project_id), mutationClient);
        return {
          content: [{ type: "text" as const, text:
            `❌ Error in update_test_case: ${enriched}${hint}`
          }]
        };
      }
    }
  );

  // ========== END MUTATION TOOLS ==========

  server.registerTool(
    "get_all_tcm_test_cases_by_project",
    {
      description: "📋 Get ALL TCM test cases by project using comprehensive pagination",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI"),
      exclude_deprecated: z.boolean().default(false).describe("Exclude deprecated test cases from results"),
      exclude_draft: z.boolean().default(false).describe("Exclude draft test cases from results"),
      exclude_deleted: z.boolean().default(true).describe("Exclude deleted test cases from results (default: true)"),
      max_results: z.number().int().positive().max(10000).default(5000).describe("Maximum number of results (configurable limit for performance)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count without test case data. " +
        "Efficient for metrics collection -- avoids 1MB response limit on large projects."
      )
    }
    },
    async (args) => {
      try {
        const { project_key, format, include_clickable_links, exclude_deprecated, exclude_draft, exclude_deleted, max_results, count_only } = args;

        debugLog("Getting all TCM test cases", { project_key, include_clickable_links, max_results, count_only });

        // Build RQL filter for status exclusions
        const filterParts: string[] = [];
        if (exclude_deprecated) filterParts.push('deprecated = false');
        if (exclude_draft) filterParts.push('draft = false');
        if (exclude_deleted) filterParts.push('deleted = false');
        const rqlFilter = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

        if (count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let pageToken: string | undefined = undefined;
          do {
            const result = await client.getTestCases(project_key, {
              size: MAX_PAGE_SIZE,
              pageToken,
              ...(rqlFilter && !pageToken ? { filter: rqlFilter } : {})
            });
            totalCount += (result.items || []).length;
            pageCount++;
            pageToken = result._meta?.nextPageToken;
          } while (pageToken && pageCount < 100);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            filters_applied: rqlFilter || "none",
            project_key
          }, null, 2) }] };
        }

        // Get clickable links configuration
        const clickableLinkConfig = getClickableLinkConfig(include_clickable_links, ZEBRUNNER_URL);

        // Get all test cases using proper token-based pagination
        let allTestCases: ZebrunnerTestCase[] = [];
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        let wasTruncated = false;
        let hasMorePages = false;
        const maxPages = 100; // Safety limit

        do {
          const result = await client.getTestCases(project_key, {
            size: MAX_PAGE_SIZE,
            pageToken: pageToken,
            ...(rqlFilter && !pageToken ? { filter: rqlFilter } : {})
          });

          allTestCases.push(...result.items);
          pageToken = result._meta?.nextPageToken;
          pageCount++;

          // Apply max_results limit for performance
          if (allTestCases.length >= max_results) {
            allTestCases = allTestCases.slice(0, max_results);
            wasTruncated = true;
            hasMorePages = !!pageToken;
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

        if (!wasTruncated && pageCount >= maxPages && pageToken) {
          wasTruncated = true;
          hasMorePages = true;
        }

        console.error(`Found ${allTestCases.length} testcases.`);

        // Add clickable links to test cases if enabled
        const enhancedTestCases = allTestCases.map((tc: any) =>
          addTestCaseWebUrl(tc, project_key, clickableLinkConfig.baseWebUrl, clickableLinkConfig)
        );

        const resultPayload = {
          project_key,
          total_fetched: allTestCases.length,
          was_truncated: wasTruncated,
          has_more_pages: hasMorePages,
          filters_applied: {
            exclude_deprecated,
            exclude_draft,
            exclude_deleted
          },
          test_cases: enhancedTestCases
        };

        const formattedResult = FormatProcessor.format(resultPayload, format as any);
        const resultText = typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2);

        const MAX_RESPONSE_BYTES = 900_000;
        if (resultText.length > MAX_RESPONSE_BYTES) {
          const avgItemSize = resultText.length / enhancedTestCases.length;
          const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
          const truncated = enhancedTestCases.slice(0, Math.max(safeCount, 1));
          const truncatedText = JSON.stringify(truncated, null, 2);
          return { content: [{ type: "text" as const, text:
            `Found ${allTestCases.length} total test cases for ${project_key}, returning first ${truncated.length} ` +
            `(response truncated to stay under MCP 1MB limit).\n` +
            `Use count_only=true to get just the count without data.\n\n${truncatedText}`
          }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: resultText
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

  server.registerTool(
    "get_all_tcm_test_cases_with_root_suite_id",
    {
      description: "🌳 Get ALL TCM test cases enriched with root suite ID information",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count without test case data. " +
        "Skips hierarchy enrichment for maximum efficiency."
      )
    }
    },
    async (args) => {
      try {
        const { project_key, format, count_only } = args;

        debugLog("Getting all TCM test cases with root suite ID", { project_key, count_only });

        if (count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let pageToken: string | undefined = undefined;
          do {
            const result = await client.getTestCases(project_key, {
              size: MAX_PAGE_SIZE,
              pageToken
            });
            totalCount += (result.items || []).length;
            pageCount++;
            pageToken = result._meta?.nextPageToken;
          } while (pageToken && pageCount < 100);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            project_key
          }, null, 2) }] };
        }

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
        const resultText = typeof formattedResult === 'string' ? formattedResult : JSON.stringify(formattedResult, null, 2);

        const MAX_RESPONSE_BYTES = 900_000;
        if (resultText.length > MAX_RESPONSE_BYTES) {
          const avgItemSize = resultText.length / enrichedTestCases.length;
          const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
          const truncated = enrichedTestCases.slice(0, Math.max(safeCount, 1));
          const truncatedText = JSON.stringify(truncated, null, 2);
          return { content: [{ type: "text" as const, text:
            `Found ${enrichedTestCases.length} total test cases with root suite IDs for ${project_key}, returning first ${truncated.length} ` +
            `(response truncated to stay under MCP 1MB limit).\n` +
            `Use count_only=true to get just the count without data.\n\n${truncatedText}`
          }] };
        }

        return {
          content: [{
            type: "text" as const,
            text: resultText
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

  server.registerTool(
    "get_root_id_by_suite_id",
    {
      description: "🔍 Get root suite ID for a specific suite ID",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      suite_id: z.number().int().positive().describe("Suite ID to find root for"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    }
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

  server.registerTool(
    "get_test_cases_by_suite_smart",
    {
      description: "🧠 Smart test case retrieval by suite ID - automatically detects if suite is root suite and uses appropriate filtering with enhanced pagination",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'MCP')"),
      suite_id: z.number().int().positive().describe("Suite ID to get test cases from"),
      include_steps: z.boolean().default(false).describe("Include detailed test steps for first few cases"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      get_all: z.boolean().default(true).describe("Get all test cases (true) or paginated results (false)"),
      include_sub_suites: z.boolean().default(true).describe("Include test cases from sub-suites (if any)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of test cases in the suite without fetching data. " +
        "Efficient for metrics collection -- avoids 1MB response limit on large projects."
      ),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based, only used if get_all=false)"),
      size: z.number().int().positive().max(100).default(50).describe("Page size (only used if get_all=false)")
    }
    },
    async (args) => {
      try {
        const { project_key, suite_id, include_steps, format, get_all, include_sub_suites, count_only, page, size } = args;

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

        if (count_only) {
          let filter: string;
          if ((isRootSuite || hasChildren) && include_sub_suites) {
            const childSuiteIds: number[] = [suite_id];
            if (isRootSuite) {
              for (const suite of processedSuites) {
                if (suite.rootSuiteId === suite_id && suite.id !== suite_id) {
                  childSuiteIds.push(suite.id);
                }
              }
            } else {
              function findDescendants(parentId: number): number[] {
                const desc: number[] = [];
                for (const s of processedSuites) {
                  if (s.parentSuiteId === parentId) {
                    desc.push(s.id);
                    desc.push(...findDescendants(s.id));
                  }
                }
                return desc;
              }
              childSuiteIds.push(...findDescendants(suite_id));
            }
            filter = `testSuite.id IN [${childSuiteIds.join(',')}]`;
          } else {
            filter = `testSuite.id=${suite_id}`;
          }

          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken: string | undefined = undefined;
          do {
            const response = await client.getTestCases(project_key, {
              size: MAX_PAGE_SIZE,
              filter,
              pageToken: currentPageToken
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            suite_id,
            suite_name: targetSuite.name || targetSuite.title,
            is_root_suite: isRootSuite,
            has_children: hasChildren,
            project_key
          }, null, 2) }] };
        }

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

        const resultText = typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2);

        const MAX_RESPONSE_BYTES = 900_000;
        if (resultText.length > MAX_RESPONSE_BYTES) {
          const avgItemSize = resultText.length / testCases.length;
          const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
          const truncated = testCases.slice(0, Math.max(safeCount, 1));
          const truncatedText = JSON.stringify(truncated, null, 2);
          return { content: [{ type: "text" as const, text:
            `Found ${testCases.length} total test cases in suite ${suite_id}, returning first ${truncated.length} ` +
            `(response truncated to stay under MCP 1MB limit).\n` +
            `Use count_only=true to get just the count without data.\n\n${truncatedText}`
          }] };
        }

        summaryMessage += `\n${resultText}`;

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

  server.registerTool(
    "get_launch_details",
    {
      description: "🚀 Get comprehensive launch details including test sessions (uses new reporting API with enhanced authentication)",
    inputSchema: {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      includeLaunchDetails: z.boolean().default(true).describe("Include detailed launch information"),
      includeTestSessions: z.boolean().default(true).describe("Include test sessions data"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
    },
    async (args) => {
      try {
        debugLog("get_launch_details called", args);
        const result = await reportingHandlers.getLauncherDetails(args);
        if (args.chart && args.chart !== 'none') {
          const text = result?.content?.[0]?.text || '{}';
          try {
            const data = JSON.parse(text);
            const runs = data.testRunsSummary || {};
            const entries = Object.entries(runs.byStatus || {}).filter(([_, v]: any) => v > 0);
            if (entries.length > 0) {
              const chartConfig: ChartConfig = {
                type: args.chart_type !== 'auto' ? args.chart_type : 'pie',
                title: `Launch Details — ${data.launchName || args.launchId}`,
                labels: entries.map(([k]: any) => k),
                datasets: [{ label: 'Tests', values: entries.map(([_, v]: any) => v as number) }],
              };
              return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Launch ${args.launchId} test breakdown`);
            }
          } catch { /* fall through to original result */ }
        }
        return result;
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

  server.registerTool(
    "get_launch_test_summary",
    {
      description: "📊 Get lightweight launch test summary with statistics (auto-paginated, token-optimized)",
    inputSchema: {
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
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      session_resolution: z.enum(['auto', 'per_test', 'launch_level']).default('auto').describe("Session duration resolution strategy: auto (launch-level first, fallback per-test), per_test, or launch_level"),
      jira_base_url: z.string().url().optional().describe("Override JIRA base URL (e.g., 'https://myproject.atlassian.net'). If not set, resolved from Zebrunner integrations or JIRA_BASE_URL env var"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total and per-status count of tests in the launch without full data. " +
        "Skips session resolution, JIRA URL lookup, and formatting. Much faster than full summary."
      ),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

  server.registerTool(
    "generate_weekly_regression_stability_report",
    {
      description: "📌 Generate weekly regression stability report with pass rates, WoW deltas, and Jira-ready output",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'MCP')"),
      suites: z.array(z.object({
        name: z.string().min(1).describe("Human-readable suite name"),
        current_launch_id: z.number().int().positive().describe("Current weekly regression launch ID"),
        previous_launch_id: z.number().int().positive().describe("Previous weekly regression launch ID")
      })).min(1).optional().describe("Suites to include in the report"),
      builds: z.object({
        current: z.string().min(1).describe("Current build identifier (e.g., '49117')"),
        previous: z.string().min(1).describe("Previous build identifier (e.g., '48886')"),
        page_size: z.number().int().positive().max(100).optional().describe("Page size for build lookup (default: 50)"),
        max_pages: z.number().int().positive().max(50).optional().describe("Max pages to scan for build lookup (default: 10)")
      }).optional().describe("Build-based lookup (uses build identifiers to find launches and suites)"),
      thresholds: z.object({
        stable: z.number().min(0).max(100).optional().describe("Stable threshold percentage (default: 90)"),
        watch: z.number().min(0).max(100).optional().describe("Watch threshold percentage (default: 85)")
      }).optional().describe("Custom thresholds for stability classification"),
      linked_issues: z.object({
        enabled: z.boolean().optional().describe("Include linked issues from current launch (default: true)"),
        limit: z.number().int().positive().max(50).optional().describe("Max linked issues per suite (default: 5)"),
        position: z.enum(['after_comparison', 'after_status', 'end'])
          .optional()
          .describe("Where to place linked issues section in report (default: after_comparison)")
      }).optional().describe("Linked issues configuration"),
      output_style: z.enum(['strict', 'default']).default('strict').describe("Output style: strict (no narrative) or default"),
      output_format: z.enum(['jira', 'json', 'dto', 'summary', 'detailed'])
        .default('jira')
        .describe("Output format: jira (default), json, dto, summary, or detailed"),
      count_only: z.boolean().default(false).describe(
        "When true, resolves builds/suites but returns only the count of matched suites without generating the full report. " +
        "Useful for pre-checking how many suites will be included."
      ),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
    },
    async (args) => {
      try {
        debugLog("generate_weekly_regression_stability_report called", args);
        return await reportingHandlers.generateWeeklyRegressionStabilityReport({
          projectKey: args.project_key,
          suites: args.suites
            ? args.suites.map((suite: any) => ({
                name: suite.name,
                currentLaunchId: suite.current_launch_id,
                previousLaunchId: suite.previous_launch_id
              }))
            : [],
          builds: args.builds ? {
            current: args.builds.current,
            previous: args.builds.previous,
            pageSize: args.builds.page_size,
            maxPages: args.builds.max_pages
          } : undefined,
          thresholds: args.thresholds,
          linkedIssues: args.linked_issues,
          outputStyle: args.output_style,
          outputFormat: args.output_format,
          count_only: args.count_only,
          chart: args.chart,
          chart_type: args.chart_type,
        });
      } catch (error: any) {
        debugLog("Error in generate_weekly_regression_stability_report", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error generating weekly regression stability report: ${error.message}`
          }]
        };
      }
    }
  );

  server.registerTool(
    "get_launch_summary",
    {
      description: "📋 Get quick launch summary without detailed test sessions (uses new reporting API)",
    inputSchema: {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      jira_base_url: z.string().url().optional().describe("Override JIRA base URL (e.g., 'https://myproject.atlassian.net'). If not set, resolved from Zebrunner integrations or JIRA_BASE_URL env var"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

  server.registerTool(
    "analyze_regression_runtime",
    {
      description: "📊 Analyze Regression Runtime Efficiency: collects per-launch elapsed time, attempt/re-run breakdown, per-test duration classification (Short / Medium / Long with configurable thresholds), Average Runtime per Test, and Weighted Runtime Index. Supports baseline comparison with a previous milestone or build to track deviation (%). Targets one project per call; aggregate across teams by calling multiple times.",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      milestone: z.string().optional().describe("Milestone name to find launches (e.g., 'develop-49771')"),
      build: z.string().optional().describe("Build identifier / query to find launches"),
      suite_names: z.array(z.string()).optional().describe("Array of suite names to filter launches (partial match, case-insensitive)"),
      launch_ids: z.array(z.number().int().positive()).optional().describe("Explicit launch IDs to analyze (overrides milestone/build/suite_names)"),
      previous_milestone: z.string().optional().describe("Previous milestone name for baseline comparison"),
      previous_build: z.string().optional().describe("Previous build identifier for baseline comparison"),
      include_test_details: z.boolean().default(false).describe("Include per-test duration listing within each duration class"),
      include_attempts_details: z.boolean().default(true).describe("Include detailed re-run attempt breakdown per launch"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      session_resolution: z.enum(['auto', 'per_test', 'launch_level']).default('auto').describe("Session duration resolution strategy: auto (launch-level first, fallback per-test), per_test, or launch_level"),
      medium_threshold_seconds: z.number().int().positive().default(300).describe("Duration threshold (seconds) above which a test is classified as Medium. Default: 300 (5 min)"),
      long_threshold_seconds: z.number().int().positive().default(600).describe("Duration threshold (seconds) above which a test is classified as Long. Default: 600 (10 min)"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
    },
    async (args) => {
      try {
        debugLog("analyze_regression_runtime called", args);

        const { projectId } = await resolveProjectId(args.project);
        const resolvedKey = typeof args.project === 'string'
          ? (PROJECT_ALIASES[args.project] || args.project)
          : undefined;

        return await reportingHandlers.analyzeRegressionRuntime({
          projectKey: resolvedKey,
          projectId,
          milestone: args.milestone,
          build: args.build,
          suiteNames: args.suite_names,
          launchIds: args.launch_ids,
          previousMilestone: args.previous_milestone,
          previousBuild: args.previous_build,
          includeTestDetails: args.include_test_details,
          includeAttemptsDetails: args.include_attempts_details,
          format: args.format,
          session_resolution: args.session_resolution,
          medium_threshold_seconds: args.medium_threshold_seconds,
          long_threshold_seconds: args.long_threshold_seconds,
          chart: args.chart,
          chart_type: args.chart_type,
        });
      } catch (error: any) {
        debugLog("Error in analyze_regression_runtime", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `Error analyzing regression runtime: ${error.message}`
          }]
        };
      }
    }
  );

  server.registerTool(
    "find_flaky_tests",
    {
      description: "🔍 Find flaky tests across launches using a 3-phase approach: (1) cross-launch flip-flop analysis of automated tests, (2) manual-only test case scan via TCM execution history, (3) dual-perspective enrichment of top automated flaky tests with TCM data. Detects tests that oscillate between PASSED/FAILED across multiple launches within a time window.",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      period_days: z.number().int().positive().max(90).default(14).describe("Time window in days to scan for flakiness (default: 14, max: 90)"),
      min_flip_count: z.number().int().positive().default(2).describe("Minimum pass/fail transitions to qualify as flaky (default: 2)"),
      stability_threshold: z.number().min(0).max(100).default(80).describe("Max avg stability % to include — tests above this are considered stable (default: 80)"),
      milestone: z.string().optional().describe("Optional milestone filter for launches"),
      build: z.string().optional().describe("Optional build number filter for launches"),
      suite_names: z.array(z.string()).optional().describe("Optional suite names to scope the manual test scan (Phase 2)"),
      include_manual: z.boolean().default(true).describe("Scan manual-only test cases via TCM execution history (Phase 2)"),
      enrich_top_n: z.number().int().min(0).default(10).describe("Number of top automated flaky tests to enrich with TCM data (Phase 3). Set to 0 to skip."),
      limit: z.number().int().positive().max(200).default(50).describe("Max flaky tests to return"),
      include_history: z.boolean().default(false).describe("Include per-test execution timeline with dates, statuses, and MANUAL/AUTOMATED type"),
      format: z.enum(['json', 'string', 'jira']).default('json').describe("Output format: json, markdown string, or Jira wiki markup"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the count of automated flaky tests found (Phase 1 only). Skips Phase 2/3."
      ),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a bar chart of top flaky tests by flip count. " +
        "'png' returns a base64 PNG image, 'html' returns Chart.js page, 'text' returns ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      )
    }
    },
    async (args) => {
      try {
        debugLog("find_flaky_tests called", args);
        const { projectId } = await resolveProjectId(args.project);
        const projectKey = typeof args.project === 'string'
          ? (PROJECT_ALIASES[args.project] || args.project)
          : undefined;
        return await reportingHandlers.findFlakyTests({
          projectKey: projectKey,
          projectId,
          period_days: args.period_days,
          min_flip_count: args.min_flip_count,
          stability_threshold: args.stability_threshold,
          milestone: args.milestone,
          build: args.build,
          suite_names: args.suite_names,
          include_manual: args.include_manual,
          enrich_top_n: args.enrich_top_n,
          limit: args.limit,
          include_history: args.include_history,
          format: args.format,
          count_only: args.count_only,
          chart: args.chart,
          chart_type: args.chart_type,
        });
      } catch (error: any) {
        debugLog("Error in find_flaky_tests", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error finding flaky tests: ${error.message}`
          }]
        };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // Universal Report Generator
  // ═══════════════════════════════════════════════════════════════════
  server.registerTool(
    "generate_report",
    {
      description: "📊 (Beta) Universal report generator. Supports 6 report types: quality_dashboard (HTML+Markdown with 6 panels), coverage (per-suite test coverage table), pass_rate (per-platform with targets), runtime_efficiency (with delta vs previous milestone), executive_dashboard (standup-ready combined report), release_readiness (Go/No-Go assessment). Can generate single or multiple reports per call.",
    inputSchema: {
      report_types: z.array(z.enum([
        'quality_dashboard', 'coverage', 'pass_rate',
        'runtime_efficiency', 'executive_dashboard', 'release_readiness'
      ])).min(1).describe(
        "Report type(s) to generate. Can request multiple in one call."
      ),
      projects: z.array(z.string()).min(1).describe(
        "Project aliases or keys (e.g., ['android', 'ios'] or ['MFPAND', 'MFPIOS'])"
      ),
      period: z.enum(ALL_PERIODS).default("Last 30 Days").describe(
        "Time period for the report data"
      ),
      milestone: z.string().optional().describe(
        "Optional milestone filter (e.g., '25.39.0')"
      ),
      top_bugs_limit: z.number().int().positive().max(50).default(10).optional().describe(
        "Top bugs to show (quality_dashboard, executive_dashboard). Default: 10"
      ),
      sections: z.array(z.enum(['pass_rate', 'runtime', 'coverage', 'bugs', 'milestones', 'flaky'])).optional().describe(
        "Sections for quality_dashboard. Default: all 6"
      ),
      targets: z.record(z.string(), z.number()).optional().describe(
        "Pass rate targets per project (e.g., {\"android\": 90, \"web\": 65}). Defaults: android=90, ios=90, web=65"
      ),
      exclude_suite_patterns: z.array(z.string()).optional().describe(
        "Suite name patterns to exclude from TOTAL REGRESSION in coverage report (e.g., ['MA', 'Critical', 'Performance'])"
      ),
      previous_milestone: z.string().optional().describe(
        "Baseline milestone for delta comparison (runtime_efficiency, release_readiness)"
      ),
    }
    },
    async (args) => {
      try {
        debugLog("generate_report called", args);
        return await reportHandler.generateReport({
          report_types: args.report_types,
          projects: args.projects,
          period: args.period,
          milestone: args.milestone,
          top_bugs_limit: args.top_bugs_limit,
          sections: args.sections,
          targets: args.targets,
          exclude_suite_patterns: args.exclude_suite_patterns,
          previous_milestone: args.previous_milestone,
        });
      } catch (error: any) {
        debugLog("Error in generate_report", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `Error generating report: ${error?.message || error}`
          }]
        };
      }
    }
  );

  server.registerTool(
    "analyze_test_failure",
    {
      description: "🔍 Deep forensic analysis of failed test including logs, screenshots, error classification, and similar failures. 💡 NEW: Compare with last passed execution to see what changed! 💡 TIP: Can be auto-invoked from Zebrunner test URLs like: https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID/tests/TEST_ID",
    inputSchema: {
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
      }).optional().describe("Compare current failure with last passed execution to identify what changed"),
      jira_base_url: z.string().url().optional().describe("Override JIRA base URL (e.g., 'https://myproject.atlassian.net'). If not set, resolved from Zebrunner integrations or JIRA_BASE_URL env var")
    }
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

  server.registerTool(
    "get_test_execution_history",
    {
      description: "📊 Get execution history for a test across multiple launches - shows pass/fail history, last passed execution, and pass rate",
    inputSchema: {
      testId: z.number().int().positive().describe("Test ID"),
      testRunId: z.number().int().positive().describe("Test Run ID / Launch ID containing the test"),
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'MCP') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID - alternative to projectKey"),
      limit: z.number().int().positive().default(10).describe("Number of history items to return (default: 10, max: 50)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total execution count and pass rate without full history data. " +
        "Skips formatting and detailed per-execution output."
      ),
      format: z.enum(['dto', 'json', 'string']).default('string').describe("Output format: dto (structured), json, or string (markdown table)"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

  server.registerTool(
    "download_test_screenshot",
    {
      description: "📸 Download test screenshot with authentication from Zebrunner",
    inputSchema: {
      screenshotUrl: z.string().describe("Screenshot URL (e.g., 'https://your-workspace.zebrunner.com/files/abc123' or '/files/abc123')"),
      testId: z.number().int().positive().optional().describe("Test ID for context"),
      projectKey: z.string().min(1).optional().describe("Project key for context"),
      outputPath: z.string().optional().describe("Custom output path (default: temp directory)"),
      returnBase64: z.boolean().default(false).describe("Return base64 encoded image")
    }
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

  server.registerTool(
    "analyze_screenshot",
    {
      description: "🔍 Analyze test screenshot with OCR and visual analysis - returns image to Claude Vision for detailed analysis",
    inputSchema: {
      screenshotUrl: z.string().optional().describe("Screenshot URL to download and analyze"),
      screenshotPath: z.string().optional().describe("Local path to screenshot file"),
      testId: z.number().int().positive().optional().describe("Test ID for context"),
      enableOCR: z.boolean().default(false).describe("Enable OCR text extraction (slower)"),
      analysisType: z.enum(['basic', 'detailed']).default('detailed').describe("basic=metadata+OCR only, detailed=includes image for Claude Vision"),
      expectedState: z.string().optional().describe("Expected UI state for comparison")
    }
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

  server.registerTool(
    "analyze_test_execution_video",
    {
      description: "🎬 Download and analyze test execution video with Claude Vision - extracts frames, compares with test case, and predicts if failure is bug or test issue. NEW: Analysis depth modes (quick/standard/detailed), parallel frame extraction, similar failures search, and historical trends analysis!",
    inputSchema: {
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
    }
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

  server.registerTool(
    "detailed_analyze_launch_failures",
    {
      description: "🚀 Analyze failed tests WITHOUT linked issues in a launch with grouping, statistics, and recommendations. Automatically analyzes all tests if ≤10, otherwise first 10 (use offset/limit for more). Use filterType: 'all' to include tests with issues. Supports pagination and screenshot analysis. **NEW:** Jira format with smart grouping - creates combined tickets for similar errors! 💡 TIP: Can be auto-invoked from Zebrunner launch URLs like: https://workspace.zebrunner.com/projects/PROJECT/automation-launches/LAUNCH_ID",
    inputSchema: {
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
      limit: z.number().int().positive().default(20).describe("Number of tests to analyze (default: 20, max recommended: 30)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of failed tests (with or without issues) without performing analysis. " +
        "Skips expensive per-test analysis, session lookups, and screenshot processing."
      ),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

  server.registerTool(
    "get_all_launches_for_project",
    {
      description: "📋 Get all launches for a project with pagination (uses new reporting API)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      page: z.number().int().positive().default(1).describe("Page number (starts from 1)"),
      pageSize: z.number().int().positive().max(100).default(20).describe("Number of launches per page (max 100)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of launches without full data. " +
        "Uses API metadata for an efficient single-request count. Bypasses MCP response size limits."
      ),
      format: z.enum(['raw', 'formatted']).default('formatted').describe("Output format - 'raw' for full API response, 'formatted' for user-friendly display"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
    },
    async (args) => {
      try {
        debugLog("get_all_launches_for_project called", args);

        // Resolve project ID using the same logic as other tools
        const { projectId } = await resolveProjectId(args.project);

        if (args.count_only) {
          const countData = await reportingClient.getLaunches(projectId, { page: 1, pageSize: 1 });
          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: countData._meta.total,
            project: args.project
          }, null, 2) }] };
        }

        // Get launches using the new API method
        const launchesData = await reportingClient.getLaunches(projectId, {
          page: args.page,
          pageSize: args.pageSize
        });

        if (args.chart && args.chart !== 'none') {
          const items = launchesData.items || [];
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'stacked_bar',
            title: `Launch Results — ${args.project} (Page ${args.page})`,
            labels: items.map((l: any) => l.name?.slice(0, 20) || `#${l.id}`),
            datasets: [
              { label: 'Passed', values: items.map((l: any) => l.passed || 0), color: '#59a14f' },
              { label: 'Failed', values: items.map((l: any) => l.failed || 0), color: '#e15759' },
              { label: 'Skipped', values: items.map((l: any) => l.skipped || 0), color: '#edc948' },
            ],
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Launch results for ${args.project}: ${launchesData._meta?.total || items.length} total launches`);
        }

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

  server.registerTool(
    "get_all_launches_with_filter",
    {
      description: "🔍 Get launches with filtering by milestone, build number, or launch name (uses new reporting API)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()]).describe("Project alias (web/android/ios/api), project key, or project ID"),
      milestone: z.string().optional().describe("Filter by milestone name (e.g., '25.39.0')"),
      query: z.string().optional().describe("Search query for build number or launch name (e.g., 'your-app-25.39.0-45915' or 'Performance')"),
      page: z.number().int().positive().default(1).describe("Page number (starts from 1)"),
      pageSize: z.number().int().positive().max(100).default(20).describe("Number of launches per page (max 100)"),
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of matching launches without full data. " +
        "Uses API metadata for an efficient single-request count. Bypasses MCP response size limits."
      ),
      format: z.enum(['raw', 'formatted']).default('formatted').describe("Output format - 'raw' for full API response, 'formatted' for user-friendly display"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

        if (args.count_only) {
          const countData = await reportingClient.getLaunches(projectId, {
            page: 1, pageSize: 1,
            milestone: args.milestone,
            query: args.query
          });
          let filterDesc = '';
          if (args.milestone && args.query) filterDesc = `milestone "${args.milestone}" and query "${args.query}"`;
          else if (args.milestone) filterDesc = `milestone "${args.milestone}"`;
          else if (args.query) filterDesc = `query "${args.query}"`;
          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: countData._meta.total,
            project: args.project,
            filter: filterDesc
          }, null, 2) }] };
        }

        // Get launches using the new API method with filters
        const launchesData = await reportingClient.getLaunches(projectId, {
          page: args.page,
          pageSize: args.pageSize,
          milestone: args.milestone,
          query: args.query
        });

                if (args.chart && args.chart !== 'none') {
          const items = launchesData.items || [];
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'stacked_bar',
            title: `Filtered Launches — ${args.project}`,
            labels: items.map((l: any) => l.name?.slice(0, 20) || `#${l.id}`),
            datasets: [
              { label: 'Passed', values: items.map((l: any) => l.passed || 0), color: '#59a14f' },
              { label: 'Failed', values: items.map((l: any) => l.failed || 0), color: '#e15759' },
              { label: 'Skipped', values: items.map((l: any) => l.skipped || 0), color: '#edc948' },
            ],
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Filtered launches for ${args.project}: ${launchesData._meta?.total || items.length} total`);
        }

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

  server.registerTool(
    "test_reporting_connection",
    {
      description: "🔌 Test connection to Zebrunner Reporting API with new authentication",
    },
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

  // === Tool: About MCP Tools (discovery and guidance) ===
  server.registerTool(
    "about_mcp_tools",
    {
      description: "📚 Summarize Zebrunner MCP tools or show detailed info for one tool with examples and approximate token usage",
      inputSchema: {
        mode: z.enum(["summary", "tool"]).default("summary")
          .describe("summary: all tools overview; tool: detailed view for one tool"),
        tool_name: z.string().optional()
          .describe("Tool name for detailed mode, e.g. analyze_test_execution_video"),
        include_examples: z.boolean().default(true)
          .describe("Include example prompts"),
        include_token_estimates: z.boolean().default(true)
          .describe("Include approximate token usage ranges"),
        include_role_benefits: z.boolean().default(true)
          .describe("Include role-based value summary")
      }
    },
    async (args) => {
      try {
        debugLog("about_mcp_tools called", args);
        const snapshot = loadToolIntelSnapshot();

        if (args.mode === "tool") {
          if (!args.tool_name) {
            return {
              content: [{
                type: "text" as const,
                text: "❌ tool_name is required when mode='tool'"
              }]
            };
          }
          const details = markdownForToolDetails(snapshot, args.tool_name, {
            includeExamples: args.include_examples,
            includeTokenEstimates: args.include_token_estimates,
            includeRoleBenefits: args.include_role_benefits
          });
          return { content: [{ type: "text" as const, text: details }] };
        }

        const summary = markdownForAllTools(snapshot, {
          includeExamples: args.include_examples,
          includeTokenEstimates: args.include_token_estimates,
          includeRoleBenefits: args.include_role_benefits
        });

        return { content: [{ type: "text" as const, text: summary }] };
      } catch (error: any) {
        debugLog("Error in about_mcp_tools", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error in about_mcp_tools: ${error?.message || error}`
          }]
        };
      }
    }
  );

  // ========== ZEBRUNNER WIDGET TOOLS ==========

  // === Tool #1: Platform test results by period ===
  server.registerTool(
    "get_platform_results_by_period",
    {
      description: "📊 Get test results by platform for a given period (SQL widget, templateId: 8)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      period: z.enum(ALL_PERIODS)
        .default("Last 7 Days")
        .describe("Time period (passed to widget as-is)"),
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
      format: z.enum(['raw', 'formatted']).default('formatted'),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

        if (args.chart && args.chart !== 'none') {
          const rows: any[] = Array.isArray(data) ? data : [];
          if (rows.length > 0) {
            const sampleKeys = Object.keys(rows[0]);
            debugLog("Platform chart: row keys", sampleKeys);

            // Auto-discover label column: first column whose value is a non-numeric string
            const labelKey = sampleKeys.find(k => {
              const v = rows[0][k];
              return typeof v === 'string' && isNaN(Number(v));
            }) ?? sampleKeys[0];

            // Auto-discover numeric dataset columns (passed, failed, skipped, etc.)
            const numericKeys = sampleKeys.filter(k => {
              if (k === labelKey) return false;
              const v = rows[0][k];
              return typeof v === 'number' || (typeof v === 'string' && !isNaN(Number(v)) && v !== '');
            });

            const labels = rows.map((r: any) => String(r[labelKey] ?? 'Unknown'));

            const statusColors: Record<string, string> = {
              passed: '#59a14f', failed: '#e15759', skipped: '#f28e2b',
              aborted: '#bab0ac', known_issue: '#edc948', in_progress: '#76b7b2',
              queued: '#b07aa1',
            };

            const datasets = numericKeys.map(k => ({
              label: k.charAt(0).toUpperCase() + k.slice(1).toLowerCase(),
              values: rows.map((r: any) => parseInt(r[k] || '0')),
              color: statusColors[k.toLowerCase()] ?? undefined,
            }));

            const chartConfig: ChartConfig = {
              type: args.chart_type !== 'auto' ? args.chart_type : 'stacked_bar',
              title: `Platform Results (${args.period})`,
              labels,
              datasets,
            };
            return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Platform results for ${args.period}`);
          }
          return { content: [{ type: "text" as const, text: "No platform data to chart." }] };
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
  server.registerTool(
    "get_top_bugs",
    {
      description: "🐞 Top N most frequent defects with optional issue links (SQL widget, templateId: 4)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      period: z.enum(ALL_PERIODS)
        .default("Last 7 Days")
        .describe("Time period (passed to widget as-is)"),
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
      format: z.enum(['raw', 'formatted']).default('formatted'),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

        if (args.chart && args.chart !== 'none') {
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'horizontal_bar',
            title: `Top ${top.length} Bugs (${args.period})`,
            labels: top.map((b: any) => b.key),
            datasets: [{ label: 'Failures', values: top.map((b: any) => b.failures) }],
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Top ${top.length} bugs for ${args.period}`);
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
  server.registerTool(
    "get_bug_review",
    {
      description: "🔍 Get detailed bug review with failures, defects, reproduction dates, and optional automatic failure detail fetching (SQL widget, templateId: 9)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      period: z.enum(ALL_PERIODS)
        .default("Last 7 Days")
        .describe("Time period for bug review (passed to widget as-is)"),
      limit: z.number().int().positive().max(500)
        .default(100)
        .describe("Maximum number of bugs to return (default: 100, max: 500)"),
      include_failure_details: z.boolean()
        .default(false)
        .describe("When true, automatically fetches detailed failure info for each bug (affected test runs, error details). Enables comprehensive single-call analysis."),
      failure_detail_level: z.enum(['none', 'summary', 'full'])
        .default('summary')
        .describe("Level of failure details: none (just bug list), summary (error + count), full (all affected test runs)"),
      max_details_limit: z.number().int().positive().max(50)
        .default(30)
        .describe("Maximum bugs to fetch detailed failure info for (default: 30, max: 50). Prevents excessive API calls."),
      templateId: z.number()
        .default(TEMPLATE.BUG_REVIEW)
        .describe("Override templateId if needed (default: 9 for Bug Review)"),
      format: z.enum(['detailed', 'summary', 'json']).default('detailed')
        .describe("Output format: detailed (full info with markdown links), summary (concise), or json (raw data)"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      )
    }
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
            lastRepro: row.REPRO || "Unknown",
            // Placeholder for failure details (populated if include_failure_details is true)
            failureDetails: null as any
          };
        });

        // Fetch detailed failure information if requested
        if (args.include_failure_details && args.failure_detail_level !== 'none') {
          const bugsToFetch = bugs.slice(0, args.max_details_limit).filter(bug => bug.hashcode);
          
          debugLog(`Fetching failure details for ${bugsToFetch.length} bugs in parallel`);
          
          // Fetch failure details in parallel for all bugs with hashcodes
          const detailPromises = bugsToFetch.map(async (bug) => {
            try {
              const failureInfoParams = {
                PERIOD: args.period,
                dashboardName: "Failures analysis",
                hashcode: bug.hashcode,
                isReact: true
              };

              const failureDetailsParams = {
                PERIOD: args.period,
                dashboardName: "Failures analysis",
                hashcode: bug.hashcode,
                isReact: true
              };

              // Fetch both widgets in parallel
              const [failureInfoRaw, failureDetailsRaw] = await Promise.all([
                callWidgetSql(projectId, TEMPLATE.FAILURE_INFO, failureInfoParams),
                args.failure_detail_level === 'full' 
                  ? callWidgetSql(projectId, TEMPLATE.FAILURE_DETAILS, failureDetailsParams)
                  : Promise.resolve([])
              ]);

              const failureInfo: any[] = Array.isArray(failureInfoRaw) ? failureInfoRaw : [];
              const failureDetails: any[] = Array.isArray(failureDetailsRaw) ? failureDetailsRaw : [];

              // Parse failure info (high-level summary)
              const summaryInfo = failureInfo.map(row => ({
                failureCount: row["#"] || "0",
                errorStability: (row["ERROR/STABILITY"] || "").replace(/\\n/g, '\n')
              }));

              // Parse failure details (individual test runs) - only if full level
              const detailsInfo = args.failure_detail_level === 'full' 
                ? failureDetails.slice(0, 20).map(row => { // Limit to 20 test runs per bug
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
                  })
                : [];

              return {
                hashcode: bug.hashcode,
                summary: summaryInfo,
                totalFailures: failureDetails.length,
                failures: detailsInfo
              };
            } catch (error: any) {
              debugLog(`Failed to fetch details for hashcode ${bug.hashcode}`, error.message);
              return {
                hashcode: bug.hashcode,
                summary: [],
                totalFailures: 0,
                failures: [],
                error: error.message
              };
            }
          });

          // Wait for all detail fetches to complete
          const allDetails = await Promise.all(detailPromises);
          
          // Map details back to bugs
          const detailsMap = new Map(allDetails.map(d => [d.hashcode, d]));
          bugs.forEach(bug => {
            if (bug.hashcode && detailsMap.has(bug.hashcode)) {
              bug.failureDetails = detailsMap.get(bug.hashcode);
            }
          });

          debugLog(`Completed fetching failure details for ${allDetails.length} bugs`);
        }

        // Calculate priority and trend analysis
        const priorityAnalysis = analyzeBugPriorities(bugs);

        if (args.chart && args.chart !== 'none') {
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'pie',
            title: `Bug Priority Distribution (${args.period})`,
            labels: ['Critical', 'High', 'Medium', 'Low'],
            datasets: [{
              label: 'Bugs',
              values: [
                priorityAnalysis.critical.length,
                priorityAnalysis.high.length,
                priorityAnalysis.medium.length,
                priorityAnalysis.low.length,
              ],
            }],
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Bug review: ${bugs.length} bugs — Critical: ${priorityAnalysis.critical.length}, High: ${priorityAnalysis.high.length}, Medium: ${priorityAnalysis.medium.length}, Low: ${priorityAnalysis.low.length}`);
        }

        // Helper to format failure details section
        const formatFailureDetails = (bug: any, level: string) => {
          if (!bug.failureDetails || level === 'none') return '';
          
          const details = bug.failureDetails;
          let output = '';
          
          if (details.summary && details.summary.length > 0) {
            const errorPreview = details.summary[0].errorStability?.split('\n').slice(0, 3).join('\n') || '';
            output += `\n**Error Details:**\n\`\`\`\n${errorPreview.substring(0, 500)}${errorPreview.length > 500 ? '...' : ''}\n\`\`\``;
          }
          
          if (level === 'full' && details.failures && details.failures.length > 0) {
            output += `\n\n**Affected Test Runs (${details.totalFailures} total, showing ${details.failures.length}):**\n`;
            output += details.failures.slice(0, 5).map((f: any, i: number) => {
              const testLink = toMarkdownLink(f.testUrl, f.testName || `Test ${f.testId}`);
              return `  ${i + 1}. ${testLink} (Run: ${f.runName})`;
            }).join('\n');
            if (details.failures.length > 5) {
              output += `\n  *...and ${details.failures.length - 5} more*`;
            }
          }
          
          return output;
        };

        // Format output based on format parameter
        if (args.format === 'json') {
          return {
            content: [{ 
              type: "text" as const, 
              text: JSON.stringify({ 
                period: args.period, 
                totalBugs: rows.length,
                returnedBugs: bugs.length,
                includeFailureDetails: args.include_failure_details,
                failureDetailLevel: args.failure_detail_level,
                priorityAnalysis: {
                  critical: priorityAnalysis.critical.length,
                  high: priorityAnalysis.high.length,
                  medium: priorityAnalysis.medium.length,
                  low: priorityAnalysis.low.length,
                  statistics: priorityAnalysis.statistics,
                  trends: {
                    recentlyIntroduced: priorityAnalysis.trends.recentlyIntroduced.length,
                    longStanding: priorityAnalysis.trends.longStanding.length,
                    frequentlyReproduced: priorityAnalysis.trends.frequentlyReproduced.length
                  }
                },
                bugs: bugs.map(b => ({
                  ...b,
                  failureDetails: b.failureDetails || undefined
                }))
              }, null, 2) 
            }]
          };
        }

        if (args.format === 'summary') {
          const summary = `📋 **Bug Review Summary** (${args.period})

**Total Bugs Found:** ${rows.length}
**Showing:** ${bugs.length} bugs

---

## 🎯 Priority Summary

${priorityAnalysis.prioritySummary}

---

## 🔝 Top Issues

${bugs.slice(0, 10).map(bug => {
  const defectLink = toMarkdownLink(bug.defectUrl, bug.defectKey);
  const failureLink = toMarkdownLink(bug.failureUrl, `${bug.failureCount} failures`);
  const priority = priorityAnalysis.critical.some((b: any) => b.hashcode === bug.hashcode) ? '🔴' :
                   priorityAnalysis.high.some((b: any) => b.hashcode === bug.hashcode) ? '🟠' :
                   priorityAnalysis.medium.some((b: any) => b.hashcode === bug.hashcode) ? '🟡' : '🟢';
  return `${priority} **${bug.rank}. ${defectLink}** - ${failureLink}
   First seen: ${bug.since} | Last repro: ${bug.lastRepro}
   \`${bug.reason.split('\n')[0].substring(0, 100)}${bug.reason.length > 100 ? '...' : ''}\`${formatFailureDetails(bug, args.failure_detail_level)}`;
}).join('\n\n')}

${bugs.length > 10 ? `\n---\n\n*...and ${bugs.length - 10} more bugs*` : ''}`;

          return {
            content: [{ type: "text" as const, text: summary }]
          };
        }

        // Detailed format (default)
        const detailed = `🔍 **Comprehensive Bug Review** (${args.period})

## 📊 Executive Summary

**Total Bugs Found:** ${rows.length}
**Showing:** ${bugs.length} bugs
${args.include_failure_details ? `**Failure Details Fetched:** ${bugs.filter(b => b.failureDetails).length} bugs` : ''}

---

## 🎯 Priority Analysis

${priorityAnalysis.prioritySummary}

---

## 🐞 Bug Details

${bugs.map(bug => {
  const projectLink = toMarkdownLink(bug.projectUrl, bug.project);
  const defectLink = toMarkdownLink(bug.defectUrl, bug.defectKey);
  const failureLink = toMarkdownLink(bug.failureUrl, `View ${bug.failureCount} failures`);
  
  // Determine priority emoji
  const priority = priorityAnalysis.critical.some((b: any) => b.hashcode === bug.hashcode) ? '🔴 CRITICAL' :
                   priorityAnalysis.high.some((b: any) => b.hashcode === bug.hashcode) ? '🟠 HIGH' :
                   priorityAnalysis.medium.some((b: any) => b.hashcode === bug.hashcode) ? '🟡 MEDIUM' : '🟢 LOW';
  
  // Truncate reason to first 200 chars of first line for readability
  const reasonPreview = bug.reason.split('\n')[0];
  const truncatedReason = reasonPreview.length > 200 
    ? reasonPreview.substring(0, 200) + '...' 
    : reasonPreview;
  
  return `### ${bug.rank}. ${defectLink} [${priority}]

**Project:** ${projectLink}
**Failures:** ${failureLink}
**First Seen:** ${bug.since}
**Last Reproduced:** ${bug.lastRepro}

**Failure Reason:**
\`\`\`
${truncatedReason}
\`\`\`
${formatFailureDetails(bug, args.failure_detail_level)}`;
}).join('\n\n---\n\n')}

---

## 📈 Recommendations

${priorityAnalysis.critical.length > 0 ? `1. **Address ${priorityAnalysis.critical.length} CRITICAL bugs immediately** - These are causing significant test failures` : ''}
${priorityAnalysis.high.length > 0 ? `${priorityAnalysis.critical.length > 0 ? '2' : '1'}. **Plan to fix ${priorityAnalysis.high.length} HIGH priority bugs** - Schedule for current sprint` : ''}
${priorityAnalysis.trends.longStanding.length > 5 ? `- **Tech Debt Alert:** ${priorityAnalysis.trends.longStanding.length} bugs are older than 30 days` : ''}
${priorityAnalysis.statistics.withoutDefects > 0 ? `- **Tracking Gap:** ${priorityAnalysis.statistics.withoutDefects} bugs have no linked defects - consider creating tickets` : ''}`;

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
  server.registerTool(
    "get_bug_failure_info",
    {
      description: "🔬 Get comprehensive failure information including failure summary and detailed test runs (SQL widgets, templateId: 6 & 10)",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string(), z.number()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api'), project key, or numeric projectId"),
      dashboardId: z.number()
        .describe("Dashboard ID from bug review (e.g., 99)"),
      hashcode: z.string()
        .describe("Hashcode from bug review failure link (e.g., '1051677506')"),
      period: z.enum(ALL_PERIODS)
        .default("Last 14 Days")
        .describe("Time period for failure analysis (passed to widget as-is)"),
      format: z.enum(['detailed', 'summary', 'json']).default('detailed')
        .describe("Output format: detailed (full info), summary (concise), or json (raw data)")
    }
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
  server.registerTool(
    "get_project_milestones",
    {
      description: "🎯 Get available milestones for a project with pagination and filtering",
    inputSchema: {
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
      count_only: z.boolean().default(false).describe(
        "When true, returns only the total count of milestones matching the status filter. " +
        "For 'all'/'completed' uses efficient API metadata; for 'incomplete'/'overdue' paginates to apply client-side filter."
      ),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data")
    }
    },
    async (args) => {
      try {
        debugLog("get_project_milestones called", args);

        // Resolve project ID with enhanced discovery and suggestions
        const { projectId } = await resolveProjectId(args.project);

        // Helper function to check if a milestone is overdue
        const isOverdue = (milestone: any): boolean => {
          if (!milestone.dueDate || milestone.completed) {
            return false;
          }
          const now = new Date();
          const dueDate = new Date(milestone.dueDate);
          const nowDateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const dueDateOnly = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));
          return dueDateOnly < nowDateOnly;
        };

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

        if (args.count_only) {
          if (args.status === "all" || args.status === "completed") {
            const countData = await reportingClient.getMilestones(projectId, { page: 1, pageSize: 1, completed });
            return { content: [{ type: "text" as const, text: JSON.stringify({
              total_count: countData._meta.total,
              project: args.project,
              status: args.status
            }, null, 2) }] };
          }
          // For "incomplete"/"overdue", need to paginate and apply client-side filter
          let totalFiltered = 0;
          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const pageData = await reportingClient.getMilestones(projectId, { page, pageSize: 100, completed });
            const items = pageData.items || [];
            if (args.status === "incomplete") {
              totalFiltered += items.filter((m: any) => !m.completed && !isOverdue(m)).length;
            } else {
              totalFiltered += items.filter((m: any) => !m.completed && isOverdue(m)).length;
            }
            hasMore = items.length === 100;
            page++;
            if (page > 100) break;
          }
          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalFiltered,
            project: args.project,
            status: args.status,
            pages_traversed: page - 1
          }, null, 2) }] };
        }

        const milestonesData = await reportingClient.getMilestones(projectId, {
          page: args.page,
          pageSize: args.pageSize,
          completed
        });

        // Filter milestones based on status if needed
        let filteredItems = milestonesData.items;
        if (args.status === "incomplete") {
          filteredItems = milestonesData.items.filter(milestone =>
            !milestone.completed && !isOverdue(milestone)
          );
        } else if (args.status === "overdue") {
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
  server.registerTool(
    "get_available_projects",
    {
      description: "🏗️ Discover available projects with their keys and IDs for dynamic project selection",
    inputSchema: {
      starred: z.boolean().optional()
        .describe("Filter by starred projects (true=only starred, false=only non-starred, undefined=all)"),
      publiclyAccessible: z.boolean().optional()
        .describe("Filter by public accessibility (true=only public, false=only private, undefined=all)"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw API response or formatted data"),
      includePaginationInfo: z.boolean().default(false)
        .describe("Include pagination metadata from projects-limit endpoint")
    }
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

  server.registerTool(
    "validate_test_case",
    {
      description: "🔍 Validate a test case against quality standards and best practices (Dynamic Rules Support + Improvement)",
    inputSchema: {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      caseKey: z.string().min(1).describe("Test case key (e.g., 'ANDROID-29')"),
      rulesFilePath: z.string().optional().describe("Path to custom rules markdown file"),
      checkpointsFilePath: z.string().optional().describe("Path to custom checkpoints markdown file"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      improveIfPossible: z.boolean().default(true).describe("Attempt to automatically improve the test case"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
    },
    async (args) => {
      try {
        debugLog("validate_test_case called", args);

        // Import handlers here to avoid circular dependencies
        const { ZebrunnerToolHandlers } = await import("./handlers/tools.js");
        const { ZebrunnerApiClient } = await import("./api/client.js");
        const basicClient = new ZebrunnerApiClient(config);
        const toolHandlers = new ZebrunnerToolHandlers(basicClient);

        const fieldsLayout = await getFieldsLayoutForProject(args.projectKey);
        return await toolHandlers.validateTestCase(args, fieldsLayout);
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

  server.registerTool(
    "improve_test_case",
    {
      description: "🔧 Analyze and improve a test case with detailed suggestions and optional automatic fixes",
    inputSchema: {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      caseKey: z.string().min(1).describe("Test case key (e.g., 'ANDROID-29')"),
      rulesFilePath: z.string().optional().describe("Path to custom rules markdown file"),
      checkpointsFilePath: z.string().optional().describe("Path to custom checkpoints markdown file"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      applyHighConfidenceChanges: z.boolean().default(true).describe("Automatically apply high-confidence improvements"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI")
    }
    },
    async (args) => {
      try {
        debugLog("improve_test_case called", args);

        // Import handlers here to avoid circular dependencies
        const { ZebrunnerToolHandlers } = await import("./handlers/tools.js");
        const { ZebrunnerApiClient } = await import("./api/client.js");
        const basicClient = new ZebrunnerApiClient(config);
        const toolHandlers = new ZebrunnerToolHandlers(basicClient);

        const fieldsLayout = await getFieldsLayoutForProject(args.projectKey);
        return await toolHandlers.improveTestCase(args, fieldsLayout);
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

  server.registerTool(
    "list_test_runs",
    {
      description: "🏃 List Test Runs from Public API with advanced filtering",
    inputSchema: {
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
      count_only: z.boolean().default(false).describe(
        "When true, paginates through all pages and returns only the total count of test runs without data. " +
        "Useful for metrics and dashboards. Bypasses MCP response size limits."
      ),
      format: z.enum(['raw', 'formatted']).default('formatted'),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
    },
    async (args) => {
      try {
        debugLog("list_test_runs called", args);

        // Resolve project using dynamic resolution (same as Reporting API tools)
        const { projectId, suggestions } = await resolveProjectId(args.project);

        // For Public API, we need the project key, not the project ID
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
            milestoneId = args.milestoneFilter;
          } else {
            try {
              const milestonesData = await reportingClient.getMilestones(projectId, {
                page: 1,
                pageSize: 100,
                completed: 'all'
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
          filters.push(`(configurations.optionName ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}' OR title ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}' OR description ~= '${args.buildNumberFilter.replace(/'/g, "\\'")}')`);
        }

        if (args.closedFilter !== undefined) {
          filters.push(`closed = ${args.closedFilter}`);
        }

        const filter = filters.length > 0 ? filters.join(' AND ') : undefined;

        if (args.count_only) {
          let totalCount = 0;
          let pageCount = 0;
          let currentPageToken: string | undefined = undefined;
          do {
            const response = await client.listPublicTestRuns({
              projectKey,
              pageToken: currentPageToken,
              maxPageSize: 100,
              filter,
              sortBy: args.sortBy
            });
            totalCount += (response.items || []).length;
            pageCount++;
            currentPageToken = response._meta?.nextPageToken;
          } while (currentPageToken && pageCount < 1000);

          return { content: [{ type: "text" as const, text: JSON.stringify({
            total_count: totalCount,
            pages_traversed: pageCount,
            project_key: projectKey,
            ...(filter ? { filter } : {})
          }, null, 2) }] };
        }

        const testRunsData = await client.listPublicTestRuns({
          projectKey,
          pageToken: args.pageToken,
          maxPageSize: args.maxPageSize,
          filter,
          sortBy: args.sortBy
        });

        if (args.chart && args.chart !== 'none') {
          const runs = testRunsData.items || [];
          const statusMap: Record<string, number[]> = {};
          runs.forEach((r: any, idx: number) => {
            const details = r.executionSummary?.details || {};
            Object.entries(details).forEach(([status, info]: any) => {
              if (!statusMap[status]) statusMap[status] = new Array(runs.length).fill(0);
              statusMap[status][idx] = info.testCasesCount || 0;
            });
          });
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'stacked_bar',
            title: `Test Runs — ${projectKey}`,
            labels: runs.map((r: any) => r.name?.slice(0, 20) || `Run ${r.id}`),
            datasets: Object.entries(statusMap).map(([status, values]) => ({ label: status, values })),
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `${runs.length} test runs for ${projectKey}`);
        }

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

  server.registerTool(
    "get_test_run_by_id",
    {
      description: "🔍 Get detailed Test Run information by ID from Public API",
    inputSchema: {
      id: z.number().int().positive()
        .describe("Test Run ID"),
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(['raw', 'formatted']).default('formatted'),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

        if (args.chart && args.chart !== 'none') {
          const runData = testRunData as any;
          const summaries = runData?.data?.executionSummaries || runData?.executionSummaries || [];
          const statusCounts: Record<string, number> = {};
          summaries.forEach((s: any) => {
            const status = s.status?.name || 'UNKNOWN';
            statusCounts[status] = (statusCounts[status] || 0) + (s.testCasesCount || 0);
          });
          const entries = Object.entries(statusCounts).filter(([_, v]) => v > 0);
          if (entries.length > 0) {
            const chartConfig: ChartConfig = {
              type: args.chart_type !== 'auto' ? args.chart_type : 'pie',
              title: `Test Run Status — Run ${args.id}`,
              labels: entries.map(([k]) => k),
              datasets: [{ label: 'Test Cases', values: entries.map(([_, v]) => v) }],
            };
            return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Test run ${args.id} status distribution`);
          }
        }

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

  server.registerTool(
    "list_test_run_test_cases",
    {
      description: "📝 List all Test Cases in a Test Run from Public API",
    inputSchema: {
      testRunId: z.number().int().positive()
        .describe("Test Run ID"),
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .default("web")
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(['raw', 'formatted']).default('formatted'),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
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

        if (args.chart && args.chart !== 'none') {
          const statusCounts: Record<string, number> = {};
          (testCasesData.items || []).forEach((tc: any) => {
            const st = tc.resultStatus?.name || tc.status || 'UNKNOWN';
            statusCounts[st] = (statusCounts[st] || 0) + 1;
          });
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'pie',
            title: `Test Case Status — Run ${args.testRunId}`,
            labels: Object.keys(statusCounts),
            datasets: [{ label: 'Test Cases', values: Object.values(statusCounts) }],
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `Test run ${args.testRunId}: ${(testCasesData.items || []).length} test cases`);
        }

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

  server.registerTool(
    "get_test_run_result_statuses",
    {
      description: "Get list of Result Statuses configured for a project. These statuses are used when assigning results to Test Cases.",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(["raw", "formatted"]).default("formatted").describe("Output format")
    }
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

  server.registerTool(
    "get_test_run_configuration_groups",
    {
      description: "Get list of Configuration Groups and their Options for a project. These are used to configure Test Runs.",
    inputSchema: {
      project: z.union([z.enum(["web","android","ios","api"]), z.string()])
        .describe("Project alias ('web', 'android', 'ios', 'api') or project key"),
      format: z.enum(["raw", "formatted"]).default("formatted").describe("Output format")
    }
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

  server.registerTool(
    "analyze_test_cases_duplicates",
    {
      description: "🔍 Analyze test cases for duplicates and group similar ones by step similarity (80-90%)",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'ANDROID', 'IOS')"),
      suite_id: z.number().optional().describe("Optional: Analyze specific test suite ID"),
      test_case_keys: z.array(z.string()).optional().describe("Optional: Analyze specific test case keys instead of suite"),
      similarity_threshold: z.number().min(50).max(100).default(80).describe("Similarity threshold percentage (50-100, default: 80)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      include_similarity_matrix: z.boolean().default(false).describe("Include detailed similarity matrix in output"),
      include_clickable_links: z.boolean().default(false).describe("Include clickable links to Zebrunner web UI (markdown format only)")
    }
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

  server.registerTool(
    "analyze_test_cases_duplicates_semantic",
    {
      description: "🧠 Advanced semantic duplicate analysis using LLM-powered step clustering and two-phase analysis",
    inputSchema: {
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
    }
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

  // ========== AGGREGATE TEST CASES BY FEATURE ==========

  server.registerTool(
    "aggregate_test_cases_by_feature",
    {
      description: "🔍 Find ALL test cases related to a specific feature across the project.\n" +
    "Searches in title, description, preconditions, and test steps (case-insensitive, partial match).\n" +
    "Groups results by Root Suite and Feature Suite, avoiding duplicates.\n" +
    "Output formats: detailed (full hierarchy), short (summary), dto (JSON), test_run_rules (for automation tags)",
    inputSchema: {
      project_key: z.string().min(1).describe("Project key (e.g., 'MCPAND', 'MCP')"),
      feature_keyword: z.string().min(1).describe("Feature keyword to search for (case-insensitive, partial match)"),
      output_format: z.enum(['detailed', 'short', 'dto', 'test_run_rules']).default('short').describe(
        "Output format: detailed, short, dto, or test_run_rules"
      ),
      tags_format: z.enum(['by_root_suite', 'single_line']).default('by_root_suite').describe(
        "TAGS output format: by_root_suite (separate TAGS line per root suite, default) or single_line (all combined on one line)"
      ),
      max_results: z.number().int().positive().max(2000).default(500).describe("Maximum test cases to process"),
      chart: z.enum(['none', 'png', 'html', 'text']).default('none').describe(
        "When set, returns a chart visualization. 'png' = base64 PNG image, 'html' = Chart.js page, 'text' = ASCII chart."
      ),
      chart_type: z.enum(['auto', 'pie', 'bar', 'stacked_bar', 'horizontal_bar', 'line']).default('auto').describe(
        "Chart type override. 'auto' picks the best type for this tool's data. Explicit value forces that chart type."
      ),
    }
    },
    async (args) => {
      const { project_key, feature_keyword, output_format, tags_format, max_results } = args;

      try {
        debugLog("Aggregating test cases by feature", { project_key, feature_keyword, output_format, max_results });

        // Step 1: Get all test cases (short info) for the project
        console.error(`📥 Fetching all test cases for project ${project_key}...`);
        let allShortTestCases: any[] = [];
        let pageToken: string | undefined = undefined;
        let pageCount = 0;
        const maxPages = 100;

        do {
          const result = await client.getTestCases(project_key, {
            size: MAX_PAGE_SIZE,
            pageToken: pageToken
          });

          allShortTestCases.push(...result.items);
          pageToken = result._meta?.nextPageToken;
          pageCount++;

          if (allShortTestCases.length >= max_results) {
            allShortTestCases = allShortTestCases.slice(0, max_results);
            console.error(`⚠️  Limiting to ${max_results} test cases for performance`);
            break;
          }

          debugLog(`Fetched page ${pageCount}`, { itemsCount: result.items.length, totalSoFar: allShortTestCases.length });
        } while (pageToken && pageCount < maxPages);

        console.error(`📊 Found ${allShortTestCases.length} total test cases`);

        // Step 2: Get all suites for hierarchy information
        console.error(`📥 Fetching test suites for hierarchy...`);
        const allSuites = await client.getAllTestSuites(project_key);
        const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
        
        // Build suite lookup maps
        const suiteMap = new Map<number, any>();
        processedSuites.forEach(suite => suiteMap.set(suite.id, suite));

        // Step 3: Filter test cases by title first (fast preliminary filter)
        const keywordLower = feature_keyword.toLowerCase();
        const titleMatches = allShortTestCases.filter(tc => 
          tc.title?.toLowerCase().includes(keywordLower)
        );

        console.error(`🔍 Found ${titleMatches.length} test cases matching by title`);

        // Step 4: For test cases not matching by title, fetch full details and search in body
        const nonTitleMatches = allShortTestCases.filter(tc => 
          !tc.title?.toLowerCase().includes(keywordLower)
        );

        console.error(`📥 Checking ${nonTitleMatches.length} test cases for body matches...`);

        // Fetch full details in batches for body search
        const bodyMatches: any[] = [];
        const batchSize = 10;
        
        for (let i = 0; i < nonTitleMatches.length; i += batchSize) {
          const batch = nonTitleMatches.slice(i, i + batchSize);
          
          const batchResults = await Promise.allSettled(
            batch.map(async (tc) => {
              try {
                const fullTC = await client.getTestCaseByKey(project_key, tc.key);
                
                // Search in description, preconditions, and steps
                const description = fullTC.description?.toLowerCase() || '';
                const preconditions = fullTC.preConditions?.toLowerCase() || '';
                const postConditions = fullTC.postConditions?.toLowerCase() || '';
                
                // Search in steps
                let stepsText = '';
                if (fullTC.steps && Array.isArray(fullTC.steps)) {
                  stepsText = fullTC.steps.map((step: any) => {
                    const action = step.action || step.actionText || step.step || step.instruction || '';
                    const expected = step.expected || step.expectedResult || step.expectedText || '';
                    return `${action} ${expected}`;
                  }).join(' ').toLowerCase();
                }

                const bodyContent = `${description} ${preconditions} ${postConditions} ${stepsText}`;
                
                if (bodyContent.includes(keywordLower)) {
                  return { ...tc, _fullTC: fullTC, _matchedIn: 'body' };
                }
                return null;
              } catch (error) {
                // Skip test cases we can't fetch
                return null;
              }
            })
          );

          const successfulMatches = batchResults
            .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
            .map(r => r.value);
          
          bodyMatches.push(...successfulMatches);

          // Progress indicator
          if ((i + batchSize) % 50 === 0 || i + batchSize >= nonTitleMatches.length) {
            console.error(`   Checked ${Math.min(i + batchSize, nonTitleMatches.length)}/${nonTitleMatches.length} test cases...`);
          }

          // Small delay to avoid rate limiting
          if (i + batchSize < nonTitleMatches.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        console.error(`🔍 Found ${bodyMatches.length} additional test cases matching in body`);

        // Step 5: Combine all matches and deduplicate
        const allMatches = [...titleMatches.map(tc => ({ ...tc, _matchedIn: 'title' })), ...bodyMatches];
        
        // Deduplicate by test case ID
        const seenIds = new Set<number>();
        const uniqueMatches = allMatches.filter(tc => {
          if (seenIds.has(tc.id)) {
            return false;
          }
          seenIds.add(tc.id);
          return true;
        });

        console.error(`✅ Total unique matches: ${uniqueMatches.length}`);

        if (uniqueMatches.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No test cases found matching feature keyword "${feature_keyword}" in project ${project_key}`
            }]
          };
        }

        // Step 6: Enrich matches with hierarchy information
        const enrichedMatches = uniqueMatches.map(tc => {
          const featureSuiteId = tc.featureSuiteId || tc.testSuite?.id;
          const featureSuite = featureSuiteId ? suiteMap.get(featureSuiteId) : null;
          
          // Get root suite
          const rootSuiteId = featureSuite?.rootSuiteId || HierarchyProcessor.getRootId(processedSuites, featureSuiteId || 0);
          const rootSuite = suiteMap.get(rootSuiteId);
          
          // Get full path
          const suitePath = featureSuiteId ? HierarchyProcessor.generateSuitePath(featureSuiteId, processedSuites) : '';

          return {
            id: tc.id,
            key: tc.key,
            title: tc.title,
            featureSuiteId: featureSuiteId,
            featureSuiteName: featureSuite?.name || featureSuite?.title || 'Unknown Suite',
            rootSuiteId: rootSuiteId,
            rootSuiteName: rootSuite?.name || rootSuite?.title || 'Unknown Root Suite',
            suitePath: suitePath,
            matchedIn: tc._matchedIn
          };
        });

        // Step 7: Group by root suite and feature suite
        const rootSuiteGroups = new Map<number, {
          rootSuiteId: number;
          rootSuiteName: string;
          featureSuites: Map<number, {
            featureSuiteId: number;
            featureSuiteName: string;
            testCases: any[];
          }>;
        }>();

        for (const tc of enrichedMatches) {
          if (!rootSuiteGroups.has(tc.rootSuiteId)) {
            rootSuiteGroups.set(tc.rootSuiteId, {
              rootSuiteId: tc.rootSuiteId,
              rootSuiteName: tc.rootSuiteName,
              featureSuites: new Map()
            });
          }
          
          const rootGroup = rootSuiteGroups.get(tc.rootSuiteId)!;
          
          if (!rootGroup.featureSuites.has(tc.featureSuiteId)) {
            rootGroup.featureSuites.set(tc.featureSuiteId, {
              featureSuiteId: tc.featureSuiteId,
              featureSuiteName: tc.featureSuiteName,
              testCases: []
            });
          }
          
          rootGroup.featureSuites.get(tc.featureSuiteId)!.testCases.push(tc);
        }

        // Collect all unique feature suite IDs
        const allFeatureSuiteIds = new Set<number>();
        enrichedMatches.forEach(tc => {
          if (tc.featureSuiteId) {
            allFeatureSuiteIds.add(tc.featureSuiteId);
          }
        });

                // Chart output
        if (args.chart && args.chart !== 'none') {
          const groupLabels: string[] = [];
          const groupCounts: number[] = [];
          for (const [, group] of rootSuiteGroups) {
            groupLabels.push(group.rootSuiteName);
            let count = 0;
            for (const [, fs] of group.featureSuites) count += fs.testCases.length;
            groupCounts.push(count);
          }
          const chartConfig: ChartConfig = {
            type: args.chart_type !== 'auto' ? args.chart_type : 'bar',
            title: `Test Cases by Feature — "${feature_keyword}" in ${project_key}`,
            labels: groupLabels,
            datasets: [{ label: 'Test Cases', values: groupCounts }],
          };
          return buildChartResponse(chartConfig, args.chart as 'png' | 'html' | 'text', `${uniqueMatches.length} test cases matching "${feature_keyword}" across ${groupLabels.length} root suites`);
        }

// Step 8: Format output based on requested format
        let output = '';

        if (output_format === 'test_run_rules') {
          // Format: RootSuiteId (Name) and TAGS line with all featureSuiteIds
          output = `# Test Run Rules for Feature: "${feature_keyword}"\n\n`;
          output += `## Summary\n`;
          output += `- Total Test Cases: ${uniqueMatches.length}\n`;
          output += `- Root Suites: ${rootSuiteGroups.size}\n`;
          output += `- Feature Suites: ${allFeatureSuiteIds.size}\n\n`;

          // List all root suites
          output += `## Root Suites\n`;
          for (const [rootId, rootGroup] of rootSuiteGroups) {
            output += `- RootSuiteId: ${rootId} (${rootGroup.rootSuiteName})\n`;
          }
          output += `\n`;

          // Generate TAGS - either by root suite or as single combined line
          output += `## Automation Tags\n\n`;
          
          if (tags_format === 'by_root_suite') {
            // Group featureSuiteIds by root suite
            for (const [rootId, rootGroup] of rootSuiteGroups) {
              const rootFeatureSuiteIds = Array.from(rootGroup.featureSuites.keys()).sort((a, b) => a - b);
              const tagsLine = rootFeatureSuiteIds.map(id => `featureSuiteId=${id}`).join('||');
              
              output += `**${rootGroup.rootSuiteName}** (RootSuiteId: ${rootId})\n`;
              output += `\`\`\`\n`;
              output += `TAGS=>${tagsLine}\n`;
              output += `\`\`\`\n\n`;
            }
          } else {
            // Single line with all featureSuiteIds combined
            const featureSuiteIdArray = Array.from(allFeatureSuiteIds).sort((a, b) => a - b);
            const tagsLine = featureSuiteIdArray.map(id => `featureSuiteId=${id}`).join('||');
            output += `\`\`\`\n`;
            output += `TAGS=>${tagsLine}\n`;
            output += `\`\`\`\n`;
          }

        } else if (output_format === 'dto') {
          // JSON format with all data
          const dto = {
            featureKeyword: feature_keyword,
            projectKey: project_key,
            summary: {
              totalTestCases: uniqueMatches.length,
              totalRootSuites: rootSuiteGroups.size,
              totalFeatureSuites: allFeatureSuiteIds.size,
              matchedByTitle: enrichedMatches.filter(tc => tc.matchedIn === 'title').length,
              matchedByBody: enrichedMatches.filter(tc => tc.matchedIn === 'body').length
            },
            featureSuiteIds: Array.from(allFeatureSuiteIds).sort((a, b) => a - b),
            rootSuites: Array.from(rootSuiteGroups.values()).map(rg => ({
              rootSuiteId: rg.rootSuiteId,
              rootSuiteName: rg.rootSuiteName,
              featureSuites: Array.from(rg.featureSuites.values()).map(fs => ({
                featureSuiteId: fs.featureSuiteId,
                featureSuiteName: fs.featureSuiteName,
                testCaseCount: fs.testCases.length,
                testCases: fs.testCases.map(tc => ({
                  id: tc.id,
                  key: tc.key,
                  title: tc.title,
                  matchedIn: tc.matchedIn
                }))
              }))
            })),
            testRunRuleTags: tags_format === 'by_root_suite'
              ? Array.from(rootSuiteGroups.entries()).map(([rootId, rootGroup]) => ({
                  rootSuiteId: rootId,
                  rootSuiteName: rootGroup.rootSuiteName,
                  tags: `TAGS=>${Array.from(rootGroup.featureSuites.keys()).sort((a, b) => a - b).map(id => `featureSuiteId=${id}`).join('||')}`
                }))
              : `TAGS=>${Array.from(allFeatureSuiteIds).sort((a, b) => a - b).map(id => `featureSuiteId=${id}`).join('||')}`
          };
          
          output = JSON.stringify(dto, null, 2);

        } else if (output_format === 'short') {
          // Short format: Root Suite -> Direct Parent -> TestCaseKey + Name
          output = `# Test Cases for Feature: "${feature_keyword}"\n\n`;
          output += `**Summary:** ${uniqueMatches.length} test cases | ${rootSuiteGroups.size} root suites | ${allFeatureSuiteIds.size} feature suites\n\n`;

          for (const [rootId, rootGroup] of rootSuiteGroups) {
            output += `## 📁 ${rootGroup.rootSuiteName} (ID: ${rootId})\n\n`;
            
            for (const [featureId, featureGroup] of rootGroup.featureSuites) {
              output += `### 📂 ${featureGroup.featureSuiteName} (featureSuiteId: ${featureId})\n`;
              
              for (const tc of featureGroup.testCases) {
                const matchIcon = tc.matchedIn === 'title' ? '📌' : '📝';
                output += `- ${matchIcon} **${tc.key}** - ${tc.title}\n`;
              }
              output += `\n`;
            }
          }

        } else if (output_format === 'detailed') {
          // Detailed format with full hierarchy
          output = `# Detailed Test Case Analysis for Feature: "${feature_keyword}"\n\n`;
          output += `## Summary\n`;
          output += `- **Feature Keyword:** ${feature_keyword}\n`;
          output += `- **Project:** ${project_key}\n`;
          output += `- **Total Test Cases Found:** ${uniqueMatches.length}\n`;
          output += `- **Matched by Title:** ${enrichedMatches.filter(tc => tc.matchedIn === 'title').length}\n`;
          output += `- **Matched by Body:** ${enrichedMatches.filter(tc => tc.matchedIn === 'body').length}\n`;
          output += `- **Root Suites:** ${rootSuiteGroups.size}\n`;
          output += `- **Feature Suites:** ${allFeatureSuiteIds.size}\n\n`;

          output += `## Feature Suite IDs\n`;
          output += `\`${Array.from(allFeatureSuiteIds).sort((a, b) => a - b).join(', ')}\`\n\n`;

          for (const [rootId, rootGroup] of rootSuiteGroups) {
            output += `---\n`;
            output += `## 🏠 Root Suite: ${rootGroup.rootSuiteName}\n`;
            output += `- **Root Suite ID:** ${rootId}\n`;
            output += `- **Feature Suites in this Root:** ${rootGroup.featureSuites.size}\n\n`;
            
            for (const [featureId, featureGroup] of rootGroup.featureSuites) {
              output += `### 📁 Feature Suite: ${featureGroup.featureSuiteName}\n`;
              output += `- **Feature Suite ID:** ${featureId}\n`;
              output += `- **Test Cases:** ${featureGroup.testCases.length}\n\n`;
              
              output += `| Key | Title | Full Path | Match Type |\n`;
              output += `|-----|-------|-----------|------------|\n`;
              
              for (const tc of featureGroup.testCases) {
                const matchType = tc.matchedIn === 'title' ? '📌 Title' : '📝 Body';
                output += `| ${tc.key} | ${tc.title} | ${tc.suitePath} | ${matchType} |\n`;
              }
              output += `\n`;
            }
          }

          // Add test run rules at the end
          output += `---\n`;
          output += `## 🏷️ Test Run Rules (Copy-Ready)\n\n`;
          
          if (tags_format === 'by_root_suite') {
            // Group by root suite
            for (const [rootId, rootGroup] of rootSuiteGroups) {
              const rootFeatureSuiteIds = Array.from(rootGroup.featureSuites.keys()).sort((a, b) => a - b);
              const tagsLine = rootFeatureSuiteIds.map(id => `featureSuiteId=${id}`).join('||');
              
              output += `**${rootGroup.rootSuiteName}** (RootSuiteId: ${rootId})\n`;
              output += `\`\`\`\n`;
              output += `TAGS=>${tagsLine}\n`;
              output += `\`\`\`\n\n`;
            }
          } else {
            // Single line with all combined
            const detailedFeatureSuiteIdArray = Array.from(allFeatureSuiteIds).sort((a, b) => a - b);
            output += `\`\`\`\n`;
            output += `TAGS=>${detailedFeatureSuiteIdArray.map(id => `featureSuiteId=${id}`).join('||')}\n`;
            output += `\`\`\`\n`;
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: output
          }]
        };

      } catch (error: any) {
        debugLog("Error in aggregate_test_cases_by_feature", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error aggregating test cases by feature: ${error?.message || error}`
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
