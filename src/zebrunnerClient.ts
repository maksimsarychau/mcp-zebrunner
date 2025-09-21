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
  projectKey?: string;
  projectId?: number;
}

export interface TestSuiteParams {
  projectKey?: string;
  projectId?: number;
}

/**
 * Zebrunner TCM Public API client (Basic Auth).
 * NOTE: Endpoints may vary across instances.
 * Current working endpoints for this instance:
 *  - /test-suites?projectKey=...&projectId=...
 *  - /test-suites/{suiteId}/test-cases
 *  - /test-cases/{caseId}
 *  - /test-cases/search?query=...&projectKey=...&page=...&size=...
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

  async listTestSuites(params: TestSuiteParams): Promise<any[]> {
    const { projectKey, projectId } = params;
    const res = await this.http.get("/test-suites", {
      params: { projectKey, projectId }
    });
    // API returns {items: [], _meta: {}} structure
    return Array.isArray(res.data) ? res.data : (res.data?.items || []);
  }

  async getTestSuite(suiteId: number): Promise<any> {
    const res = await this.http.get(`/test-suites/${suiteId}`);
    return res.data;
  }

  async listTestCases(suiteId: number): Promise<any[]> {
    const res = await this.http.get(`/test-suites/${suiteId}/test-cases`);
    // API returns {items: [], _meta: {}} structure
    return Array.isArray(res.data) ? res.data : (res.data?.items || []);
  }

  async getTestCase(caseId: number): Promise<any> {
    const res = await this.http.get(`/test-cases/${caseId}`);
    return res.data;
  }

  async getTestCaseByKey(caseKey: string, projectKey: string): Promise<any> {
    const res = await this.http.get(`/test-cases/key:${caseKey}`, {
      params: { projectKey }
    });
    // API returns {data: {...}} structure for this endpoint
    return res.data?.data || res.data;
  }

  async searchTestCases(params: SearchParams): Promise<any> {
    const { page, size, query, projectKey, projectId } = params;
    const res = await this.http.get("/test-cases/search", {
      params: { query, page, size, projectKey, projectId }
    });
    // Return the full response for search (includes pagination info)
    return res.data;
  }
}
