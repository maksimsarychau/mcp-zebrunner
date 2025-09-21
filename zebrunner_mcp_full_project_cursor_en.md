# Zebrunner TCM MCP (TypeScript) — Full Project Scaffold for Cursor (English, from scratch)

This single guide gives you **everything** you need to build a **Model Context Protocol (MCP)** server in **TypeScript** that talks to **Zebrunner Test Case Management (TCM) Public API** using **Basic Auth**. It’s designed for **Cursor** users and integrates cleanly with **Claude Code/Desktop**.

You’ll get:
- A working **stdio MCP server** with tools:
  - `list_projects`
  - `list_test_cases` (by `project_id`)
  - `get_test_case` (by global `case_id`)
  - `get_test_case_by_project` (by `project_id` + `case_id`)
  - `search_test_cases` (by `query`, with pagination)
- **Markdown export of steps** returned together with test case details.
- Clean env-based configuration: `ZEBRUNNER_URL`, `ZEBRUNNER_LOGIN`, `ZEBRUNNER_TOKEN`.
- Step-by-step install/build/run instructions and how to add it to Claude (`claude mcp add …`).

> ⚠️ **Endpoint note.** Zebrunner instances may vary. If you get 404/401, adjust endpoint paths in `zebrunnerClient.ts` to match your workspace’s Public API. Typical base is `https://<workspace>.zebrunner.com/api/public/v1` (no trailing slash).

---

## 1) Create the project structure

In Cursor, create a new empty folder (e.g. `zebrunner-mcp-ts`) and add files exactly as below:

```
zebrunner-mcp-ts/
├─ src/
│  ├─ index.ts
│  ├─ zebrunnerClient.ts
│  └─ types.ts
├─ .env.example
├─ .gitignore
├─ package.json
├─ tsconfig.json
└─ README.md   (optional, you can paste this whole guide)
```

---

## 2) package.json

```json
{
  "name": "zebrunner-mcp-ts",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "MCP server (stdio) for Zebrunner TCM Public API (read-only)",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "smoke": "tsx src/smoke.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^0.1.4",
    "@modelcontextprotocol/stdio": "^0.1.4",
    "axios": "^1.7.3",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.17.0",
    "typescript": "^5.6.3"
  }
}
```

> If newer MCP SDK versions exist, bump the `@modelcontextprotocol/*` versions accordingly.

---

## 3) tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

---

## 4) .gitignore

```
node_modules
dist
.env
.DS_Store
```

---

## 5) .env.example

```env
# Zebrunner TCM Public API base (no trailing slash)
ZEBRUNNER_URL=https://mfp.zebrunner.com/api/public/v1
# Login (often your Zebrunner email)
ZEBRUNNER_LOGIN=your.login@example.com
# Personal API token from Zebrunner profile
ZEBRUNNER_TOKEN=YOUR_API_TOKEN
```

Copy this to `.env` for local testing (but prefer passing envs via `claude mcp add --env` in real use).

---

## 6) src/types.ts

```ts
import { z } from "zod";

/** Input schemas for MCP tools */
export const ListTestCasesSchema = z.object({
  project_id: z.number().int().positive()
});

export const GetTestCaseSchema = z.object({
  case_id: z.number().int().positive()
});

export const GetTestCaseByProjectSchema = z.object({
  project_id: z.number().int().positive(),
  case_id: z.number().int().positive()
});

export const SearchTestCasesSchema = z.object({
  project_id: z.number().int().positive(),
  query: z.string().min(1),
  page: z.number().int().nonnegative().optional(),   // 0-based
  size: z.number().int().positive().max(200).optional()
});

/** Minimal response models (adjust to your instance as needed) */
export const ProjectSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  key: z.string().optional()
});

export const TestCaseLiteSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  status: z.string().optional()
});

export const TestCaseDetailsSchema = z.object({
  id: z.number(),
  title: z.string().optional(),
  status: z.string().optional(),
  description: z.string().optional(),
  // We keep steps flexible until we know your exact shape
  steps: z.array(z.record(z.any())).optional()
});

export type Project = z.infer<typeof ProjectSchema>;
export type TestCaseLite = z.infer<typeof TestCaseLiteSchema>;
export type TestCaseDetails = z.infer<typeof TestCaseDetailsSchema>;
```

---

## 7) src/zebrunnerClient.ts

```ts
import axios, { AxiosInstance } from "axios";

export interface ZebrunnerConfig {
  baseUrl: string;      // e.g. https://mfp.zebrunner.com/api/public/v1
  username: string;     // Zebrunner login (email)
  token: string;        // Personal API token
}

export interface SearchParams {
  page?: number; // 0-based
  size?: number; // page size
  query?: string;
}

/**
 * Zebrunner TCM Public API client (Basic Auth).
 * NOTE: Endpoints may vary across instances.
 * If you get 404/400, adjust these paths for your workspace:
 *  - /projects
 *  - /projects/{projectId}/test-cases
 *  - /test-cases/{caseId}  (or /projects/{projectId}/test-cases/{caseId})
 *  - /projects/{projectId}/test-cases/search?query=...&page=...&size=...
 */
export class ZebrunnerClient {
  private http: AxiosInstance;

  constructor(cfg: ZebrunnerConfig) {
    const { baseUrl, username, token } = cfg;
    const baseURL = baseUrl.replace(/\/+$/, ""); // trim trailing slash
    const basic = Buffer.from(`${username}:${token}`, "utf8").toString("base64");

    this.http = axios.create({
      baseURL,
      timeout: 30_000,
      headers: {
        Authorization: `Basic ${basic}`
      }
    });
  }

  async listProjects(): Promise<any[]> {
    const res = await this.http.get("/projects");
    return res.data;
  }

  async listTestCases(projectId: number): Promise<any[]> {
    const res = await this.http.get(`/projects/${projectId}/test-cases`);
    return res.data;
  }

  async getTestCase(caseId: number): Promise<any> {
    // If your instance requires projectId for details, use getTestCaseByProject instead.
    const res = await this.http.get(`/test-cases/${caseId}`);
    return res.data;
  }

  async getTestCaseByProject(projectId: number, caseId: number): Promise<any> {
    const res = await this.http.get(`/projects/${projectId}/test-cases/${caseId}`);
    return res.data;
  }

  async searchTestCases(projectId: number, params: SearchParams): Promise<any> {
    const { page, size, query } = params;
    const res = await this.http.get(`/projects/${projectId}/test-cases/search`, {
      params: { query, page, size }
    });
    return res.data;
  }
}
```

---

## 8) src/index.ts (MCP server with Markdown step export)

```ts
import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/stdio";
import { Server, Tool } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListTestCasesSchema,
  GetTestCaseSchema,
  GetTestCaseByProjectSchema,
  SearchTestCasesSchema,
  ProjectSchema,
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
  const title = tcRaw?.title ?? "(no title)";
  const status = tcRaw?.status ?? "(unknown)";
  const description = tcRaw?.description ?? "";

  const header = `# Test Case: ${title}\n\n- **ID:** ${id}\n- **Status:** ${status}\n\n`;
  const descBlock = description ? `## Description\n\n${description}\n\n` : "";
  const steps = Array.isArray(tcRaw?.steps) ? tcRaw.steps : [];

  if (!steps.length) {
    return `${header}${descBlock}## Steps\n\n_No explicit steps provided._\n`;
  }

  const lines: string[] = [];
  lines.push(`${header}${descBlock}## Steps\n`);

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

/** ---------- MCP tools ---------- */

const listProjectsTool: Tool = {
  name: "list_projects",
  description: "Return list of Zebrunner projects available to the user",
  inputSchema: z.object({}),
  async invoke() {
    const projects = await client.listProjects();
    const data = projects.map((p: unknown) => {
      const parsed = ProjectSchema.safeParse(p);
      return parsed.success ? parsed.data : p;
    });
    return { content: [{ type: "json", value: data }] };
  }
};

const listTestCasesTool: Tool = {
  name: "list_test_cases",
  description: "Return list of test cases for a given project_id",
  inputSchema: ListTestCasesSchema,
  async invoke(input) {
    const { project_id } = input as z.infer<typeof ListTestCasesSchema>;
    const cases = await client.listTestCases(project_id);
    const data = cases.map((c: unknown) => {
      const parsed = TestCaseLiteSchema.safeParse(c);
      return parsed.success ? parsed.data : c;
    });
    return { content: [{ type: "json", value: data }] };
  }
};

const getTestCaseTool: Tool = {
  name: "get_test_case",
  description: "Return detailed info of a test case by case_id. Also returns a Markdown export of steps.",
  inputSchema: GetTestCaseSchema,
  async invoke(input) {
    const { case_id } = input as z.infer<typeof GetTestCaseSchema>;
    const tc = await client.getTestCase(case_id);
    const parsed = TestCaseDetailsSchema.safeParse(tc);
    const data = parsed.success ? parsed.data : tc;
    const md = renderTestCaseMarkdown(tc);
    return {
      content: [
        { type: "json", value: data },
        { type: "text", text: md }
      ]
    };
  }
};

const getTestCaseByProjectTool: Tool = {
  name: "get_test_case_by_project",
  description: "Return detailed info of a test case by project_id and case_id (use if your API requires project context). Also returns a Markdown export of steps.",
  inputSchema: GetTestCaseByProjectSchema,
  async invoke(input) {
    const { project_id, case_id } = input as z.infer<typeof GetTestCaseByProjectSchema>;
    const tc = await client.getTestCaseByProject(project_id, case_id);
    const parsed = TestCaseDetailsSchema.safeParse(tc);
    const data = parsed.success ? parsed.data : tc;
    const md = renderTestCaseMarkdown(tc);
    return {
      content: [
        { type: "json", value: data },
        { type: "text", text: md }
      ]
    };
  }
};

const searchTestCasesTool: Tool = {
  name: "search_test_cases",
  description: "Search test cases in a project by query (supports pagination: page, size). Returns JSON list.",
  inputSchema: SearchTestCasesSchema,
  async invoke(input) {
    const { project_id, query, page, size } = input as z.infer<typeof SearchTestCasesSchema>;
    const result = await client.searchTestCases(project_id, { query, page, size });
    // some instances return {content: [], totalElements, ...}; others return a plain array
    const items = Array.isArray(result) ? result : (Array.isArray(result?.content) ? result.content : []);
    const data = items.map((c: unknown) => {
      const parsed = TestCaseLiteSchema.safeParse(c);
      return parsed.success ? parsed.data : c;
    });
    return { content: [{ type: "json", value: { raw: result, items: data } }] };
  }
};

/** ---------- Bootstrap MCP ---------- */

async function main() {
  const transport = new StdioServerTransport();
  const server = new Server(
    { name: "zebrunner-mcp", version: "1.0.0" },
    { transport }
  );

  server.addTool(listProjectsTool);
  server.addTool(listTestCasesTool);
  server.addTool(getTestCaseTool);
  server.addTool(getTestCaseByProjectTool);
  server.addTool(searchTestCasesTool);

  await server.start();
}

main().catch((e) => {
  console.error("MCP server failed to start:", e);
  process.exit(1);
});
```

---

## 9) Install, build, run

```bash
# 1) Install deps
npm i

# 2) (optional) local .env test
cp .env.example .env
# ... fill values ...

# 3) Build
npm run build

# 4) Start MCP server (it waits for an MCP client via stdio — Claude)
npm start
```

> For quick API-only checks (without MCP wiring), you can temporarily create a `src/smoke.ts` that imports and calls `ZebrunnerClient`, then run `npm run smoke`. Not required for Claude/stdio usage.

---

## 10) Hook it into Claude Code/Desktop

Run from your project root:

```bash
claude mcp add zebrunner \
  --env ZEBRUNNER_URL="https://mfp.zebrunner.com/api/public/v1" \
  --env ZEBRUNNER_LOGIN="your.login@example.com" \
  --env ZEBRUNNER_TOKEN="YOUR_API_TOKEN" \
  -- node dist/index.js
```

- `zebrunner` is the name of this MCP integration.
- Env vars are passed securely to the process.
- Claude will launch your server as a stdio MCP process when needed.

**Usage examples (natural language, inside Claude):**
- “List projects from Zebrunner” → calls `list_projects`
- “Search test cases in project 2 for ‘login’ (page 0 size 50)” → `search_test_cases`
- “List test cases for project 2” → `list_test_cases`
- “Get test case 101 details” → `get_test_case` (returns JSON + Markdown steps)
- “Get test case 101 in project 2 details” → `get_test_case_by_project` (JSON + Markdown)

---

## 11) Troubleshooting & tailoring

- **401/404**: Verify `ZEBRUNNER_URL` (no trailing slash), login/token, and adjust endpoints in `zebrunnerClient.ts` to your instance. Some setups require project context for case details (`getTestCaseByProject`).  
- **Search shape**: If your API returns search results differently, adapt `searchTestCases` (e.g., different path or no paging).  
- **Security**: Don’t commit `.env`. Prefer passing secrets via `claude mcp add --env` or your desktop client’s MCP UI.  
- **Output**: You get both structured JSON and a rich Markdown export of steps for human-friendly review. Ask Claude to compare the Markdown vs your code.

---

## 12) What to add next

- `get_project_by_key` and in-memory key→id cache.  
- Export test case as a standalone Markdown/MDX file (artifact).  
- A tool that **compares** Zebrunner steps with your PageObjects/tests and returns a diff.  
- Pagination/filters (e.g., by `status`, `labels`) for `list_test_cases`.  
- Global error handling with friendlier messages (e.g., surfacing rate limits).

---

**You’re done.** This is a complete, from-scratch TypeScript MCP server for Zebrunner TCM that you can paste into Cursor, build, and wire to Claude. Happy shipping! 🚀
