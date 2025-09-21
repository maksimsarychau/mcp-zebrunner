import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Import enhanced types and classes
import { ZebrunnerApiClient } from "./api/client.js";
import { ZebrunnerToolHandlers } from "./handlers/tools.js";
import {
  ZebrunnerConfig,
  GetTestCasesInputSchema,
  GetTestSuitesInputSchema,
  GetTestRunsInputSchema,
  GetTestResultsInputSchema,
  SearchTestCasesInputSchema,
  FindTestCaseByKeyInputSchema,
  GetSuiteHierarchyInputSchema
} from "./types/api.js";

// Legacy imports for backward compatibility
import {
  ListTestSuitesSchema,
  GetTestSuiteSchema,
  ListTestCasesSchema,
  GetTestCaseSchema,
  GetTestCaseByKeySchema,
  SearchTestCasesSchema,
  TestSuiteSchema,
  TestCaseLiteSchema,
  TestCaseDetailsSchema
} from "./types.js";
import { ZebrunnerClient } from "./zebrunnerClient.js";
import { FormatProcessor } from "./utils/formatter.js";

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

// Initialize clients
const enhancedClient = new ZebrunnerApiClient(config);
const legacyClient = new ZebrunnerClient({
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN
});

const toolHandlers = new ZebrunnerToolHandlers(enhancedClient);

/** Legacy markdown helper for backward compatibility */
function renderTestCaseMarkdown(tcRaw: any): string {
  return FormatProcessor.formatTestCaseMarkdown(tcRaw);
}

async function main() {
  const server = new McpServer(
    { name: "zebrunner-mcp-enhanced", version: "2.0.0" },
    { 
      capabilities: {
        tools: {}
      }
    }
  );

  // ========== ENHANCED TOOLS (Based on Analysis Document) ==========

  // Test Cases Tools
  server.tool(
    "get_test_cases",
    "Retrieve test cases from Zebrunner with advanced filtering and pagination",
    {
      projectKey: z.string().min(1),
      suiteId: z.number().int().positive().optional(),
      rootSuiteId: z.number().int().positive().optional(),
      includeSteps: z.boolean().default(false),
      format: z.enum(['dto', 'json', 'string']).default('json'),
      page: z.number().int().nonnegative().optional(),
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => toolHandlers.getTestCases(args)
  );

  server.tool(
    "find_test_case_by_key",
    "Find a specific test case by its key with detailed information",
    {
      projectKey: z.string().min(1),
      caseKey: z.string().min(1),
      includeSteps: z.boolean().default(true),
      format: z.enum(['dto', 'json', 'string']).default('json')
    },
    async (args) => toolHandlers.findTestCaseByKey(args)
  );

  server.tool(
    "search_test_cases",
    "Search test cases with advanced filtering options",
    {
      projectKey: z.string().min(1),
      query: z.string().min(1),
      suiteId: z.number().int().positive().optional(),
      status: z.string().optional(),
      priority: z.string().optional(),
      automationState: z.string().optional(),
      format: z.enum(['dto', 'json', 'string']).default('json'),
      page: z.number().int().nonnegative().optional(),
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => toolHandlers.searchTestCases(args)
  );

  // Test Suites Tools
  server.tool(
    "get_test_suites",
    "Retrieve test suites with hierarchy support and filtering",
    {
      projectKey: z.string().min(1),
      parentSuiteId: z.number().int().positive().optional(),
      rootOnly: z.boolean().default(false),
      includeHierarchy: z.boolean().default(false),
      format: z.enum(['dto', 'json', 'string']).default('json'),
      page: z.number().int().nonnegative().optional(),
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => toolHandlers.getTestSuites(args)
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
    async (args) => toolHandlers.getSuiteHierarchy(args)
  );

  server.tool(
    "get_root_suites",
    "Get only root-level test suites with hierarchy information",
    {
      projectKey: z.string().min(1),
      format: z.enum(['dto', 'json', 'string']).default('json')
    },
    async (args) => toolHandlers.getRootSuites(args.projectKey, args.format)
  );

  // Test Runs and Results Tools
  server.tool(
    "get_test_runs",
    "Retrieve test execution runs with filtering by status, milestone, build, etc.",
    {
      projectKey: z.string().min(1),
      status: z.string().optional(),
      milestone: z.string().optional(),
      build: z.string().optional(),
      environment: z.string().optional(),
      format: z.enum(['dto', 'json', 'string']).default('json'),
      page: z.number().int().nonnegative().optional(),
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => toolHandlers.getTestRuns(args)
  );

  server.tool(
    "get_test_results",
    "Get test results for a specific test run",
    {
      projectKey: z.string().min(1),
      runId: z.number().int().positive(),
      status: z.string().optional(),
      format: z.enum(['dto', 'json', 'string']).default('json')
    },
    async (args) => toolHandlers.getTestResults(args)
  );

  // Utility Tools
  server.tool(
    "get_test_cases_by_suite",
    "Get all test cases belonging to a specific test suite",
    {
      projectKey: z.string().min(1),
      suiteId: z.number().int().positive(),
      format: z.enum(['dto', 'json', 'string']).default('json')
    },
    async (args) => toolHandlers.getTestCasesBySuite(args.projectKey, args.suiteId, args.format)
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
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text", 
            text: `Error: ${error.message}` 
          }] 
        };
      }
    }
  );

  server.tool(
    "get_test_suite",
    "Legacy: Return detailed info of a test suite by suite_id (Limited availability)",
    {
      suite_id: z.number().int().positive()
    },
    async (args) => {
      const { suite_id } = args;
      try {
        const suite = await legacyClient.getTestSuite(suite_id);
        const parsed = TestSuiteSchema.safeParse(suite);
        const data = parsed.success ? parsed.data : suite;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text", 
            text: `Error: ${error.message}. Individual test suite details may not be available via API.` 
          }] 
        };
      }
    }
  );

  server.tool(
    "list_test_cases",
    "Legacy: Return list of test cases for a given test suite (Limited availability)",
    {
      suite_id: z.number().int().positive()
    },
    async (args) => {
      const { suite_id } = args;
      try {
        const cases = await legacyClient.listTestCases(suite_id);
        const data = cases.map((c: unknown) => {
          const parsed = TestCaseLiteSchema.safeParse(c);
          return parsed.success ? parsed.data : c;
        });
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text", 
            text: `Error: ${error.message}. Test cases for this suite may not be available via this endpoint.` 
          }] 
        };
      }
    }
  );

  server.tool(
    "get_test_case",
    "Legacy: Return detailed info of a test case by case_id",
    {
      case_id: z.number().int().positive()
    },
    async (args) => {
      const { case_id } = args;
      try {
        const tc = await legacyClient.getTestCase(case_id);
        const parsed = TestCaseDetailsSchema.safeParse(tc);
        const data = parsed.success ? parsed.data : tc;
        const md = renderTestCaseMarkdown(tc);
        return {
          content: [
            { type: "text", text: `**JSON Data:**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` },
            { type: "text", text: `**Markdown Export:**\n\n${md}` }
          ]
        };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text", 
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
            { type: "text", text: `**JSON Data:**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` },
            { type: "text", text: `**Markdown Export:**\n\n${md}` }
          ]
        };
      } catch (error: any) {
        return { 
          content: [{ 
            type: "text", 
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
    console.log("Zebrunner MCP Server Enhanced started in debug mode");
  }
}

main().catch((e) => {
  console.error("MCP server failed to start:", e);
  process.exit(1);
});
