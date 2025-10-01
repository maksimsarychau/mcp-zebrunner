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
          console.error(`[Zebrunner API] ${config.method?.toUpperCase()} ${config.url}`);
          if (config.params) {
            console.error(`[Zebrunner API] Params:`, config.params);
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
          console.error(`[Zebrunner API] Response: ${response.status} ${response.statusText}`);
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
      const params: any = {
        projectKey,
        maxPageSize: Math.min(options.size || this.config.defaultPageSize || 50, 100), // Limit to 100 as per API requirements
        suiteId: options.suiteId,
        rootSuiteId: options.rootSuiteId,
        status: options.status,
        priority: options.priority,
        automationState: options.automationState,
        filter: options.filter // Add filter parameter support
      };

      // Use token-based pagination instead of page-based
      if (options.pageToken) {
        params.pageToken = options.pageToken; // Use 'pageToken' not 'nextPageToken' as per API spec
      }

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
      const seenIds = new Set<number>(); // Track seen IDs to avoid duplicates
      let page = 0;
      let hasMore = true;
  
      while (hasMore) {
        const response = await this.getTestCases(projectKey, { ...options, page, size: this.config.maxPageSize });
        
        // Filter out duplicates and add only new items
        const newItems = response.items.filter((item: any) => {
          if (seenIds.has(item.id)) {
            return false; // Skip duplicates
          }
          seenIds.add(item.id);
          return true;
        });
        
        allItems.push(...newItems);
        
        // Stop if response is empty OR there's no _meta section OR no nextPageToken in _meta
        // OR if we got no new items (all were duplicates)
        hasMore = response.items.length > 0 && 
                  !!response._meta && 
                  !!response._meta.nextPageToken &&
                  newItems.length > 0;
        page++;
        
        if (this.config.debug) {
          console.error(`📄 [getAllTestCases] Page ${page}: ${response.items.length} items, ${newItems.length} new (total: ${allItems.length})`);
          console.error(`📄 [getAllTestCases] _meta exists: ${!!response._meta}, nextPageToken: ${response._meta?.nextPageToken ? 'Available' : 'None'} - hasMore: ${hasMore}`);
        }
        
        // Safety check to prevent infinite loops
        if (page > 100) {
          console.error('⚠️ [getAllTestCases] Stopped after 100 pages to prevent infinite loop');
          break;
        }
      }
  
      return allItems;
    }

  /**
   * Get all test cases for a root suite by filtering on all child suite IDs
   * Uses the filter approach but splits into smaller batches to avoid API limitations
   */
  async getTestCasesByRootSuiteWithFilter(
    projectKey: string, 
    rootSuiteId: number,
    allSuites: any[]
  ): Promise<ZebrunnerShortTestCase[]> {
    // Find all child suites (including the root suite itself if it has direct test cases)
    const childSuiteIds: number[] = [];
    
    // Find all suites that have this root suite as their root (after hierarchy processing)
    for (const suite of allSuites) {
      if (suite.rootSuiteId === rootSuiteId) {
        childSuiteIds.push(suite.id);
      }
    }
    
    if (this.config.debug) {
      console.error(`🔍 [getTestCasesByRootSuiteWithFilter] Root suite ${rootSuiteId} has ${childSuiteIds.length} child suites: [${childSuiteIds.join(', ')}]`);
    }
    
    // Split child suite IDs into smaller batches to avoid API limitations
    const batchSize = 10; // Smaller batches to ensure API compatibility
    const allTestCases: ZebrunnerShortTestCase[] = [];
    const seenIds = new Set<number>(); // Global deduplication across batches
    
    for (let i = 0; i < childSuiteIds.length; i += batchSize) {
      const batch = childSuiteIds.slice(i, i + batchSize);
      const filter = `testSuite.id IN [${batch.join(',')}]`;
      
      if (this.config.debug) {
        console.error(`🔍 [getTestCasesByRootSuiteWithFilter] Batch ${Math.floor(i/batchSize) + 1}: ${filter}`);
      }
      
      try {
        const batchResults = await this.getAllTestCases(projectKey, { filter });
        
        // Deduplicate across batches
        const newItems = batchResults.filter(item => {
          if (seenIds.has(item.id)) {
            return false;
          }
          seenIds.add(item.id);
          return true;
        });
        
        allTestCases.push(...newItems);
        
        if (this.config.debug) {
          console.error(`🔍 [getTestCasesByRootSuiteWithFilter] Batch ${Math.floor(i/batchSize) + 1}: ${batchResults.length} items, ${newItems.length} new (total: ${allTestCases.length})`);
        }
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < childSuiteIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error(`❌ [getTestCasesByRootSuiteWithFilter] Error in batch ${Math.floor(i/batchSize) + 1}: ${(error as Error).message}`);
      }
    }
    
    return allTestCases;
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
      const params: any = {
        projectKey,
        maxPageSize: Math.min(options.size || this.config.defaultPageSize || 50, 100), // Limit to 100 as per API requirements
        parentSuiteId: options.parentSuiteId
      };

      // Use token-based pagination instead of page-based
      if (options.pageToken) {
        params.pageToken = options.pageToken; // Use 'pageToken' not 'nextPageToken' as per API spec
      }

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
    let nextPageToken: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 1000) { // Safety limit to prevent infinite loops
      const response = await this.getTestSuites(projectKey, { 
        ...options, 
        pageToken: nextPageToken,
        size: 100 // Use maximum allowed page size
      });
      
      allItems.push(...response.items);
      
      // Check for next page token in metadata
      nextPageToken = response._meta?.nextPageToken;
      hasMore = !!nextPageToken; // Stop only when nextPageToken is null, regardless of items length
      pageCount++;

      if (this.config.debug) {
        console.error(`📄 Fetched page ${pageCount}: ${response.items.length} suites (total: ${allItems.length})`);
        if (nextPageToken) {
          console.error(`🔗 Next page token: ${nextPageToken.substring(0, 20)}...`);
        }
      }
    }

    if (pageCount >= 1000) {
      console.error('⚠️  Stopped pagination after 1000 pages to prevent infinite loop');
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
        size: Math.min(options.size || this.config.defaultPageSize || 50, this.config.maxPageSize || 200),
        maxPageSize: this.config.maxPageSize,
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

