import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Import enhanced types and classes
import { ZebrunnerApiClient } from "./api/client.js";
import { ZebrunnerReportingClient } from "./api/reporting-client.js";
import { ZebrunnerToolHandlers } from "./handlers/tools.js";
import { ZebrunnerReportingToolHandlers } from "./handlers/reporting-tools.js";
import {
  ZebrunnerConfig,
  GetTestCasesInputSchema,
  GetTestSuitesInputSchema,
  GetTestRunsInputSchema,
  GetTestResultsInputSchema,
  FindTestCaseByKeyInputSchema,
  GetSuiteHierarchyInputSchema,
  GetLauncherDetailsInputSchema,
  AnalyzeTestFailureInputSchema
} from "./types/api.js";
import { ZebrunnerReportingConfig } from "./types/reporting.js";

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

// Enhanced API client configuration (for TCM Public API)
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

// Reporting API client configuration (for new authentication)
const reportingConfig: ZebrunnerReportingConfig = {
  baseUrl: ZEBRUNNER_URL.replace('/api/public/v1', ''),
  accessToken: ZEBRUNNER_TOKEN,
  timeout: 30_000,
  debug: DEBUG_MODE
};

// Initialize clients
const enhancedClient = new ZebrunnerApiClient(config);
const reportingClient = new ZebrunnerReportingClient(reportingConfig);

// Initialize tool handlers
const toolHandlers = new ZebrunnerToolHandlers(enhancedClient);
const reportingHandlers = new ZebrunnerReportingToolHandlers(reportingClient);

function debugLog(message: string, data?: unknown) {
  if (DEBUG_MODE) {
    console.error(`[DEBUG] ${message}`, data ? JSON.stringify(data, null, 2) : '');
  }
}

async function main() {
  const server = new McpServer(
    { 
      name: "zebrunner-mcp-with-reporting", 
      version: "3.1.0",
      description: "Zebrunner MCP Server with Reporting API support"
    },
    { 
      capabilities: {
        tools: {}
      }
    }
  );

  debugLog("🚀 Starting Zebrunner MCP Server with Reporting API", {
    url: ZEBRUNNER_URL,
    debug: DEBUG_MODE
  });

  // ========== EXISTING TCM PUBLIC API TOOLS ==========

  server.tool(
    "get_test_cases",
    "📋 Retrieve test cases from Zebrunner with advanced filtering and pagination",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      suiteId: z.number().int().positive().optional().describe("Filter by specific suite ID"),
      rootSuiteId: z.number().int().positive().optional().describe("Filter by root suite ID"),
      includeSteps: z.boolean().default(false).describe("Include detailed test steps"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().optional().describe("Page number for pagination"),
      size: z.number().int().positive().max(200).optional().describe("Page size (max 200)")
    },
    async (args) => toolHandlers.getTestCases(args)
  );

  server.tool(
    "find_test_case_by_key",
    "🔍 Find a specific test case by its key with detailed information",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      caseKey: z.string().min(1).describe("Test case key (e.g., 'ANDROID-29')"),
      includeSteps: z.boolean().default(true).describe("Include detailed test steps"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => toolHandlers.findTestCaseByKey(args)
  );

  server.tool(
    "get_test_suites",
    "📂 Retrieve test suites from Zebrunner with pagination support",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      rootOnly: z.boolean().default(false).describe("Return only root suites"),
      includeHierarchy: z.boolean().default(false).describe("Include hierarchy information"),
      parentSuiteId: z.number().int().positive().optional().describe("Filter by parent suite ID"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format"),
      page: z.number().int().nonnegative().optional().describe("Page number for pagination"),
      size: z.number().int().positive().max(200).optional().describe("Page size (max 200)")
    },
    async (args) => toolHandlers.getTestSuites(args)
  );

  server.tool(
    "get_suite_hierarchy",
    "🌳 Get hierarchical view of test suites with depth control",
    {
      projectKey: z.string().min(1).describe("Project key (e.g., 'android' or 'ANDROID')"),
      rootSuiteId: z.number().int().positive().optional().describe("Root suite ID to start from"),
      maxDepth: z.number().int().positive().max(10).default(5).describe("Maximum hierarchy depth"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => toolHandlers.getSuiteHierarchy(args)
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
    async (args) => reportingHandlers.getLauncherDetails(args)
  );

  server.tool(
    "get_launch_summary",
    "📊 Get quick launcher summary without detailed test sessions (uses new reporting API)",
    {
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'android' or 'ANDROID') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID (e.g., 7) - alternative to projectKey"),
      launchId: z.number().int().positive().describe("Launch ID (e.g., 118685)"),
      format: z.enum(['dto', 'json', 'string']).default('json').describe("Output format")
    },
    async (args) => reportingHandlers.getLauncherSummary(args)
  );

  server.tool(
    "analyze_test_failure",
    "🔍 Deep forensic analysis of a failed test including logs, screenshots, error classification, and similar failures",
    {
      testId: z.number().int().positive().describe("Test ID (e.g., 5451420)"),
      testRunId: z.number().int().positive().describe("Test Run ID / Launch ID (e.g., 120806)"),
      projectKey: z.string().min(1).optional().describe("Project key (e.g., 'MCP') - alternative to projectId"),
      projectId: z.number().int().positive().optional().describe("Project ID - alternative to projectKey"),
      includeScreenshots: z.boolean().default(true).describe("Include screenshot analysis"),
      includeLogs: z.boolean().default(true).describe("Include log analysis"),
      includeArtifacts: z.boolean().default(true).describe("Include all test artifacts"),
      includePageSource: z.boolean().default(true).describe("Include page source analysis"),
      includeVideo: z.boolean().default(false).describe("Include video URL"),
      analyzeSimilarFailures: z.boolean().default(true).describe("Find similar failures in the launch"),
      format: z.enum(['detailed', 'summary']).default('detailed').describe("Output format: detailed or summary")
    },
    async (args) => reportingHandlers.analyzeTestFailureById(args)
  );

  // ========== CONNECTION TEST TOOLS ==========

  server.tool(
    "test_tcm_connection",
    "🔌 Test connection to Zebrunner TCM Public API",
    {},
    async () => {
      try {
        // Simple test by trying to get test suites for a known project
        const result = await enhancedClient.getTestSuites('ANDROID', { 
          rootOnly: false, 
          size: 1 
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `TCM API Connection successful. Found ${result.items?.length || 0} test suites.`
            }
          ]
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: "text" as const,
              text: `TCM API Connection failed: ${error.message}`
            }
          ]
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
        return {
          content: [
            {
              type: "text" as const,
              text: `Reporting API Connection failed: ${error.message}`
            }
          ]
        };
      }
    }
  );

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  debugLog("✅ Zebrunner MCP Server with Reporting API started successfully");
}

main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
