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
const EXPERIMENTAL_FEATURES = appConfig.experimentalFeatures;
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
const reportingHandlers = new ZebrunnerReportingToolHandlers(reportingClient);

// === Widget mini-config ===
const WIDGET_BASE_URL = ZEBRUNNER_URL.replace('/api/public/v1', '');

// Project aliases mapping to project keys (dynamically resolved to IDs)
const PROJECT_ALIASES: Record<string, string> = {
  web: "MFPWEB", android: "MFPAND", ios: "MFPIOS", api: "MFPAPI"
};

const PERIODS = ["Last 7 Days","Week","Month"] as const;

const PLATFORM_MAP: Record<string, string[]> = {
  web: [],        // web often uses BROWSER instead
  api: ["api"],
  android: [],
  ios: ["ios"]
};

const TEMPLATE = {
  RESULTS_BY_PLATFORM: 8,
  TOP_BUGS: 4
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
  dashboardName?: string;        // optional override
  extra?: Partial<Record<string, any>>;
}) {
  const { period, platform, browser = [], dashboardName, extra = {} } = opts;

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
    RUN: [], USER: [], ENV: [], MILESTONE: [],
    PLATFORM: resolvedPlatform,
    STATUS: [], LOCALE: [],
    PERIOD: period,
    dashboardName: dashboardName ?? "Weekly results",
    isReact: true,
    ...extra
  };
}

/** Enhanced markdown rendering with debug info */
async function renderTestCaseMarkdown(
  testCase: ZebrunnerTestCase, 
  includeDebugInfo: boolean = false,
  includeSuiteHierarchy: boolean = false,
  projectKey?: string
): Promise<string> {
  let markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
  
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
async function formatCoverageAnalysis(analysis: any, outputFormat: string, filePath?: string): Promise<any> {
  const chatResponse = generateChatResponse(analysis);
  
  return {
    chatResponse,
    markdownContent: outputFormat.includes('markdown') ? chatResponse : '',
    codeComments: outputFormat.includes('code_comments') ? generateCodeComments(analysis) : ''
  };
}

/** Generate chat response format */
function generateChatResponse(analysis: any): string {
  const testCase = analysis.testCase;
  const coverage = analysis.coverage;
  
  let response = `# 🔍 Test Coverage Analysis: ${testCase.key}\n\n`;
  response += `**Test Case**: ${testCase.title}\n`;
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
    experimental: EXPERIMENTAL_FEATURES,
    reportingApiEnabled: true
  });

  // ========== CORE WORKING FEATURES ==========

  server.tool(
    "list_test_suites",
    "📋 List test suites for a project (✅ Verified Working)",
    {
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      project_id: z.number().int().positive().optional().describe("Project ID (alternative to project_key)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      include_hierarchy: z.boolean().default(false).describe("Include hierarchy information")
    },
    async (args) => {
      const { project_key, project_id, format, include_hierarchy } = args;
      
      try {
        debugLog("Listing test suites", { project_key, project_id, format, include_hierarchy });
        
        if (!project_key && !project_id) {
          throw new Error('Either project_key or project_id must be provided');
        }

        const suites = await client.getTestSuites(project_key || '', { projectId: project_id });
        
        if (!validateApiResponse(suites, 'array')) {
          throw new Error('Invalid API response format');
        }

        let processedSuites = suites.items || suites;
        
        if (include_hierarchy) {
          debugLog("Processing hierarchy for suites", { count: processedSuites.length });
          processedSuites = HierarchyProcessor.enrichSuitesWithHierarchy(processedSuites);
        }

        const formattedData = FormatProcessor.format(processedSuites, format);
        
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
      project_key: z.string().min(1).optional().describe("Project key (e.g., MFPAND) - auto-detected from case_key if not provided"),
      case_key: z.string().min(1).describe("Test case key (e.g., MFPAND-29, MFPIOS-2)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      include_debug: z.boolean().default(false).describe("Include debug information in markdown"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId with suite hierarchy path")
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
      
      const { project_key, case_key, format, include_debug, include_suite_hierarchy } = resolvedArgs;
      
      try {
        debugLog("Getting test case by key", { project_key, case_key, format, include_suite_hierarchy });
        
        const testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });
        
        if (!testCase) {
          throw new Error(`Test case ${case_key} not found`);
        }

        if (format === 'markdown') {
          const markdown = await renderTestCaseMarkdown(testCase, include_debug, include_suite_hierarchy, project_key);
          return {
            content: [{
              type: "text" as const,
              text: markdown
            }]
          };
        }

        const formattedData = FormatProcessor.format(testCase, format);
        
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
    "📊 Advanced test case retrieval with filtering and pagination",
    {
      project_key: z.string().min(1).describe("Project key"),
      suite_id: z.number().int().positive().optional().describe("Filter by suite ID"),
      root_suite_id: z.number().int().positive().optional().describe("Filter by root suite ID"),
      include_steps: z.boolean().default(false).describe("Include detailed test steps"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(100).default(10).describe("Page size (configurable via MAX_PAGE_SIZE env var)")
    },
    async (args) => {
      const { project_key, suite_id, root_suite_id, include_steps, format, page, size } = args;
      
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
        debugLog("Getting advanced test cases", args);
        
        const searchParams = {
          page,
          size,
          suiteId: suite_id,
          rootSuiteId: root_suite_id
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
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      const { project_key, root_suite_id, max_depth, format } = args;
      
      try {
        debugLog("Building suite hierarchy", args);
        
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
        
        // Limit depth with proper typing
        const limitDepth = (suites: ZebrunnerTestSuite[], currentDepth: number): ZebrunnerTestSuite[] => {
          if (currentDepth >= max_depth) {
            return suites.map(suite => ({ ...suite, children: [] }));
          }

          return suites.map(suite => ({
            ...suite,
            children: suite.children ? limitDepth(suite.children, currentDepth + 1) : []
          }));
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

  // ========== EXPERIMENTAL FEATURES ==========

  if (EXPERIMENTAL_FEATURES) {
    server.tool(
      "get_test_suite_experimental",
      "🧪 [EXPERIMENTAL] Get individual test suite details",
      {
        suite_id: z.number().int().positive().describe("Test suite ID"),
        format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
      },
      async (args) => {
        const { suite_id, format } = args;
        
        try {
          debugLog("Getting experimental test suite", args);
          
          const suite = await client.getTestSuite(suite_id);
          const formattedData = FormatProcessor.format(suite, format);
          
          return {
            content: [{
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }]
          };
        } catch (error: any) {
          const errorMsg = handleExperimentalError(error, 'get_test_suite');
          debugLog("Experimental feature failed", { feature: 'get_test_suite', error: error.message });
          
          return {
            content: [{
              type: "text" as const,
              text: errorMsg
            }]
          };
        }
      }
    );

    server.tool(
      "list_test_cases_by_suite_experimental",
      "🧪 [EXPERIMENTAL] List test cases for a specific suite",
      {
        suite_id: z.number().int().positive().describe("Test suite ID"),
        format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
      },
      async (args) => {
        const { suite_id, format } = args;
        
        try {
          debugLog("Getting experimental test cases by suite", args);
          
          // Note: This experimental endpoint may require a valid project key
          // Using empty string as fallback, but this may cause API errors
          const testCases = await client.getTestCasesBySuite('', suite_id);
          const formattedData = FormatProcessor.format(testCases, format);
          
          return {
            content: [{
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }]
          };
        } catch (error: any) {
          const errorMsg = handleExperimentalError(error, 'list_test_cases_by_suite');
          debugLog("Experimental feature failed", { feature: 'list_test_cases_by_suite', error: error.message });
          
          return {
            content: [{
              type: "text" as const,
              text: errorMsg
            }]
          };
        }
      }
    );

  }

  server.tool(
    "get_test_coverage_by_test_case_steps_by_key",
    "🔍 Analyze test case coverage against actual implementation with recommendations",
    {
      project_key: z.string().min(1).optional().describe("Project key (auto-detected from case_key if not provided)"),
      case_key: z.string().min(1).describe("Test case key (e.g., MFPAND-6)"),
      implementation_context: z.string().min(10).describe("Actual implementation details (code snippets, file paths, or implementation description)"),
      analysis_scope: z.enum(['steps', 'assertions', 'data', 'full']).default('full').describe("Scope of analysis: steps, assertions, data coverage, or full analysis"),
      output_format: z.enum(['chat', 'markdown', 'code_comments', 'all']).default('chat').describe("Output format: chat response, markdown file, code comments, or all formats"),
      include_recommendations: z.boolean().default(true).describe("Include improvement recommendations"),
      include_suite_hierarchy: z.boolean().default(false).describe("Include featureSuiteId and rootSuiteId in analysis"),
      file_path: z.string().optional().describe("File path for adding code comments or saving markdown (optional)")
    },
    async (args) => {
      try {
        // Auto-detect project key if not provided
        const resolvedArgs = FormatProcessor.resolveProjectKey(args);
        const { project_key, case_key, implementation_context, analysis_scope, output_format, include_recommendations, include_suite_hierarchy, file_path } = resolvedArgs;
        
        debugLog("Analyzing test coverage", { project_key, case_key, analysis_scope, output_format, include_suite_hierarchy });
        
        // Get the detailed test case
        const testCase = await client.getTestCaseByKey(project_key, case_key, { includeSuiteHierarchy: include_suite_hierarchy });
        
        if (!testCase) {
          throw new Error(`Test case ${case_key} not found in project ${project_key}`);
        }

        // Perform coverage analysis
        const analysisResult = await performCoverageAnalysis(testCase, implementation_context, analysis_scope, include_recommendations);
        
        // Format output based on requested format
        const outputs = await formatCoverageAnalysis(analysisResult, output_format, file_path);
        
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
      case_key: z.string().min(1).describe("Test case key (e.g., MFPAND-6)"),
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
        
        if (output_format === 'markdown' || output_format === 'all') {
          responseText += `## 📋 Test Case Information\n`;
          responseText += `- **Key**: ${testCase.key}\n`;
          responseText += `- **Title**: ${testCase.title}\n`;
          responseText += `- **Priority**: ${testCase.priority?.name || 'Not set'}\n`;
          responseText += `- **Automation State**: ${testCase.automationState?.name || 'Not set'}\n\n`;
          
          if (testCase.steps && testCase.steps.length > 0) {
            responseText += `## 🔄 Test Steps\n`;
            testCase.steps.forEach((step: any, index: number) => {
              responseText += `### Step ${index + 1}\n`;
              responseText += `**Action**: ${step.action}\n`;
              responseText += `**Expected**: ${step.expectedResult}\n\n`;
            });
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
        debugLog("Error generating draft test", { error: error.message, args });
        return {
          content: [{
            type: "text" as const,
            text: `❌ Error generating draft test for ${args.case_key}: ${error.message}\n\nTip: Ensure the test case exists and your implementation context provides enough information for framework detection.`
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
      case_key: z.string().min(1).describe("Test case key (e.g., MFPAND-6)"),
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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
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
          page: page_token ? parseInt(page_token, 10) : 0
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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, format } = args;

        debugLog("Getting root suites", { project_key });

        // Get all suites first
        const allSuitesResult = await client.getTestSuites(project_key, { size: MAX_PAGE_SIZE });
        let allSuites = allSuitesResult.items;

        // Get more pages if needed
        let page = 1;
        while (allSuitesResult.items.length === MAX_PAGE_SIZE) {
          const nextPage = await client.getTestSuites(project_key, { 
            size: MAX_PAGE_SIZE, 
            page: page 
          });
          if (nextPage.items.length === 0) break;
          allSuites.push(...nextPage.items);
          page++;
          if (page > 50) break; // Safety limit
        }

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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      suite_id: z.number().int().positive().describe("Suite ID to find"),
      only_root_suites: z.boolean().default(false).describe("Search only in root suites"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, suite_id, only_root_suites, format } = args;

        debugLog("Getting TCM suite by ID", { project_key, suite_id, only_root_suites });

        // Get all suites from project
        const allSuitesResult = await client.getTestSuites(project_key, { size: MAX_PAGE_SIZE });
        let allSuites = allSuitesResult.items;

        // Get more pages if needed
        let page = 1;
        while (allSuitesResult.items.length === MAX_PAGE_SIZE && page < 50) {
          const nextPage = await client.getTestSuites(project_key, { 
            size: MAX_PAGE_SIZE, 
            page: page 
          });
          if (nextPage.items.length === 0) break;
          allSuites.push(...nextPage.items);
          page++;
        }

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

          console.error(`Found suite by id ${suite_id} with title: ${enhancedSuite.name || enhancedSuite.title}`);
          console.error(`Item ID: ${enhancedSuite.id}`);
          console.error(`Parent Suite ID: ${enhancedSuite.parentSuiteId}`);
          console.error(`Root Suite ID: ${enhancedSuite.rootSuiteId}`);
          console.error(`Relative Position: ${enhancedSuite.relativePosition}`);
          console.error(`Title: ${enhancedSuite.name || enhancedSuite.title}`);
          console.error(`Description: ${enhancedSuite.description || ''}`);

          const formattedResult = FormatProcessor.format(enhancedSuite, format as any);
          
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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, format } = args;

        debugLog("Getting all TCM test cases", { project_key });

        // Get all test cases with pagination
        let allTestCases: ZebrunnerTestCase[] = [];
        let page = 0;
        let hasMore = true;
        const pageSize = MAX_PAGE_SIZE;

        while (hasMore && page < 100) { // Safety limit
          const result = await client.getTestCases(project_key, {
            size: pageSize,
            page: page
          });

          allTestCases.push(...result.items);
          
          // Check if we have more pages
          hasMore = result.items.length === pageSize;
          page++;
        }

        console.error(`Found ${allTestCases.length} testcases.`);

        const formattedResult = FormatProcessor.format(allTestCases, format as any);
        
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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, format } = args;

        debugLog("Getting all TCM test cases with root suite ID", { project_key });

        // Get all test cases
        let allTestCases: ZebrunnerTestCase[] = [];
        let page = 0;
        let hasMore = true;
        const pageSize = MAX_PAGE_SIZE;

        while (hasMore && page < 100) {
          const result = await client.getTestCases(project_key, {
            size: pageSize,
            page: page
          });

          allTestCases.push(...result.items);
          hasMore = result.items.length === pageSize;
          page++;
        }

        // Get all suites for hierarchy processing
        let allSuites: ZebrunnerTestSuite[] = [];
        page = 0;
        hasMore = true;

        while (hasMore && page < 50) {
          const result = await client.getTestSuites(project_key, {
            size: pageSize,
            page: page
          });

          allSuites.push(...result.items);
          hasMore = result.items.length === pageSize;
          page++;
        }

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
      project_key: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      suite_id: z.number().int().positive().describe("Suite ID to find root for"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        const { project_key, suite_id, format } = args;

        debugLog("Getting root ID by suite ID", { project_key, suite_id });

        // Get all suites for hierarchy processing
        let allSuites: ZebrunnerTestSuite[] = [];
        let page = 0;
        let hasMore = true;
        const pageSize = MAX_PAGE_SIZE;

        while (hasMore && page < 50) {
          const result = await client.getTestSuites(project_key, {
            size: pageSize,
            page: page
          });

          allSuites.push(...result.items);
          hasMore = result.items.length === pageSize;
          page++;
        }

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

  // ========== NEW REPORTING API TOOLS ==========

  server.tool(
    "get_launcher_details",
    "🚀 Get comprehensive launcher details including test sessions (uses new reporting API with enhanced authentication)",
    {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., MFPAND) - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      includeLaunchDetails: z.boolean().default(true).describe("Include detailed launch information"),
      includeTestSessions: z.boolean().default(true).describe("Include test sessions data"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("get_launcher_details called", args);
        return await reportingHandlers.getLauncherDetails(args);
      } catch (error: any) {
        debugLog("Error in get_launcher_details", { error: error.message, args });
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
    "get_launcher_summary",
    "📊 Get quick launcher summary without detailed test sessions (uses new reporting API)",
    {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., MFPAND) - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => {
      try {
        debugLog("get_launcher_summary called", args);
        return await reportingHandlers.getLauncherSummary(args);
      } catch (error: any) {
        debugLog("Error in get_launcher_summary", { error: error.message, args });
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
      project: z.union([z.enum(["web","android","ios","api"]), z.number()])
        .default("web")
        .describe("Project alias (web=MFPWEB, android=MFPAND, ios=MFPIOS, api=MFPAPI) or numeric projectId"),
      period: z.enum(["Last 7 Days","Week","Month"])
        .default("Last 7 Days")
        .describe("Time period"),
      platform: z.union([z.enum(["web","android","ios","api"]), z.array(z.string())])
        .optional()
        .describe("Platform alias or explicit array for paramsConfig.PLATFORM"),
      browser: z.array(z.string())
        .default([])
        .describe("Optional BROWSER filter, e.g., ['chrome'] for web"),
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
        
        // Resolve project ID dynamically
        let projectId: number;
        if (typeof args.project === "number") {
          projectId = args.project;
        } else {
          const projectKey = PROJECT_ALIASES[args.project] || args.project;
          projectId = await reportingClient.getProjectId(projectKey);
        }

        const paramsConfig = buildParamsConfig({
          period: args.period,
          platform: args.platform ?? (typeof args.project === 'string' ? args.project : undefined),   // default to project alias
          browser: args.browser,
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
              browser: args.browser.length > 0 ? args.browser : undefined
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
      project: z.union([z.enum(["web","android","ios","api"]), z.number()])
        .default("web")
        .describe("Project alias (web=MFPWEB, android=MFPAND, ios=MFPIOS, api=MFPAPI) or numeric projectId"),
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
        .describe("e.g., 'https://myfitnesspal.atlassian.net/browse/{key}'"),
      platform: z.union([z.enum(["web","android","ios","api"]), z.array(z.string())])
        .optional()
        .describe("Optional platform filter; defaults to [] for this widget"),
      format: z.enum(['raw', 'formatted']).default('formatted')
        .describe("Output format: raw widget response or formatted data")
    },
    async (args) => {
      try {
        debugLog("get_top_bugs called", args);
        
        // Resolve project ID dynamically
        let projectId: number;
        if (typeof args.project === "number") {
          projectId = args.project;
        } else {
          const projectKey = PROJECT_ALIASES[args.project] || args.project;
          projectId = await reportingClient.getProjectId(projectKey);
        }

        // Keep PLATFORM empty by default as per your examples
        const paramsConfig = buildParamsConfig({
          period: args.period,
          platform: args.platform ?? [],
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
          const cleanText = textMatch ? textMatch[1] : html.replace(/<[^>]*>/g, '');
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

  // ========== TEST CASE VALIDATION TOOL ==========

  server.tool(
    "validate_test_case",
    "🔍 Validate a test case against quality standards and best practices (Dynamic Rules Support + Improvement)",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      caseKey: z.string().min(1).describe("Test case key (e.g., MFPAND-29)"),
      rulesFilePath: z.string().optional().describe("Path to custom rules markdown file"),
      checkpointsFilePath: z.string().optional().describe("Path to custom checkpoints markdown file"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      improveIfPossible: z.boolean().default(true).describe("Attempt to automatically improve the test case")
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
      projectKey: z.string().min(1).describe("Project key (e.g., MFPAND)"),
      caseKey: z.string().min(1).describe("Test case key (e.g., MFPAND-29)"),
      rulesFilePath: z.string().optional().describe("Path to custom rules markdown file"),
      checkpointsFilePath: z.string().optional().describe("Path to custom checkpoints markdown file"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('markdown').describe("Output format"),
      applyHighConfidenceChanges: z.boolean().default(true).describe("Automatically apply high-confidence improvements")
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

  // ========== SERVER STARTUP ==========

  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  // Always print startup message for tests and debugging
  console.error("✅ Zebrunner Unified MCP Server started successfully");
  
  if (DEBUG_MODE) {
    console.error(`🔍 Debug mode: ${DEBUG_MODE}`);
    console.error(`🧪 Experimental features: ${EXPERIMENTAL_FEATURES}`);
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
