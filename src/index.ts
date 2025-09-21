import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { z } from "zod";

/** Env config */
const ZEBRUNNER_URL = process.env.ZEBRUNNER_URL?.replace(/\/+$/, "");
const ZEBRUNNER_LOGIN = process.env.ZEBRUNNER_LOGIN;
const ZEBRUNNER_TOKEN = process.env.ZEBRUNNER_TOKEN;

if (!ZEBRUNNER_URL || !ZEBRUNNER_LOGIN || !ZEBRUNNER_TOKEN) {
  console.error("Missing env: ZEBRUNNER_URL / ZEBRUNNER_LOGIN / ZEBRUNNER_TOKEN");
  process.exit(1);
}

const client = new ZebrunnerClient({
  baseUrl: ZEBRUNNER_URL,
  username: ZEBRUNNER_LOGIN,
  token: ZEBRUNNER_TOKEN
});

/** ---------- Markdown helpers ---------- */

function codeBlockJson(value: unknown): string {
  try { return "```json\n" + JSON.stringify(value, null, 2) + "\n```"; }
  catch { return String(value); }
}

/**
 * Render a test case into Markdown with best-effort step extraction.
 * We don't assume an exact schema, so we:
 * - find an array in `steps`
 * - for each step, try typical fields: stepNumber/index, action/actionText, expected/expectedText, data/inputs
 * - include raw step JSON if nothing matched
 */
function renderTestCaseMarkdown(tcRaw: any): string {
  const id = tcRaw?.id ?? "N/A";
  const key = tcRaw?.key ?? "N/A";
  const title = tcRaw?.title ?? "(no title)";
  const description = tcRaw?.description ?? "";
  const priority = tcRaw?.priority?.name ?? "N/A";
  const automationState = tcRaw?.automationState?.name ?? "N/A";
  const createdBy = tcRaw?.createdBy?.username ?? "N/A";
  const lastModifiedBy = tcRaw?.lastModifiedBy?.username ?? "N/A";

  const header = `# Test Case: ${title}\n\n- **ID:** ${id}\n- **Key:** ${key}\n- **Priority:** ${priority}\n- **Automation State:** ${automationState}\n- **Created By:** ${createdBy}\n- **Last Modified By:** ${lastModifiedBy}\n\n`;
  const descBlock = description ? `## Description\n\n${description}\n\n` : "";
  
  // Handle custom fields
  let customFieldsBlock = "";
  if (tcRaw?.customField && typeof tcRaw.customField === 'object') {
    const fields = Object.entries(tcRaw.customField)
      .filter(([key, value]) => value !== null && value !== undefined && value !== "")
      .map(([key, value]) => `- **${key}:** ${value}`)
      .join('\n');
    if (fields) {
      customFieldsBlock = `## Custom Fields\n\n${fields}\n\n`;
    }
  }

  const steps = Array.isArray(tcRaw?.steps) ? tcRaw.steps : [];

  if (!steps.length) {
    return `${header}${descBlock}${customFieldsBlock}## Steps\n\n_No explicit steps provided._\n`;
  }

  const lines: string[] = [];
  lines.push(`${header}${descBlock}${customFieldsBlock}## Steps\n`);

  const pick = (obj: any, keys: string[], fallback?: any) => {
    for (const k of keys) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null) {
        return obj[k];
      }
    }
    return fallback;
  };

  steps.forEach((s: any, idx: number) => {
    const num = pick(s, ["stepNumber", "number", "index", "order"], idx + 1);
    const action = pick(s, ["action", "actual", "step", "actionText", "instruction", "name"]);
    const expected = pick(s, ["expected", "expectedResult", "expectedText", "result"]);
    const data = pick(s, ["data", "inputs", "parameters", "payload"]);

    lines.push(`### Step ${num}`);
    if (action) lines.push(`- **Action:** ${action}`);
    if (expected) lines.push(`- **Expected:** ${expected}`);
    if (data !== undefined) {
      if (typeof data === "object") {
        lines.push(`- **Data:**\n${codeBlockJson(data)}`);
      } else {
        lines.push(`- **Data:** ${String(data)}`);
      }
    }
    if (!action && !expected) {
      lines.push(`- **Raw step:**\n${codeBlockJson(s)}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/** ---------- Bootstrap MCP ---------- */

async function main() {
  const server = new McpServer(
    { name: "zebrunner-mcp", version: "1.0.0" },
    { 
      capabilities: {
        tools: {}
      }
    }
  );

  // Register tools
  server.tool(
    "list_test_suites",
    "Return list of Zebrunner test suites for a project (requires project_key or project_id)",
    {
      project_key: z.string().optional(),
      project_id: z.number().int().positive().optional()
    },
    async (args) => {
      const { project_key, project_id } = args;
      if (!project_key && !project_id) {
        throw new Error("Either project_key or project_id must be provided");
      }
      const suites = await client.listTestSuites({ projectKey: project_key, projectId: project_id });
      const data = suites.map((s: unknown) => {
        const parsed = TestSuiteSchema.safeParse(s);
        return parsed.success ? parsed.data : s;
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_test_suite",
    "Return detailed info of a test suite by suite_id (Note: Individual suite details may not be available)",
    {
      suite_id: z.number().int().positive()
    },
    async (args) => {
      const { suite_id } = args;
      try {
        const suite = await client.getTestSuite(suite_id);
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
    "Return list of test cases for a given test suite (Note: May not be available for all suites)",
    {
      suite_id: z.number().int().positive()
    },
    async (args) => {
      const { suite_id } = args;
      try {
        const cases = await client.listTestCases(suite_id);
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
    "Return detailed info of a test case by case_id. Also returns a Markdown export of steps.",
    {
      case_id: z.number().int().positive()
    },
    async (args) => {
      const { case_id } = args;
      const tc = await client.getTestCase(case_id);
      const parsed = TestCaseDetailsSchema.safeParse(tc);
      const data = parsed.success ? parsed.data : tc;
      const md = renderTestCaseMarkdown(tc);
      return {
        content: [
          { type: "text", text: `**JSON Data:**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` },
          { type: "text", text: `**Markdown Export:**\n\n${md}` }
        ]
      };
    }
  );

  server.tool(
    "get_test_case_by_key",
    "Return detailed info of a test case by case_key and project_key (✅ Working). Also returns a Markdown export of steps.",
    {
      case_key: z.string().min(1),
      project_key: z.string().min(1)
    },
    async (args) => {
      const { case_key, project_key } = args;
      const tc = await client.getTestCaseByKey(case_key, project_key);
      const parsed = TestCaseDetailsSchema.safeParse(tc);
      const data = parsed.success ? parsed.data : tc;
      const md = renderTestCaseMarkdown(tc);
      return {
        content: [
          { type: "text", text: `**JSON Data:**\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`` },
          { type: "text", text: `**Markdown Export:**\n\n${md}` }
        ]
      };
    }
  );

  server.tool(
    "search_test_cases",
    "Search test cases by query (requires project_key or project_id, supports pagination: page, size)",
    {
      project_key: z.string().optional(),
      project_id: z.number().int().positive().optional(),
      query: z.string().min(1),
      page: z.number().int().nonnegative().optional(),   // 0-based
      size: z.number().int().positive().max(200).optional()
    },
    async (args) => {
      const { project_key, project_id, query, page, size } = args;
      if (!project_key && !project_id) {
        throw new Error("Either project_key or project_id must be provided");
      }
      const result = await client.searchTestCases({ 
        query, 
        page, 
        size, 
        projectKey: project_key, 
        projectId: project_id 
      });
      // some instances return {content: [], totalElements, ...}; others return a plain array
      const items = Array.isArray(result) ? result : (Array.isArray(result?.content) ? result.content : []);
      const data = items.map((c: unknown) => {
        const parsed = TestCaseLiteSchema.safeParse(c);
        return parsed.success ? parsed.data : c;
      });
      return { content: [{ type: "text", text: JSON.stringify({ raw: result, items: data }, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("MCP server failed to start:", e);
  process.exit(1);
});