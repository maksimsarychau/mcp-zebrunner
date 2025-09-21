import axios, { AxiosInstance, AxiosError } from "axios";
import {
  ZebrunnerConfig,
  PaginationOptions,
  TestCaseSearchParams,
  TestSuiteSearchParams,
  TestRunSearchParams,
  ZebrunnerApiError,
  ZebrunnerAuthError,
  ZebrunnerNotFoundError,
  ZebrunnerRateLimitError
} from "../types/api.js";
import {
  ZebrunnerTestCase,
  ZebrunnerShortTestCase,
  ZebrunnerTestSuite,
  ZebrunnerTestExecutionItem,
  ZebrunnerTestRun,
  ZebrunnerTestResultResponse,
  PagedResponse,
  ZebrunnerTestCaseSchema,
  ZebrunnerShortTestCaseSchema,
  ZebrunnerTestSuiteSchema,
  ZebrunnerTestExecutionItemSchema,
  ZebrunnerTestRunSchema,
  ZebrunnerTestResultResponseSchema
} from "../types/core.js";

export class ZebrunnerApiClient {
  private http: AxiosInstance;
  private config: ZebrunnerConfig;

  constructor(config: ZebrunnerConfig) {
    this.config = {
      timeout: 30_000,
      retryAttempts: 3,
      retryDelay: 1000,
      debug: false,
      defaultPageSize: 50,
      maxPageSize: 200,
      ...config
    };

    const baseURL = this.config.baseUrl.replace(/\/+$/, "");
    const basic = Buffer.from(`${this.config.username}:${this.config.token}`, "utf8").toString("base64");

    this.http = axios.create({
      baseURL,
      timeout: this.config.timeout,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json'
      }
    });

    // Add request/response interceptors
    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.http.interceptors.request.use(
      (config) => {
        if (this.config.debug) {
          console.log(`[Zebrunner API] ${config.method?.toUpperCase()} ${config.url}`);
          if (config.params) {
            console.log(`[Zebrunner API] Params:`, config.params);
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.http.interceptors.response.use(
      (response) => {
        if (this.config.debug) {
          console.log(`[Zebrunner API] Response: ${response.status} ${response.statusText}`);
        }
        return response;
      },
      (error: AxiosError) => {
        return Promise.reject(this.handleApiError(error));
      }
    );
  }

  private handleApiError(error: AxiosError): ZebrunnerApiError {
    const status = error.response?.status;
    const endpoint = error.config?.url;
    const responseData = error.response?.data;

    switch (status) {
      case 401:
        return new ZebrunnerAuthError('Invalid credentials or token expired');
      case 404:
        return new ZebrunnerNotFoundError('Resource', endpoint || 'unknown');
      case 429:
        const retryAfter = error.response?.headers['retry-after'];
        return new ZebrunnerRateLimitError(retryAfter ? parseInt(retryAfter) : undefined);
      default:
        return new ZebrunnerApiError(
          error.message || 'API request failed',
          status,
          responseData,
          endpoint
        );
    }
  }

  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    attempts: number = this.config.retryAttempts || 3
  ): Promise<T> {
    for (let i = 0; i < attempts; i++) {
      try {
        return await requestFn();
      } catch (error) {
        if (i === attempts - 1 || error instanceof ZebrunnerAuthError) {
          throw error;
        }
        
        const delay = this.config.retryDelay! * Math.pow(2, i); // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Retry attempts exhausted');
  }

  // Test Cases API
  async getTestCases(
    projectKey: string, 
    options: TestCaseSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerShortTestCase>> {
    return this.retryRequest(async () => {
      const params = {
        projectKey,
        page: options.page,
        size: options.size || this.config.defaultPageSize,
        suiteId: options.suiteId,
        rootSuiteId: options.rootSuiteId,
        status: options.status,
        priority: options.priority,
        automationState: options.automationState
      };

      const response = await this.http.get('/test-cases', { params });
      const data = response.data;
      
      // Handle different response formats
      if (Array.isArray(data)) {
        return { items: data.map(item => ZebrunnerShortTestCaseSchema.parse(item)) };
      } else if (data.items) {
        return {
          items: data.items.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item)),
          _meta: data._meta
        };
      }
      
      return { items: [] };
    });
  }

  async getAllTestCases(projectKey: string, options: Omit<TestCaseSearchParams, 'page' | 'size'> = {}): Promise<ZebrunnerShortTestCase[]> {
    const allItems: ZebrunnerShortTestCase[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getTestCases(projectKey, { ...options, page, size: this.config.maxPageSize });
      allItems.push(...response.items);
      
      hasMore = response._meta?.hasNext || false;
      page++;
    }

    return allItems;
  }

  async getTestCaseByKey(projectKey: string, key: string): Promise<ZebrunnerTestCase> {
    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-cases/key:${key}`, {
        params: { projectKey }
      });
      
      const data = response.data?.data || response.data;
      return ZebrunnerTestCaseSchema.parse(data);
    });
  }

  async getTestCaseById(projectKey: string, id: number): Promise<ZebrunnerTestCase> {
    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-cases/${id}`, {
        params: { projectKey }
      });
      
      return ZebrunnerTestCaseSchema.parse(response.data);
    });
  }

  // Test Suites API
  async getTestSuites(
    projectKey: string,
    options: TestSuiteSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerTestSuite>> {
    return this.retryRequest(async () => {
      const params = {
        projectKey,
        page: options.page,
        size: options.size || this.config.defaultPageSize,
        parentSuiteId: options.parentSuiteId
      };

      const response = await this.http.get('/test-suites', { params });
      const data = response.data;
      
      if (Array.isArray(data)) {
        return { items: data.map(item => ZebrunnerTestSuiteSchema.parse(item)) };
      } else if (data.items) {
        return {
          items: data.items.map((item: any) => ZebrunnerTestSuiteSchema.parse(item)),
          _meta: data._meta
        };
      }
      
      return { items: [] };
    });
  }

  async getAllTestSuites(projectKey: string, options: Omit<TestSuiteSearchParams, 'page' | 'size'> = {}): Promise<ZebrunnerTestSuite[]> {
    const allItems: ZebrunnerTestSuite[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await this.getTestSuites(projectKey, { ...options, page, size: this.config.maxPageSize });
      allItems.push(...response.items);
      
      hasMore = response._meta?.hasNext || false;
      page++;
    }

    return allItems;
  }

  async getRootSuites(projectKey: string): Promise<ZebrunnerTestSuite[]> {
    const allSuites = await this.getAllTestSuites(projectKey);
    return allSuites.filter(suite => !suite.parentSuiteId);
  }

  // Test Runs API
  async getTestRuns(
    projectKey: string,
    options: TestRunSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerTestExecutionItem>> {
    return this.retryRequest(async () => {
      const params = {
        projectKey,
        page: options.page,
        size: options.size || this.config.defaultPageSize,
        status: options.status,
        milestone: options.milestone,
        build: options.build,
        environment: options.environment
      };

      const response = await this.http.get('/test-runs', { params });
      const data = response.data;
      
      if (Array.isArray(data)) {
        return { items: data.map(item => ZebrunnerTestExecutionItemSchema.parse(item)) };
      } else if (data.items) {
        return {
          items: data.items.map((item: any) => ZebrunnerTestExecutionItemSchema.parse(item)),
          _meta: data._meta
        };
      }
      
      return { items: [] };
    });
  }

  async getTestRunById(projectKey: string, runId: number): Promise<ZebrunnerTestRun> {
    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-runs/${runId}`, {
        params: { projectKey }
      });
      
      return ZebrunnerTestRunSchema.parse(response.data);
    });
  }

  async getTestResults(projectKey: string, runId: number): Promise<ZebrunnerTestResultResponse[]> {
    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-runs/${runId}/test-cases`, {
        params: { projectKey }
      });
      
      const data = Array.isArray(response.data) ? response.data : response.data?.items || [];
      return data.map((item: any) => ZebrunnerTestResultResponseSchema.parse(item));
    });
  }

  // Search and Filter Methods
  async searchTestCases(
    projectKey: string,
    query: string,
    options: Omit<TestCaseSearchParams, 'projectKey' | 'query'> = {}
  ): Promise<PagedResponse<ZebrunnerShortTestCase>> {
    return this.retryRequest(async () => {
      const params = {
        projectKey,
        query,
        page: options.page,
        size: options.size || this.config.defaultPageSize,
        suiteId: options.suiteId,
        status: options.status,
        priority: options.priority,
        automationState: options.automationState
      };

      const response = await this.http.get('/test-cases/search', { params });
      const data = response.data;
      
      if (Array.isArray(data)) {
        return { items: data.map(item => ZebrunnerShortTestCaseSchema.parse(item)) };
      } else if (data.items) {
        return {
          items: data.items.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item)),
          _meta: data._meta
        };
      }
      
      return { items: [] };
    });
  }

  async getTestCasesBySuite(projectKey: string, suiteId: number): Promise<ZebrunnerShortTestCase[]> {
    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-suites/${suiteId}/test-cases`, {
        params: { projectKey }
      });
      
      const data = Array.isArray(response.data) ? response.data : response.data?.items || [];
      return data.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item));
    });
  }

  async getTestCasesByRootSuite(projectKey: string, rootSuiteId: number): Promise<ZebrunnerShortTestCase[]> {
    const allCases = await this.getAllTestCases(projectKey, { rootSuiteId });
    return allCases;
  }
}

