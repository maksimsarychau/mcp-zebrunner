import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Enhanced imports
import { EnhancedZebrunnerClient } from "./api/enhanced-client.js";
import { FormatProcessor } from "./utils/formatter.js";
import { HierarchyProcessor } from "./utils/hierarchy.js";
import { ZebrunnerConfig } from "./types/api.js";
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

/** Environment configuration with validation */
const ZEBRUNNER_URL = process.env.ZEBRUNNER_URL?.replace(/\/+$/, "");
const ZEBRUNNER_LOGIN = process.env.ZEBRUNNER_LOGIN;
const ZEBRUNNER_TOKEN = process.env.ZEBRUNNER_TOKEN;
const DEBUG_MODE = process.env.DEBUG === 'true';
const EXPERIMENTAL_FEATURES = process.env.EXPERIMENTAL_FEATURES === 'true';
const MAX_PAGE_SIZE = parseInt(process.env.MAX_PAGE_SIZE || '100', 10);
const DEFAULT_PAGE_SIZE = parseInt(process.env.DEFAULT_PAGE_SIZE || '10', 10);

if (!ZEBRUNNER_URL || !ZEBRUNNER_LOGIN || !ZEBRUNNER_TOKEN) {
  console.error("❌ Missing required environment variables:");
  console.error("   - ZEBRUNNER_URL");
  console.error("   - ZEBRUNNER_LOGIN");
  console.error("   - ZEBRUNNER_TOKEN");
  console.error("\n💡 Copy .env.example to .env and configure your Zebrunner credentials");
  process.exit(1);
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

/** Debug logging utility with safe serialization */
function debugLog(message: string, data?: unknown) {
  if (DEBUG_MODE) {
    try {
      const serializedData = data ? JSON.stringify(data, null, 2) : '';
      console.log(`🔍 [DEBUG] ${message}`, serializedData);
    } catch (error) {
      console.log(`🔍 [DEBUG] ${message}`, '[Data serialization failed]', error instanceof Error ? error.message : 'Unknown error');
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

/** Enhanced markdown rendering with debug info */
function renderTestCaseMarkdown(testCase: ZebrunnerTestCase, includeDebugInfo: boolean = false): string {
  let markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
  
  if (includeDebugInfo && DEBUG_MODE) {
    markdown += `\n\n---\n## Debug Information\n\n`;
    markdown += `- **Retrieved At**: ${new Date().toISOString()}\n`;
    markdown += `- **API Response Size**: ${JSON.stringify(testCase).length} characters\n`;
    markdown += `- **Custom Fields Count**: ${testCase.customField ? Object.keys(testCase.customField).length : 0}\n`;
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

  // Analyze each test step
  if (testCase.steps && testCase.steps.length > 0) {
    analysis.coverage.stepsCoverage = testCase.steps.map((step: any, index: number) => {
      const stepAnalysis = analyzeStepCoverage(step, implementationContext);
      return {
        stepNumber: index + 1,
        action: step.action,
        expectedResult: step.expectedResult,
        coverage: stepAnalysis.coverage,
        implementationMatches: stepAnalysis.matches,
        missingElements: stepAnalysis.missing,
        confidence: stepAnalysis.confidence
      };
    });
  }

  // Calculate overall coverage score
  const totalSteps = analysis.coverage.stepsCoverage.length;
  const coveredSteps = analysis.coverage.stepsCoverage.filter((step: any) => step.coverage > 0.5).length;
  analysis.coverage.overallScore = totalSteps > 0 ? Math.round((coveredSteps / totalSteps) * 100) : 0;

  // Generate recommendations if requested
  if (includeRecommendations) {
    analysis.recommendations = generateCoverageRecommendations(analysis);
  }

  return analysis;
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
function analyzeStepCoverage(step: any, implementationContext: string): any {
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
function generateCoverageRecommendations(analysis: any): string[] {
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
      name: "zebrunner-unified", 
      version: "3.0.0",
      description: "Unified Zebrunner MCP Server with comprehensive features and improved error handling"
    },
    { 
      capabilities: {
        tools: {}
      }
    }
  );

  debugLog("🚀 Starting Zebrunner Unified MCP Server", {
    url: ZEBRUNNER_URL,
    debug: DEBUG_MODE,
    experimental: EXPERIMENTAL_FEATURES
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
      include_debug: z.boolean().default(false).describe("Include debug information in markdown")
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
      
      const { project_key, case_key, format, include_debug } = resolvedArgs;
      
      try {
        debugLog("Getting test case by key", { project_key, case_key, format });
        
        const testCase = await client.getTestCaseByKey(project_key, case_key);
        
        if (!testCase) {
          throw new Error(`Test case ${case_key} not found`);
        }

        if (format === 'markdown') {
          const markdown = renderTestCaseMarkdown(testCase, include_debug);
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
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
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

    server.tool(
      "search_test_cases_experimental",
      "🧪 [EXPERIMENTAL] Search test cases with advanced filters",
      {
        project_key: z.string().min(1).describe("Project key"),
        query: z.string().min(1).describe("Search query"),
        suite_id: z.number().int().positive().optional().describe("Filter by suite ID"),
        status: z.string().optional().describe("Filter by status"),
        priority: z.string().optional().describe("Filter by priority"),
        format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
        page: z.number().int().nonnegative().default(0).describe("Page number"),
        size: z.number().int().positive().max(1000).default(50).describe("Page size (configurable via MAX_PAGE_SIZE env var)")
      },
      async (args) => {
        const { project_key, query, suite_id, status, priority, format, page, size } = args;
        
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
          debugLog("Searching test cases experimentally", args);
          
          const searchParams = {
            page,
            size,
            suiteId: suite_id,
            status,
            priority
          };

          const response = await client.searchTestCases(project_key, query, searchParams);
          const formattedData = FormatProcessor.format(response, format);
          
          return {
            content: [{
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }]
          };
        } catch (error: any) {
          const errorMsg = handleExperimentalError(error, 'search_test_cases');
          debugLog("Experimental feature failed", { feature: 'search_test_cases', error: error.message });
          
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
      file_path: z.string().optional().describe("File path for adding code comments or saving markdown (optional)")
    },
    async (args) => {
      try {
        // Auto-detect project key if not provided
        const resolvedArgs = FormatProcessor.resolveProjectKey(args);
        const { project_key, case_key, implementation_context, analysis_scope, output_format, include_recommendations, file_path } = resolvedArgs;
        
        debugLog("Analyzing test coverage", { project_key, case_key, analysis_scope, output_format });
        
        // Get the detailed test case
        const testCase = await client.getTestCaseByKey(project_key, case_key);
        
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

  // ========== SERVER STARTUP ==========

  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  if (DEBUG_MODE) {
    console.log("✅ Zebrunner Unified MCP Server started successfully");
    console.log(`🔍 Debug mode: ${DEBUG_MODE}`);
    console.log(`🧪 Experimental features: ${EXPERIMENTAL_FEATURES}`);
    console.log(`🌐 Zebrunner URL: ${ZEBRUNNER_URL}`);
  }
}

// Error handling for server startup
main().catch((error) => {
  console.error("❌ Failed to start Zebrunner MCP Server:", error.message);
  if (DEBUG_MODE) {
    console.error("Stack trace:", error.stack);
  }
  process.exit(1);
});

export { main as startServer };
