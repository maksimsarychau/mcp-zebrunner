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
  defaultPageSize: 50,
  maxPageSize: 200
};

const client = new EnhancedZebrunnerClient(config);

/** Debug logging utility */
function debugLog(message: string, data?: any) {
  if (DEBUG_MODE) {
    console.log(`🔍 [DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

/** Enhanced error handling for experimental features */
function handleExperimentalError(error: any, feature: string): string {
  const errorMsg = `⚠️  Experimental feature '${feature}' failed: ${error.message}`;
  
  if (error.response?.status === 404) {
    return `${errorMsg}\n💡 This endpoint may not be available on your Zebrunner instance.`;
  } else if (error.response?.status === 400) {
    return `${errorMsg}\n💡 This endpoint may require different parameters for your Zebrunner instance.`;
  } else if (error.response?.status === 401) {
    return `${errorMsg}\n💡 Check your credentials and permissions.`;
  }
  
  return `${errorMsg}\n💡 Enable DEBUG=true for more details.`;
}

/** Improved API response validation */
function validateApiResponse(data: any, expectedType: string): boolean {
  if (!data) {
    debugLog(`Invalid response: null/undefined data for ${expectedType}`);
    return false;
  }
  
  if (expectedType === 'array' && !Array.isArray(data) && !data.items) {
    debugLog(`Invalid response: expected array or {items: []} for ${expectedType}`, data);
    return false;
  }
  
  return true;
}

/** Enhanced markdown rendering with debug info */
function renderTestCaseMarkdown(testCase: any, includeDebugInfo: boolean = false): string {
  let markdown = FormatProcessor.formatTestCaseMarkdown(testCase);
  
  if (includeDebugInfo && DEBUG_MODE) {
    markdown += `\n\n---\n## Debug Information\n\n`;
    markdown += `- **Retrieved At**: ${new Date().toISOString()}\n`;
    markdown += `- **API Response Size**: ${JSON.stringify(testCase).length} characters\n`;
    markdown += `- **Custom Fields Count**: ${testCase.customField ? Object.keys(testCase.customField).length : 0}\n`;
  }
  
  return markdown;
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
    "get_test_cases_advanced",
    "📊 Advanced test case retrieval with filtering and pagination",
    {
      project_key: z.string().min(1).describe("Project key"),
      suite_id: z.number().int().positive().optional().describe("Filter by suite ID"),
      root_suite_id: z.number().int().positive().optional().describe("Filter by root suite ID"),
      include_steps: z.boolean().default(false).describe("Include detailed test steps"),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().default(0).describe("Page number (0-based)"),
      size: z.number().int().positive().max(200).default(50).describe("Page size")
    },
    async (args) => {
      const { project_key, suite_id, root_suite_id, include_steps, format, page, size } = args;
      
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
          
          const detailedCases = await Promise.allSettled(
            processedCases.slice(0, 5).map(async (testCase: any) => {
              if (testCase.key) {
                return await client.getTestCaseByKey(project_key, testCase.key);
              }
              return testCase;
            })
          );
          
          processedCases = detailedCases.map((result: any, index: number) => 
            result.status === 'fulfilled' ? result.value : processedCases[index]
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
        
        const allSuites = await client.getAllTestSuites(project_key);
        let suitesToProcess = allSuites;

        // Filter by root suite if specified
        if (root_suite_id) {
          const descendants = HierarchyProcessor.getSuiteDescendants(root_suite_id, allSuites);
          const rootSuite = allSuites.find(s => s.id === root_suite_id);
          suitesToProcess = rootSuite ? [rootSuite, ...descendants] : descendants;
        }

        // Build hierarchical tree
        const hierarchyTree = HierarchyProcessor.buildSuiteTree(suitesToProcess);
        
        // Limit depth
        const limitDepth = (suites: any[], currentDepth: number): any[] => {
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
          
          const testCases = await client.getTestCasesBySuite('', suite_id); // Empty project key for direct suite access
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
        size: z.number().int().positive().max(200).default(20).describe("Page size")
      },
      async (args) => {
        const { project_key, query, suite_id, status, priority, format, page, size } = args;
        
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
