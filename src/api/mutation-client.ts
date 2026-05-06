import axios, { AxiosInstance, AxiosError } from "axios";
import * as fs from "node:fs";
import * as path from "node:path";
import FormData from "form-data";
import { ZebrunnerConfig, ZebrunnerApiError } from "../types/api.js";

/**
 * Dedicated HTTP client for mutation operations (POST / PUT / PATCH)
 * and test-case-settings reads on the Zebrunner Public API.
 *
 * Uses the same Basic-auth pattern as EnhancedZebrunnerClient but is
 * intentionally kept separate so mutation concerns stay isolated from
 * the read-heavy enhanced client.
 */
export class ZebrunnerMutationClient {
  private http: AxiosInstance;
  private config: ZebrunnerConfig;
  private authHeader: string;

  constructor(config: ZebrunnerConfig) {
    this.config = {
      timeout: 60_000,
      retryAttempts: 3,
      retryDelay: 1000,
      debug: false,
      ...config,
    };

    const hasCredentials = !!(this.config.username?.trim() && this.config.token?.trim());

    const baseURL = this.config.baseUrl.replace(/\/+$/, "");
    const basic = hasCredentials
      ? Buffer.from(`${this.config.username}:${this.config.token}`, "utf8").toString("base64")
      : "";
    this.authHeader = basic ? `Basic ${basic}` : "";

    this.http = axios.create({
      baseURL,
      timeout: this.config.timeout,
      headers: {
        ...(this.authHeader ? { Authorization: this.authHeader } : {}),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    if (this.config.debug) {
      this.http.interceptors.request.use((req) => {
        console.error(
          `🔧 [MutationClient] ${req.method?.toUpperCase()} ${req.url}`,
        );
        return req;
      });
    }
  }

  // --------------- Test Cases ---------------

  async createTestCase(
    projectKey: string,
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    const response = await this.request("POST", "/test-cases", payload, {
      projectKey,
    });
    return response.data;
  }

  async updateTestCaseById(
    projectKey: string,
    id: number,
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    const response = await this.request(
      "PATCH",
      `/test-cases/${id}`,
      payload,
      { projectKey },
    );
    return response.data;
  }

  async updateTestCaseByKey(
    projectKey: string,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    const response = await this.request(
      "PATCH",
      `/test-cases/key:${key}`,
      payload,
      { projectKey },
    );
    return response.data;
  }

  async getTestCaseById(
    projectKey: string,
    id: number,
  ): Promise<{ data: Record<string, unknown> }> {
    return this.get(`/test-cases/${id}`, { projectKey });
  }

  async getTestCaseByKey(
    projectKey: string,
    key: string,
  ): Promise<{ data: Record<string, unknown> }> {
    return this.get(`/test-cases/key:${key}`, { projectKey });
  }

  // --------------- Test Suites ---------------

  async createTestSuite(
    projectKey: string,
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    const response = await this.request("POST", "/test-suites", payload, {
      projectKey,
    });
    return response.data;
  }

  async updateTestSuite(
    projectKey: string,
    id: number,
    payload: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown> }> {
    const response = await this.request(
      "PUT",
      `/test-suites/${id}`,
      payload,
      { projectKey },
    );
    return response.data;
  }

  async getTestSuiteById(
    projectKey: string,
    id: number,
  ): Promise<{ data: Record<string, unknown> }> {
    return this.get(`/test-suites/${id}`, { projectKey });
  }

  // --------------- Test Runs ---------------

  async createTestRun(
    projectKey: string,
    payload: Record<string, unknown>,
    opts?: { skipErrors?: boolean; createMissingConfigurations?: boolean },
  ): Promise<{ data: Record<string, unknown> }> {
    const params: Record<string, string> = { projectKey };
    if (opts?.skipErrors !== undefined) params.skipErrors = String(opts.skipErrors);
    if (opts?.createMissingConfigurations !== undefined)
      params.createMissingConfigurations = String(opts.createMissingConfigurations);
    const response = await this.request("POST", "/test-runs", payload, params);
    return response.data;
  }

  async updateTestRun(
    projectKey: string,
    id: number,
    payload: Record<string, unknown>,
    opts?: { skipErrors?: boolean; createMissingConfigurations?: boolean },
  ): Promise<{ data: Record<string, unknown> }> {
    const params: Record<string, string> = { projectKey };
    if (opts?.skipErrors !== undefined) params.skipErrors = String(opts.skipErrors);
    if (opts?.createMissingConfigurations !== undefined)
      params.createMissingConfigurations = String(opts.createMissingConfigurations);
    const response = await this.request("PATCH", `/test-runs/${id}`, payload, params);
    return response.data;
  }

  async addTestCasesToRun(
    projectKey: string,
    runId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      const normalized = ZebrunnerMutationClient.normalizeEscapes(payload) as Record<string, unknown>;
      const body = ZebrunnerMutationClient.asciiSafeStringify(normalized);
      await this.http.post(`/test-runs/${runId}/test-cases`, body, {
        params: { projectKey },
        transformRequest: [(d: unknown) => d],
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async importTestCaseResults(
    projectKey: string,
    runId: number,
    payload: Record<string, unknown>,
    opts?: { skipErrors?: boolean; addMissingTestCases?: boolean },
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    const params: Record<string, string> = { projectKey };
    if (opts?.skipErrors !== undefined) params.skipErrors = String(opts.skipErrors);
    if (opts?.addMissingTestCases !== undefined) params.addMissingTestCases = String(opts.addMissingTestCases);
    const response = await this.request("POST", `/test-runs/${runId}/test-cases:import`, payload, params);
    return response.data;
  }

  // --------------- Test Case Settings ---------------

  async getAutomationStates(
    projectKey: string,
  ): Promise<{ items: Array<{ id: number; name: string; isDefault: boolean }> }> {
    return this.get("/test-case-settings/automation-states", { projectKey });
  }

  async getPriorities(
    projectKey: string,
  ): Promise<{ items: Array<{ id: number; name: string; isDefault: boolean }> }> {
    return this.get("/test-case-settings/priorities", { projectKey });
  }

  async getCustomFields(
    projectKey: string,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    return this.get("/test-case-settings/custom-fields", { projectKey });
  }

  // --------------- File Operations (internal) ---------------

  async uploadFile(
    filePath: string,
  ): Promise<{ data: { uuid: string; name: string; contentType: string; sizeInBytes: number } }> {
    try {
      const form = new FormData();
      form.append("file", fs.createReadStream(filePath), {
        filename: path.basename(filePath),
      });

      const response = await this.http.post("/files", form, {
        headers: {
          ...form.getHeaders(),
          Authorization: this.authHeader,
        },
        maxBodyLength: 104_857_600,     // 100 MB
        maxContentLength: 104_857_600,  // 100 MB
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  async downloadFile(
    fileUuid: string,
  ): Promise<{ buffer: Buffer; name: string; contentType: string }> {
    try {
      const response = await this.http.get(`/files/${fileUuid}`, {
        responseType: "arraybuffer",
        headers: {
          Accept: "*/*",
        },
      });

      const contentType =
        (response.headers["content-type"] as string) || "application/octet-stream";
      const disposition =
        (response.headers["content-disposition"] as string) || "";
      const nameMatch = disposition.match(/filename="?([^";\s]+)"?/);
      const name = nameMatch?.[1] || `${fileUuid}.bin`;

      return {
        buffer: Buffer.from(response.data),
        name,
        contentType,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  // --------------- Internals ---------------

  private async get<T = unknown>(
    url: string,
    params: Record<string, string>,
  ): Promise<T> {
    try {
      const response = await this.http.get(url, {
        params,
        timeout: 15_000,
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * LLMs often emit literal escape sequences (\n, \t, \r) as two-character
   * strings instead of actual control characters. Recursively normalise
   * every string value in the payload before serialisation.
   */
  private static normalizeEscapes(obj: unknown): unknown {
    if (typeof obj === "string") {
      return obj.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
    }
    if (Array.isArray(obj)) return obj.map(ZebrunnerMutationClient.normalizeEscapes);
    if (obj && typeof obj === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = ZebrunnerMutationClient.normalizeEscapes(v);
      }
      return out;
    }
    return obj;
  }

  /**
   * Produce ASCII-safe JSON: all non-ASCII chars become \uXXXX escapes.
   * Prevents TCM-1019 parser errors from LLM-generated Unicode
   * (em-dashes, arrows, smart quotes, etc.) while remaining valid JSON.
   */
  private static asciiSafeStringify(obj: unknown): string {
    return JSON.stringify(obj).replace(
      /[^\x00-\x7F]/g,
      (ch) => {
        const code = ch.charCodeAt(0);
        return `\\u${code.toString(16).padStart(4, "0")}`;
      },
    );
  }

  private async request(
    method: "POST" | "PUT" | "PATCH",
    url: string,
    data: Record<string, unknown>,
    params: Record<string, string>,
  ) {
    try {
      const normalized = ZebrunnerMutationClient.normalizeEscapes(data) as Record<string, unknown>;
      const body = ZebrunnerMutationClient.asciiSafeStringify(normalized);
      return await this.http.request({
        method,
        url,
        data: body,
        params,
        transformRequest: [(d: unknown) => d],
      });
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: unknown): ZebrunnerApiError {
    if (error instanceof AxiosError) {
      const status = error.response?.status;
      const responseData = error.response?.data;
      const endpoint = error.config?.url;

      let message = error.message || "API request failed";
      if (
        typeof responseData === "object" &&
        responseData &&
        "message" in responseData
      ) {
        message = (responseData as { message: string }).message;
      }

      const fieldErrors =
        responseData &&
        typeof responseData === "object" &&
        "errors" in responseData &&
        Array.isArray((responseData as { errors: unknown[] }).errors)
          ? (responseData as { errors: Array<{ source: string; message: string }> }).errors
              .map((e) => `  ${e.source}: ${e.message}`)
              .join("\n")
          : undefined;

      const fullMessage = fieldErrors
        ? `${message}\nField errors:\n${fieldErrors}`
        : message;

      return new ZebrunnerApiError(fullMessage, status, responseData, endpoint);
    }
    if (error instanceof Error) {
      return new ZebrunnerApiError(error.message);
    }
    return new ZebrunnerApiError("Unknown mutation client error");
  }
}
