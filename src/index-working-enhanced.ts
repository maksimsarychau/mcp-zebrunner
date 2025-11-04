import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Import enhanced clients and utilities
import { ZebrunnerApiClient } from "./api/client.js";
import { FormatProcessor } from "./utils/formatter.js";
import { HierarchyProcessor } from "./utils/hierarchy.js";
import { ZebrunnerConfig } from "./types/api.js";

// Legacy imports for compatibility
import { ZebrunnerClient } from "./zebrunnerClient.js";
import {
  TestSuiteSchema,
  TestCaseLiteSchema,
  TestCaseDetailsSchema
} from "./types.js";

/** Environment configuration */
const ZEBRUNNER_URL = process.env.ZEBRUNNER_URL?.replace(/\/+$/, "");
const ZEBRUNNER_LOGIN = process.env.ZEBRUNNER_LOGIN;
const ZEBRUNNER_TOKEN = process.env.ZEBRUNNER_TOKEN;
const DEBUG_MODE = process.env.DEBUG === 'true';

if (!ZEBRUNNER_URL || !ZEBRUNNER_LOGIN || !ZEBRUNNER_TOKEN) {
  console.error("Missing required environment variables:");
  console.error("- ZEBRUNNER_URL");
  console.error("- ZEBRUNNER_LOGIN");
  console.error("- ZEBRUNNER_TOKEN");
  process.exit(1);
}

// Enhanced API client configuration
const enhancedConfig: ZebrunnerConfig = {
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

// Initialize clients
const enhancedClient = new ZebrunnerApiClient(enhancedConfig);
const legacyClient = new ZebrunnerClient({
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN
});

/** Enhanced markdown helper */
function renderTestCaseMarkdown(tcRaw: any): string {
  return FormatProcessor.formatTestCaseMarkdown(tcRaw);
}

async function main() {
  const server = new McpServer(
    { name: "zebrunner-mcp-enhanced-working", version: "2.0.0" },
    { 
      capabilities: {
        tools: {}
      }
    }
  );

  // ========== ENHANCED TOOLS ==========

  server.tool(
    "get_test_cases_enhanced",
    "Retrieve test cases with advanced filtering, pagination, and multiple output formats",
    {
      projectKey: z.string().min(1),
      suiteId: z.number().int().positive().optional(),
      rootSuiteId: z.number().int().positive().optional(),
      includeSteps: z.boolean().default(false),
      format: z.enum(['dto', 'json', 'string']).default('json'),
      page: z.number().int().nonnegative().optional(),
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => {
      try {
        const { projectKey, suiteId, rootSuiteId, includeSteps, format, page, size } = args;
        
        const searchParams = {
          page,
          size,
          suiteId,
          rootSuiteId
        };

        const response = await enhancedClient.getTestCases(projectKey, searchParams);
        
        // If includeSteps is true, fetch detailed info for first few test cases
        if (includeSteps && response.items.length > 0) {
          const detailedCases = await Promise.all(
            response.items.slice(0, 5).map(async (testCase) => { // Limit to 5 for performance
              try {
                if (testCase.key) {
                  return await enhancedClient.getTestCaseByKey(projectKey, testCase.key);
                }
                return testCase;
              } catch (error) {
                return testCase; // Fallback to basic info if detailed fetch fails
              }
            })
          );
          
          const formattedData = FormatProcessor.format(detailedCases, format);
          return {
            content: [
              {
                type: "text" as const,
                text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
              }
            ]
          };
        }

        const formattedData = FormatProcessor.format(response, format);
        return {
          content: [
            {
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving test cases: ${error.message}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "get_test_suites_enhanced",
    "Retrieve test suites with hierarchy support and multiple output formats",
    {
      projectKey: z.string().min(1),
      parentSuiteId: z.number().int().positive().optional(),
      rootOnly: z.boolean().default(false),
      includeHierarchy: z.boolean().default(false),
      format: z.enum(['dto', 'json', 'string']).default('json'),
      page: z.number().int().nonnegative().optional(),
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => {
      try {
        const { projectKey, parentSuiteId, rootOnly, includeHierarchy, format, page, size } = args;
        
        const searchParams = {
          page,
          size,
          parentSuiteId
        };

        let response = await enhancedClient.getTestSuites(projectKey, searchParams);
        
        if (rootOnly) {
          response.items = response.items.filter(suite => !suite.parentSuiteId);
        }

        if (includeHierarchy) {
          // Get all suites to build hierarchy
          const allSuites = await enhancedClient.getAllTestSuites(projectKey);
          const enrichedSuites = HierarchyProcessor.enrichSuitesWithHierarchy(allSuites);
          
          // Filter to requested suites but with hierarchy info
          response.items = response.items.map(suite => {
            const enriched = enrichedSuites.find(s => s.id === suite.id);
            return enriched || suite;
          });
        }

        const formattedData = FormatProcessor.format(response, format);
        return {
          content: [
            {
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving test suites: ${error.message}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "get_suite_hierarchy",
    "Get hierarchical test suite tree with configurable depth",
    {
      projectKey: z.string().min(1),
      rootSuiteId: z.number().int().positive().optional(),
      maxDepth: z.number().int().positive().max(10).default(5),
      format: z.enum(['dto', 'json', 'string']).default('json')
    },
    async (args) => {
      try {
        const { projectKey, rootSuiteId, maxDepth, format } = args;
        
        const allSuites = await enhancedClient.getAllTestSuites(projectKey);
        let suitesToProcess = allSuites;

        // Filter by root suite if specified
        if (rootSuiteId) {
          const descendants = HierarchyProcessor.getSuiteDescendants(rootSuiteId, allSuites);
          const rootSuite = allSuites.find(s => s.id === rootSuiteId);
          suitesToProcess = rootSuite ? [rootSuite, ...descendants] : descendants;
        }

        // Build hierarchical tree
        const hierarchyTree = HierarchyProcessor.buildSuiteTree(suitesToProcess);
        
        // Limit depth if specified
        const limitDepth = (suites: any[], currentDepth: number): any[] => {
          if (currentDepth >= maxDepth) {
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
          content: [
            {
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving suite hierarchy: ${error.message}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "find_test_case_by_key_enhanced",
    "Find a specific test case by its key with enhanced formatting and multiple output formats",
    {
      projectKey: z.string().min(1),
      caseKey: z.string().min(1),
      includeSteps: z.boolean().default(true),
      format: z.enum(['dto', 'json', 'string', 'markdown']).default('json')
    },
    async (args) => {
      try {
        const { projectKey, caseKey, includeSteps, format } = args;
        
        const testCase = await enhancedClient.getTestCaseByKey(projectKey, caseKey);
        
        if (format === 'markdown' && includeSteps) {
          // Use enhanced markdown format
          const markdownData = FormatProcessor.formatTestCaseMarkdown(testCase);
          return {
            content: [
              {
                type: "text" as const,
                text: markdownData
              }
            ]
          };
        }
        
        const formattedData = FormatProcessor.format(testCase, format === 'markdown' ? 'string' : format);
        
        return {
          content: [
            {
              type: "text" as const,
              text: typeof formattedData === 'string' ? formattedData : JSON.stringify(formattedData, null, 2)
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error finding test case: ${error.message}`
            }
          ]
        };
      }
    }
  );

  // ========== LEGACY TOOLS (Backward Compatibility) ==========

  server.tool(
    "list_test_suites",
    "Legacy: Return list of Zebrunner test suites for a project",
    {
      project_key: z.string().optional(),
      project_id: z.number().int().positive().optional()
    },
    async (args) => {
      const { project_key, project_id } = args;
      if (!project_key && !project_id) {
        throw new Error("Either project_key or project_id must be provided");
      }
      
      try {
        const suites = await legacyClient.listTestSuites({ 
          projectKey: project_key, 
          projectId: project_id 
        });
        const data = suites.map((s: unknown) => {
          const parsed = TestSuiteSchema.safeParse(s);
          return parsed.success ? parsed.data : s;
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text" as const, 
            text: `Error: ${error.message}` 
          }] 
        };
      }
    }
  );

  server.tool(
    "get_test_case_by_key",
    "Legacy: Return detailed info of a test case by case_key and project_key (✅ Working)",
    {
      case_key: z.string().min(1),
      project_key: z.string().min(1)
    },
    async (args) => {
      const { case_key, project_key } = args;
      try {
        const tc = await legacyClient.getTestCaseByKey(case_key, project_key);
        const parsed = TestCaseDetailsSchema.safeParse(tc);
        const data = parsed.success ? parsed.data : tc;
        const md = renderTestCaseMarkdown(tc);
        return {
          content: [
            { type: "text" as const, text: `**JSON Data:**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` },
            { type: "text" as const, text: `**Markdown Export:**\n\n${md}` }
          ]
        };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text" as const, 
            text: `Error: ${error.message}` 
          }] 
        };
      }
    }
  );

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  if (DEBUG_MODE) {
    console.log("Zebrunner MCP Server Enhanced (Working) started in debug mode");
  }
}

main().catch((e) => {
  console.error("MCP server failed to start:", e);
  process.exit(1);
});
















