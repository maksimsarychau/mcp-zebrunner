# MCP for Zebrunner TCM (TypeScript) — Cursor Guide (v2)

> Обновление: добавлены инструменты **`get_test_case_by_project`**, **`search_test_cases`** и **подробный экспорт шагов в Markdown** для `get_test_case*`. Ниже — полный пошаговый гайд под Cursor с кодом.

---

## 🚀 Что получится

- **MCP-сервер (stdio)** на TypeScript для **Zebrunner TCM Public API** (Basic Auth).
- Инструменты:
  - `list_projects` — список проектов
  - `list_test_cases` — список тест-кейсов по `project_id`
  - `get_test_case` — детали кейса по `case_id`
  - `get_test_case_by_project` — детали кейса по `project_id` + `case_id` (если инстанс требует контекста проекта)
  - `search_test_cases` — поиск кейсов по `query` в проекте (с пагинацией)
- **Экспорт шагов кейса в Markdown** (добавляется к ответу `get_test_case*` как `content: text`).

---

## 📦 Структура проекта

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
└─ README.md  (опционально)
```

---

## 🔧 package.json

```json
{
  "name": "zebrunner-mcp-ts",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "description": "MCP server (stdio) for Zebrunner TCM Public API (read-only)",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js"
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

---

## 📐 tsconfig.json

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

## 🧬 .gitignore

```
node_modules
dist
.env
.DS_Store
```

---

## 🔑 .env.example

```env
# База публичного API Zebrunner TCM (без завершающего /)
ZEBRUNNER_URL=https://mfp.zebrunner.com/api/public/v1
# Логин (обычно e-mail в Zebrunner)
ZEBRUNNER_LOGIN=your.login@example.com
# Персональный API-токен из профиля Zebrunner
ZEBRUNNER_TOKEN=YOUR_API_TOKEN
```

---

## 🧩 src/types.ts

```ts
import { z } from "zod";

/** Входные схемы для инструментов MCP */
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

/** Простейшие модели ответа (минимальные поля; дополни под свой инстанс) */
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
  // допускаем любые поля внутри шага (пока не знаем точную схему инстанса)
  steps: z.array(z.record(z.any())).optional()
});

/** Типы для TS */
export type Project = z.infer<typeof ProjectSchema>;
export type TestCaseLite = z.infer<typeof TestCaseLiteSchema>;
export type TestCaseDetails = z.infer<typeof TestCaseDetailsSchema>;
```

---

## 🌐 src/zebrunnerClient.ts

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
 * Клиент для Zebrunner TCM Public API с Basic Auth.
 * ВНИМАНИЕ: пути эндпоинтов могут отличаться по инстансу.
 * Если получаете 404/400, проверьте и поправьте пути под ваш workspace:
 *  - /projects
 *  - /projects/{projectId}/test-cases
 *  - /test-cases/{caseId}  (или /projects/{projectId}/test-cases/{caseId})
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
    // Если у вас требуется projectId — используйте getTestCaseByProject.
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
      params: {
        query,
        page,
        size
      }
    });
    return res.data;
  }
}
```

---

## 🧠 src/index.ts (MCP server + Markdown экспорт шагов)

```ts
// full index.ts code from previous step
```
