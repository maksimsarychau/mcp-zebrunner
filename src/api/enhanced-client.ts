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

/**
 * Enhanced Zebrunner API Client with improved error handling
 * 
 * Features:
 * - Intelligent endpoint detection and fallback
 * - Parameter validation before API calls
 * - Improved error messages with suggestions
 * - Automatic response format detection
 * - Connection health checking
 */
export class EnhancedZebrunnerClient {
  private http: AxiosInstance;
  private config: ZebrunnerConfig;
  private suitesCache: Map<string, { suites: ZebrunnerTestSuite[], timestamp: number }> = new Map();
  private endpointHealth: Map<string, boolean> = new Map();
  private lastHealthCheck: Date | null = null;

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
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor with parameter validation
    this.http.interceptors.request.use(
      (config) => {
        if (this.config.debug) {
          console.log(`🔍 [API] ${config.method?.toUpperCase()} ${config.url}`);
          if (config.params && Object.keys(config.params).length > 0) {
            console.log(`🔍 [API] Params:`, config.params);
          }
        }
        
        // Validate required parameters
        this.validateRequestParams(config.url || '', config.params || {});
        
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor with enhanced error handling
    this.http.interceptors.response.use(
      (response) => {
        if (this.config.debug) {
          console.log(`✅ [API] ${response.status} ${response.statusText} - ${response.config.url}`);
        }
        
        // Mark endpoint as healthy
        const endpoint = this.extractEndpointKey(response.config.url || '');
        this.endpointHealth.set(endpoint, true);
        
        return response;
      },
      (error: AxiosError) => {
        // Mark endpoint as unhealthy for certain errors
        const endpoint = this.extractEndpointKey(error.config?.url || '');
        if (error.response?.status === 404 || error.response?.status === 400) {
          this.endpointHealth.set(endpoint, false);
        }
        
        return Promise.reject(this.handleApiError(error));
      }
    );
  }

  private validateRequestParams(url: string, params: any): void {
    // Validate project key format
    if (params.projectKey) {
      if (typeof params.projectKey !== 'string' || params.projectKey.trim() === '') {
        throw new ZebrunnerApiError('Project key must be a non-empty string');
      }
      if (!/^[A-Z][A-Z0-9]*$/.test(params.projectKey)) {
        throw new ZebrunnerApiError(
          `Invalid project key format: '${params.projectKey}'. Expected format: uppercase letters and numbers (e.g., MFPAND)`
        );
      }
    }

    // Validate numeric IDs
    if (params.projectId !== undefined) {
      if (!Number.isInteger(params.projectId) || params.projectId <= 0) {
        throw new ZebrunnerApiError('Project ID must be a positive integer');
      }
    }

    if (params.suiteId !== undefined) {
      if (!Number.isInteger(params.suiteId) || params.suiteId <= 0) {
        throw new ZebrunnerApiError('Suite ID must be a positive integer');
      }
    }

    if (params.rootSuiteId !== undefined) {
      if (!Number.isInteger(params.rootSuiteId) || params.rootSuiteId <= 0) {
        throw new ZebrunnerApiError('Root Suite ID must be a positive integer');
      }
    }

    // Validate pagination parameters
    if (params.page !== undefined) {
      if (!Number.isInteger(params.page) || params.page < 0) {
        throw new ZebrunnerApiError('Page number must be a non-negative integer');
      }
    }

    if (params.size !== undefined) {
      if (!Number.isInteger(params.size) || params.size <= 0 || params.size > this.config.maxPageSize!) {
        throw new ZebrunnerApiError(`Page size must be an integer between 1 and ${this.config.maxPageSize}`);
      }
    }

    // Validate search query
    if (params.query !== undefined) {
      if (typeof params.query !== 'string' || params.query.trim() === '') {
        throw new ZebrunnerApiError('Search query must be a non-empty string');
      }
      if (params.query.length > 1000) {
        throw new ZebrunnerApiError('Search query too long (max 1000 characters)');
      }
    }

    // Validate test case key format and consistency
    if (url.includes('/key:') && params.projectKey) {
      const keyMatch = url.match(/\/key:([^?]+)/);
      if (keyMatch) {
        const caseKey = keyMatch[1];
        if (typeof caseKey !== 'string' || !/^[A-Z][A-Z0-9]*-\d+$/.test(caseKey)) {
          throw new ZebrunnerApiError(`Invalid test case key format: '${caseKey}'. Expected format: PROJECT_KEY-NUMBER`);
        }
        if (!caseKey.startsWith(params.projectKey + '-')) {
          console.warn(`⚠️  Test case key '${caseKey}' doesn't match project key '${params.projectKey}'`);
        }
      }
    }

    // Validate date parameters if present
    const dateFields = ['startedAfter', 'startedBefore', 'createdAfter', 'createdBefore', 'modifiedAfter', 'modifiedBefore'];
    dateFields.forEach(field => {
      if (params[field] !== undefined) {
        const dateValue = new Date(params[field]);
        if (isNaN(dateValue.getTime())) {
          throw new ZebrunnerApiError(`Invalid date format for ${field}: ${params[field]}`);
        }
      }
    });
  }

  private extractEndpointKey(url: string): string {
    // Extract endpoint pattern for health tracking
    return url
      .replace(/\/\d+/g, '/{id}')  // Replace IDs with placeholder
      .replace(/\/key:[^?]+/g, '/key:{key}')  // Replace keys with placeholder
      .split('?')[0];  // Remove query parameters
  }

  private handleApiError(error: AxiosError): ZebrunnerApiError {
    const status = error.response?.status;
    const endpoint = error.config?.url;
    const responseData = error.response?.data;

    if (this.config.debug) {
      console.error(`❌ [API] ${status} ${error.response?.statusText} - ${endpoint}`);
      if (responseData) {
        console.error(`❌ [API] Response:`, responseData);
      }
    }

    switch (status) {
      case 401:
        return new ZebrunnerAuthError('Authentication failed. Check your credentials and token.');
      case 404:
        return new ZebrunnerNotFoundError('Endpoint or resource', endpoint || 'unknown');
      case 400:
        let message = 'Bad request';
        if (typeof responseData === 'object' && responseData && 'message' in responseData) {
          message = (responseData as any).message;
        } else if (typeof responseData === 'string') {
          message = responseData;
        }
        return new ZebrunnerApiError(`Bad request: ${message}`, status, responseData, endpoint);
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
        
        const delay = this.config.retryDelay! * Math.pow(2, i);
        if (this.config.debug) {
          console.log(`🔄 [API] Retrying in ${delay}ms (attempt ${i + 1}/${attempts})`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Retry attempts exhausted');
  }

  /**
   * Check if an endpoint is known to be healthy
   */
  isEndpointHealthy(endpoint: string): boolean | undefined {
    return this.endpointHealth.get(endpoint);
  }

  /**
   * Get endpoint health status for debugging
   */
  getEndpointHealth(): Record<string, boolean> {
    return Object.fromEntries(this.endpointHealth);
  }

  /**
   * Test connection to Zebrunner API
   */
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      // First try a minimal request that should work regardless of project access
      const response = await this.http.get('/', {
        timeout: 10000
      });

      return {
        success: true,
        message: 'Connection successful',
        details: {
          status: response.status,
          baseUrl: this.config.baseUrl,
          responseTime: response.headers['x-response-time'] || 'unknown',
          timestamp: new Date().toISOString()
        }
      };
    } catch (error: any) {
      // If root endpoint fails, try with a known project pattern (more permissive)
      try {
        const fallbackResponse = await this.http.get('/test-suites', {
          params: { projectKey: 'INVALID', size: 1 },
          timeout: 5000
        });

        return {
          success: true,
          message: 'Connection successful (via fallback)',
          details: {
            status: fallbackResponse.status,
            baseUrl: this.config.baseUrl,
            method: 'fallback'
          }
        };
      } catch (fallbackError: any) {
        // Even 400/404 responses indicate the server is reachable
        if (fallbackError.response?.status === 400 || fallbackError.response?.status === 404) {
          return {
            success: true,
            message: 'Connection successful (server reachable)',
            details: {
              status: fallbackError.response.status,
              baseUrl: this.config.baseUrl,
              note: 'Server is reachable but requires valid project parameters'
            }
          };
        }

        return {
          success: false,
          message: `Connection failed: ${error.message}`,
          details: {
            status: error.response?.status,
            baseUrl: this.config.baseUrl,
            error: error.response?.data,
            fallbackStatus: fallbackError.response?.status
          }
        };
      }
    }
  }

  // ========== ENHANCED API METHODS ==========

  async getTestSuites(
    projectKey: string,
    options: TestSuiteSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerTestSuite>> {
    if (!projectKey) {
      throw new ZebrunnerApiError('Project key is required');
    }

    return this.retryRequest(async () => {
      const params = {
        projectKey,
        projectId: options.projectId,
        page: options.page,
        size: options.size || this.config.defaultPageSize,
        maxPageSize: this.config.maxPageSize,
        parentSuiteId: options.parentSuiteId
      };

      const response = await this.http.get('/test-suites', { params });
      const data = response.data;
      
      if (Array.isArray(data)) {
        return { 
          items: data.map(item => ZebrunnerTestSuiteSchema.parse(item)),
          _meta: { totalElements: data.length, currentPage: 0, pageSize: data.length }
        };
      } else if (data && data.items) {
        return {
          items: data.items.map((item: any) => ZebrunnerTestSuiteSchema.parse(item)),
          _meta: data._meta || { totalElements: data.items.length }
        };
      }
      
      throw new ZebrunnerApiError('Unexpected response format from test-suites endpoint');
    });
  }

  async getAllTestSuites(
    projectKey: string,
    options: Omit<TestSuiteSearchParams, 'page' | 'size'> & {
      maxResults?: number;
      onProgress?: (currentCount: number, page: number) => void;
    } = {}
  ): Promise<ZebrunnerTestSuite[]> {
    const { maxResults = 10000, onProgress, ...searchOptions } = options;
    const allItems: ZebrunnerTestSuite[] = [];
    let page = 0;
    let hasMore = true;
    const maxPages = Math.ceil(maxResults / (this.config.maxPageSize || 200));

    while (hasMore && page < maxPages) {
      const response = await this.getTestSuites(projectKey, {
        ...searchOptions,
        page,
        size: this.config.maxPageSize
      });

      // Limit items to maxResults
      const remainingSlots = maxResults - allItems.length;
      const itemsToAdd = response.items.slice(0, remainingSlots);
      allItems.push(...itemsToAdd);

      // Call progress callback if provided
      if (onProgress) {
        onProgress(allItems.length, page + 1);
      }

      // Check if we should continue
      hasMore = response._meta?.hasNext ||
                (response.items.length === this.config.maxPageSize && response.items.length > 0);
      page++;

      // Stop if we've reached maxResults
      if (allItems.length >= maxResults) {
        if (this.config.debug) {
          console.log(`🔍 Reached maximum result limit (${maxResults}), stopping pagination`);
        }
        break;
      }

      // Enhanced safety break with better logging
      if (page > 100) {
        if (this.config.debug) {
          console.warn(`⚠️  Stopped pagination after 100 pages (${allItems.length} items collected) to prevent infinite loop`);
        }
        break;
      }

      // Add small delay to be respectful to API
      if (page > 0 && page % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (this.config.debug) {
      console.log(`🔍 Collected ${allItems.length} test suites across ${page} pages`);
    }

    return allItems;
  }

  async getTestSuite(suiteId: number): Promise<ZebrunnerTestSuite> {
    if (!suiteId || suiteId <= 0) {
      throw new ZebrunnerApiError('Valid suite ID is required');
    }

    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-suites/${suiteId}`);
      return ZebrunnerTestSuiteSchema.parse(response.data);
    });
  }

  async getTestCaseByKey(
    projectKey: string, 
    key: string, 
    options: { includeSuiteHierarchy?: boolean } = {}
  ): Promise<ZebrunnerTestCase> {
    if (!projectKey) {
      throw new ZebrunnerApiError('Project key is required');
    }
    if (!key) {
      throw new ZebrunnerApiError('Test case key is required');
    }

    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-cases/key:${key}`, {
        params: { projectKey }
      });
      
      const data = response.data?.data || response.data;
      let testCase = ZebrunnerTestCaseSchema.parse(data);

      // Enhance with suite hierarchy information if requested
      if (options.includeSuiteHierarchy) {
        testCase = await this.enhanceWithSuiteHierarchy(testCase, projectKey);
      }

      return testCase;
    });
  }

  /**
   * Enhance test case with suite hierarchy information
   */
  private async enhanceWithSuiteHierarchy(
    testCase: ZebrunnerTestCase, 
    projectKey: string
  ): Promise<ZebrunnerTestCase> {
    try {
      // featureSuiteId should be testSuite.id (the immediate parent suite)
      // According to the API response structure, testSuite.id is the featureSuiteId
      const featureSuiteId = testCase.testSuite?.id;
      
      if (!featureSuiteId) {
        return {
          ...testCase,
          featureSuiteId: undefined,
          rootSuiteId: undefined
        };
      }

      // Find root suite by traversing up the hierarchy
      const rootSuiteId = await this.findRootSuiteId(projectKey, featureSuiteId);

      return {
        ...testCase,
        featureSuiteId,
        rootSuiteId: rootSuiteId || undefined
      };
    } catch (error) {
      // If hierarchy resolution fails, return original test case with available info
      console.warn(`Failed to resolve suite hierarchy for ${testCase.key}:`, error);
      return {
        ...testCase,
        featureSuiteId: testCase.testSuite?.id || undefined,
        rootSuiteId: undefined
      };
    }
  }

  /**
   * Get suite hierarchy path with comprehensive approach (Java methodology)
   */
  async getSuiteHierarchyPath(projectKey: string, suiteId: number): Promise<Array<{id: number, name: string}>> {
    try {
      // Use cached comprehensive approach
      const allSuites = await this.getAllSuitesWithCache(projectKey);

      // Use Java methodology to build hierarchy path
      const path: Array<{id: number, name: string}> = [];

      // Traverse up the hierarchy
      let currentSuiteId = suiteId;
      const visited = new Set<number>();

      while (currentSuiteId && !visited.has(currentSuiteId)) {
        visited.add(currentSuiteId);
        
        const suite = allSuites.find(s => s.id === currentSuiteId);
        if (!suite) break;

        path.unshift({
          id: suite.id,
          name: suite.name || suite.title || `Suite ${suite.id}`
        });

        currentSuiteId = suite.parentSuiteId || 0;
      }

      return path;

    } catch (error) {
      console.warn(`Error getting suite hierarchy path for suite ${suiteId}:`, error);
      return [{id: suiteId, name: `Suite ${suiteId}`}];
    }
  }

  /**
   * Get all suites for a project with caching (5-minute cache)
   */
  private async getAllSuitesWithCache(projectKey: string): Promise<ZebrunnerTestSuite[]> {
    const cacheKey = `suites_${projectKey}`;
    const cached = this.suitesCache.get(cacheKey);
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes

    // Return cached data if still valid
    if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
      return cached.suites;
    }

    // Fetch all suites with pagination
    let allSuites: ZebrunnerTestSuite[] = [];
    let page = 0;
    let hasMore = true;
    const pageSize = this.config.maxPageSize || 100;

    while (hasMore && page < 50) { // Safety limit
      const result = await this.getTestSuites(projectKey, {
        size: pageSize,
        page: page
      });

      allSuites.push(...result.items);
      hasMore = result.items.length === pageSize;
      page++;
    }

    // Cache the results
    this.suitesCache.set(cacheKey, {
      suites: allSuites,
      timestamp: Date.now()
    });

    return allSuites;
  }

  /**
   * Find root suite ID by traversing up the hierarchy
   */
  private async findRootSuiteId(projectKey: string, suiteId: number): Promise<number | null> {
    try {
      // Use cached comprehensive approach
      const allSuites = await this.getAllSuitesWithCache(projectKey);

      // Use Java methodology to find root ID
      const { HierarchyProcessor } = await import("../utils/hierarchy.js");
      const rootId = HierarchyProcessor.getRootId(allSuites, suiteId);
      
      return rootId;

    } catch (error) {
      console.warn(`Error finding root suite for suite ${suiteId}:`, error);
      return null;
    }
  }

  async getTestCases(
    projectKey: string, 
    options: TestCaseSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerShortTestCase>> {
    if (!projectKey) {
      throw new ZebrunnerApiError('Project key is required');
    }

    return this.retryRequest(async () => {
      const params = {
        projectKey,
        page: options.page,
        size: options.size || this.config.defaultPageSize,
        maxPageSize: this.config.maxPageSize,
        suiteId: options.suiteId,
        rootSuiteId: options.rootSuiteId,
        status: options.status,
        priority: options.priority,
        automationState: options.automationState
      };

      const response = await this.http.get('/test-cases', { params });
      const data = response.data;
      
      let items: any[] = [];
      let meta: any = {};
      
      if (Array.isArray(data)) {
        items = data;
        meta = { totalElements: data.length, currentPage: 0, pageSize: data.length };
      } else if (data && data.items) {
        items = data.items;
        meta = data._meta || data.meta || { totalElements: data.items.length };
      } else {
        throw new ZebrunnerApiError('Unexpected response format from test-cases endpoint');
      }

      // WORKAROUND: Since Zebrunner API doesn't respect pagination/filtering parameters,
      // we'll implement client-side filtering and pagination
      let filteredItems = items;
      
      // Client-side suite filtering (since API ignores suiteId parameter)
      if (options.suiteId) {
        filteredItems = items.filter(item => 
          item.testSuite?.id === options.suiteId || 
          item.suiteId === options.suiteId
        );
        
        if (this.config.debug) {
          console.log(`🔍 Client-side filtering: ${items.length} → ${filteredItems.length} items for suite ${options.suiteId}`);
        }
      }
      
      // Client-side pagination (since API ignores page/size parameters)
      const page = options.page || 0;
      const requestedSize = options.size || this.config.defaultPageSize || 50;
      const size = Math.min(requestedSize, this.config.maxPageSize || 200);
      const startIndex = page * size;
      const endIndex = startIndex + size;
      const paginatedItems = filteredItems.slice(startIndex, endIndex);
      
      if (this.config.debug && (options.page !== undefined || options.size !== undefined)) {
        console.log(`🔍 Client-side pagination: page ${page}, size ${size}, showing ${startIndex}-${endIndex} of ${filteredItems.length} items`);
      }
      
      // Update metadata to reflect actual pagination
      const updatedMeta = {
        ...meta,
        totalElements: filteredItems.length,
        currentPage: page,
        pageSize: size,
        totalPages: Math.ceil(filteredItems.length / size),
        hasNext: endIndex < filteredItems.length,
        hasPrevious: page > 0
      };
      
      return {
        items: paginatedItems.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item)),
        _meta: updatedMeta
      };
    });
  }

  async getTestCasesBySuite(projectKey: string, suiteId: number): Promise<ZebrunnerShortTestCase[]> {
    if (!suiteId || suiteId <= 0) {
      throw new ZebrunnerApiError('Valid suite ID is required');
    }

    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-suites/${suiteId}/test-cases`, {
        params: projectKey ? { projectKey } : {}
      });
      
      const data = Array.isArray(response.data) ? response.data : response.data?.items || [];
      return data.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item));
    });
  }

  async searchTestCases(
    projectKey: string,
    query: string,
    options: Omit<TestCaseSearchParams, 'projectKey' | 'query'> = {}
  ): Promise<PagedResponse<ZebrunnerShortTestCase>> {
    if (!projectKey) {
      throw new ZebrunnerApiError('Project key is required');
    }
    if (!query || query.trim().length === 0) {
      throw new ZebrunnerApiError('Search query is required');
    }

    return this.retryRequest(async () => {
      const params = {
        projectKey,
        query: query.trim(),
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
        return { 
          items: data.map(item => ZebrunnerShortTestCaseSchema.parse(item)),
          _meta: { totalElements: data.length, currentPage: 0, pageSize: data.length }
        };
      } else if (data && (data.items || data.content)) {
        const items = data.items || data.content || [];
        return {
          items: items.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item)),
          _meta: data._meta || { 
            totalElements: data.totalElements || items.length,
            currentPage: data.currentPage || 0,
            pageSize: items.length
          }
        };
      }
      
      throw new ZebrunnerApiError('Unexpected response format from test-cases/search endpoint');
    });
  }

  // Test Runs API (experimental)
  async getTestRuns(
    projectKey: string,
    options: TestRunSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerTestExecutionItem>> {
    if (!projectKey) {
      throw new ZebrunnerApiError('Project key is required');
    }

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
        return { 
          items: data.map(item => ZebrunnerTestExecutionItemSchema.parse(item)),
          _meta: { totalElements: data.length }
        };
      } else if (data && data.items) {
        return {
          items: data.items.map((item: any) => ZebrunnerTestExecutionItemSchema.parse(item)),
          _meta: data._meta || { totalElements: data.items.length }
        };
      }
      
      throw new ZebrunnerApiError('Unexpected response format from test-runs endpoint');
    });
  }

  async getTestRunById(projectKey: string, runId: number): Promise<ZebrunnerTestRun> {
    if (!runId || runId <= 0) {
      throw new ZebrunnerApiError('Valid run ID is required');
    }

    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-runs/${runId}`, {
        params: projectKey ? { projectKey } : {}
      });
      
      return ZebrunnerTestRunSchema.parse(response.data);
    });
  }

  async getTestResults(projectKey: string, runId: number): Promise<ZebrunnerTestResultResponse[]> {
    if (!runId || runId <= 0) {
      throw new ZebrunnerApiError('Valid run ID is required');
    }

    return this.retryRequest(async () => {
      const response = await this.http.get(`/test-runs/${runId}/test-cases`, {
        params: projectKey ? { projectKey } : {}
      });
      
      const data = Array.isArray(response.data) ? response.data : response.data?.items || [];
      return data.map((item: any) => ZebrunnerTestResultResponseSchema.parse(item));
    });
  }

}
