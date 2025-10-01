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
          console.error(`🔍 [API] ${config.method?.toUpperCase()} ${config.url}`);
          if (config.params && Object.keys(config.params).length > 0) {
            console.error(`🔍 [API] Params:`, config.params);
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
          console.error(`✅ [API] ${response.status} ${response.statusText} - ${response.config.url}`);
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
          console.error(`⚠️  Test case key '${caseKey}' doesn't match project key '${params.projectKey}'`);
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
          console.error(`🔄 [API] Retrying in ${delay}ms (attempt ${i + 1}/${attempts})`);
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
      // Try a minimal request to test-suites endpoint which should work with valid auth
      const response = await this.http.get('/test-suites', {
        params: { projectKey: 'MFPAND', size: 1 }, // Use a known project
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
    let nextPageToken: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && allItems.length < maxResults) {
      const response = await this.getTestSuites(projectKey, { 
        ...searchOptions,
        pageToken: nextPageToken,
        size: 100 // Use maximum allowed page size
      });

      // Limit items to maxResults
      const remainingSlots = maxResults - allItems.length;
      const itemsToAdd = response.items.slice(0, remainingSlots);
      allItems.push(...itemsToAdd);

      // Call progress callback if provided
      if (onProgress) {
        onProgress(allItems.length, pageCount + 1);
      }

      // Check for next page token in metadata
      nextPageToken = response._meta?.nextPageToken;
      hasMore = !!nextPageToken; // Stop only when nextPageToken is null, regardless of items length
      pageCount++;

      // Add small delay to be respectful to API
      if (pageCount > 0 && pageCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

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

    if (this.config.debug) {
      console.error(`🔍 Collected ${allItems.length} test suites across ${pageCount} pages`);
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

      // Handle orphaned test cases (suite doesn't exist)
      if (rootSuiteId === null) {
        console.error(`⚠️  Test case ${testCase.key} references orphaned suite ${featureSuiteId}`);
        return {
          ...testCase,
          featureSuiteId: undefined, // Clear feature suite ID for orphaned suites
          rootSuiteId: undefined
        };
      }

      return {
        ...testCase,
        featureSuiteId,
        rootSuiteId
      };
    } catch (error) {
      // If hierarchy resolution fails, return original test case with available info
      console.error(`Failed to resolve suite hierarchy for ${testCase.key}:`, error);
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
      console.error(`Error getting suite hierarchy path for suite ${suiteId}:`, error);
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

    // Fetch all suites with token-based pagination
    let allSuites: ZebrunnerTestSuite[] = [];
    let nextPageToken: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 1000) { // Safety limit to prevent infinite loops
      const result = await this.getTestSuites(projectKey, {
        pageToken: nextPageToken,
        size: 100 // Use maximum allowed page size
      });

      allSuites.push(...result.items);
      
      // Check for next page token in metadata
      nextPageToken = result._meta?.nextPageToken;
      hasMore = !!nextPageToken; // Stop only when nextPageToken is null, regardless of items length
      pageCount++;

      if (this.config.debug) {
        console.error(`📄 [Cache] Fetched page ${pageCount}: ${result.items.length} suites (total: ${allSuites.length})`);
        if (nextPageToken) {
          console.error(`🔗 [Cache] Next page token: ${nextPageToken.substring(0, 20)}...`);
        }
      }
    }

    if (pageCount >= 1000) {
      console.error('⚠️  [Cache] Stopped pagination after 1000 pages to prevent infinite loop');
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

      // Check if the suite actually exists in the project
      const suiteExists = allSuites.some(s => s.id === suiteId);
      if (!suiteExists) {
        console.error(`⚠️  Orphaned test case: Suite ${suiteId} referenced by test case but not found in project ${projectKey}`);
        console.error(`   This usually means the suite has been deleted or moved.`);
        return null; // Return null for orphaned suites instead of the suite ID itself
      }

      // Use Java methodology to find root ID
      const { HierarchyProcessor } = await import("../utils/hierarchy.js");
      const rootId = HierarchyProcessor.getRootId(allSuites, suiteId);
      
      return rootId;

    } catch (error) {
      console.error(`Error finding root suite for suite ${suiteId}:`, error);
      return null;
    }
  }

  /**
   * Get all TCM test cases for a project using pagination (Java implementation approach)
   * This method fetches ALL test cases from the project using proper token-based pagination
   */
  async getAllTCMTestCasesByProject(projectKey: string): Promise<ZebrunnerShortTestCase[]> {
    const allItems: ZebrunnerShortTestCase[] = [];
    let nextPageToken: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 1000) { // Safety limit
      // Direct API call to avoid circular dependency with getTestCases
      const params: any = {
        projectKey,
        maxPageSize: 100 // Use maximum allowed page size
      };

      if (nextPageToken) {
        params.pageToken = nextPageToken;
      }

      const response = await this.retryRequest(async () => {
        const apiResponse = await this.http.get('/test-cases', { params });
        const data = apiResponse.data;
        
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
      
      allItems.push(...response.items);
      
      // Check for next page token in metadata
      nextPageToken = response._meta?.nextPageToken;
      hasMore = !!nextPageToken; // Stop only when nextPageToken is null
      pageCount++;

      if (this.config.debug) {
        console.error(`📄 [TestCases] Fetched page ${pageCount}: ${response.items.length} test cases (total: ${allItems.length})`);
      }
    }

    if (pageCount >= 1000) {
      console.error('⚠️  [TestCases] Stopped pagination after 1000 pages to prevent infinite loop');
    }

    return allItems;
  }

  /**
   * Get all TCM test cases for a specific suite ID (Java implementation approach)
   * 
   * @param projectKey the project key to search in
   * @param suiteId the suite ID to filter by
   * @param basedOnRootSuites if true, filters by root suite ID; if false, filters by direct suite ID
   * @returns list of test cases matching the suite criteria
   */
  async getAllTCMTestCasesBySuiteId(
    projectKey: string, 
    suiteId: number, 
    basedOnRootSuites: boolean = false
  ): Promise<ZebrunnerShortTestCase[]> {
    console.error(`🔍 Getting all test cases for suite ${suiteId} (basedOnRootSuites: ${basedOnRootSuites})...`);
    
    const startTime = Date.now();
    
    // Step 1: Get all test cases for the project
    const allTestCases = await this.getAllTCMTestCasesByProject(projectKey);
    console.error(`   📊 Found ${allTestCases.length} total test cases in project`);
    
    // Step 2: Get all suites for the project
    const allSuites = await this.getAllSuitesWithCache(projectKey);
    console.error(`   📊 Found ${allSuites.length} total suites in project`);
    
    // Step 3: Process hierarchy - set root parents to suites (Java: TCMTestSuites.setRootParentsToSuites)
    const { HierarchyProcessor } = await import("../utils/hierarchy.js");
    const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
    
    // Step 4: Filter test cases by suite criteria
    const returnList: ZebrunnerShortTestCase[] = [];
    
    for (const tc of allTestCases) {
      const foundSuiteId = tc.testSuite?.id;
      if (!foundSuiteId) continue;
      
      // Enhance test case with full suite information (Java: TCMTestSuites.getTCMTestSuiteById)
      const fullSuite = HierarchyProcessor.getTCMTestSuiteById(processedSuites, foundSuiteId);
      if (fullSuite) {
        // Set root suite ID (Java: getRootIdBySuiteId)
        const rootId = HierarchyProcessor.getRootIdBySuiteId(processedSuites, foundSuiteId);
        
        // Create enhanced test case with hierarchy info
        const enhancedTC = {
          ...tc,
          testSuite: { ...tc.testSuite, ...fullSuite },
          rootSuiteId: rootId
        };
        
        // Filter based on criteria
        if (basedOnRootSuites) {
          if (rootId === suiteId) {
            returnList.push(enhancedTC);
          }
        } else {
          if (foundSuiteId === suiteId) {
            returnList.push(enhancedTC);
          }
        }
      }
    }
    
    const endTime = Date.now();
    console.error(`   ✅ Added ${returnList.length} test cases (${endTime - startTime}ms)`);
    
    return returnList;
  }

  /**
   * Build RQL filter string from search parameters
   */
  private buildRQLFilter(options: TestCaseSearchParams): string {
    const filters: string[] = [];

    // Automation state filtering
    if (options.automationState) {
      if (Array.isArray(options.automationState)) {
        if (options.automationState.length > 0) {
          // Check if all values are numbers (IDs) or strings (names)
          const allNumbers = options.automationState.every(state => typeof state === 'number');
          const allStrings = options.automationState.every(state => typeof state === 'string');
          
          if (allNumbers) {
            filters.push(`automationState.id IN [${options.automationState.join(', ')}]`);
          } else if (allStrings) {
            const quotedNames = options.automationState.map(state => `'${String(state).replace(/'/g, "\\'")}'`);
            filters.push(`automationState.name IN [${quotedNames.join(', ')}]`);
          } else {
            // Mixed types - handle each separately
            const ids = options.automationState.filter(state => typeof state === 'number');
            const names = options.automationState.filter(state => typeof state === 'string');
            
            const subFilters: string[] = [];
            if (ids.length > 0) {
              subFilters.push(`automationState.id IN [${ids.join(', ')}]`);
            }
            if (names.length > 0) {
              const quotedNames = names.map(name => `'${String(name).replace(/'/g, "\\'")}'`);
              subFilters.push(`automationState.name IN [${quotedNames.join(', ')}]`);
            }
            
            if (subFilters.length > 0) {
              filters.push(`(${subFilters.join(' OR ')})`);
            }
          }
        }
      } else {
        // Single value
        if (typeof options.automationState === 'number') {
          filters.push(`automationState.id = ${options.automationState}`);
        } else {
          filters.push(`automationState.name = '${String(options.automationState).replace(/'/g, "\\'")}'`);
        }
      }
    }

    // Date filtering
    if (options.createdAfter) {
      filters.push(`createdAt >= '${options.createdAfter}'`);
    }
    if (options.createdBefore) {
      filters.push(`createdAt <= '${options.createdBefore}'`);
    }
    if (options.modifiedAfter) {
      filters.push(`lastModifiedAt >= '${options.modifiedAfter}'`);
    }
    if (options.modifiedBefore) {
      filters.push(`lastModifiedAt <= '${options.modifiedBefore}'`);
    }

    // Suite filtering
    if (options.suiteId) {
      filters.push(`testSuite.id = ${options.suiteId}`);
    }

    // Priority filtering
    if (options.priority) {
      if (typeof options.priority === 'number') {
        filters.push(`priority.id = ${options.priority}`);
      } else {
        filters.push(`priority.name = '${String(options.priority).replace(/'/g, "\\'")}'`);
      }
    }

    // Custom filter (if provided, it takes precedence)
    if (options.filter) {
      return options.filter;
    }

    return filters.join(' AND ');
  }

  /**
   * Client-side automation state filtering
   */
  private filterByAutomationState(items: any[], automationState: string | number | (string | number)[]): any[] {
    const states = Array.isArray(automationState) ? automationState : [automationState];
    
    return items.filter(item => {
      if (!item.automationState) return false;
      
      return states.some(state => {
        if (typeof state === 'number') {
          return item.automationState.id === state;
        } else {
          return item.automationState.name === state;
        }
      });
    });
  }

  /**
   * Client-side creation date filtering
   */
  private filterByCreationDate(items: any[], createdAfter?: string, createdBefore?: string): any[] {
    return items.filter(item => {
      if (!item.createdAt) return false;
      
      const createdDate = new Date(item.createdAt);
      
      if (createdAfter) {
        const afterDate = new Date(createdAfter);
        if (createdDate < afterDate) return false;
      }
      
      if (createdBefore) {
        const beforeDate = new Date(createdBefore);
        if (createdDate > beforeDate) return false;
      }
      
      return true;
    });
  }

  /**
   * Client-side modification date filtering
   */
  private filterByModificationDate(items: any[], modifiedAfter?: string, modifiedBefore?: string): any[] {
    return items.filter(item => {
      if (!item.lastModifiedAt) return false;
      
      const modifiedDate = new Date(item.lastModifiedAt);
      
      if (modifiedAfter) {
        const afterDate = new Date(modifiedAfter);
        if (modifiedDate < afterDate) return false;
      }
      
      if (modifiedBefore) {
        const beforeDate = new Date(modifiedBefore);
        if (modifiedDate > beforeDate) return false;
      }
      
      return true;
    });
  }

  async getTestCases(
    projectKey: string, 
    options: TestCaseSearchParams = {}
  ): Promise<PagedResponse<ZebrunnerShortTestCase>> {
    if (!projectKey) {
      throw new ZebrunnerApiError('Project key is required');
    }

    return this.retryRequest(async () => {
      const params: any = {
        projectKey,
        maxPageSize: Math.min(options.size || this.config.defaultPageSize || 50, 100)
      };

      // Use token-based pagination
      if (options.pageToken) {
        params.pageToken = options.pageToken;
      }

      // Build RQL filter for advanced filtering
      const rqlFilter = this.buildRQLFilter(options);
      if (rqlFilter) {
        params.filter = rqlFilter;
        if (this.config.debug) {
          console.error(`🔍 Using RQL filter: ${rqlFilter}`);
        }
      }

      // Add sorting if specified
      if (options.sortBy) {
        params.sortBy = options.sortBy;
      }

      // Use Public API endpoint for test cases (supports RQL filtering)
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

      // Note: Root suite filtering would require hierarchy traversal
      // For now, we rely on RQL filters to handle suite filtering
      // TODO: Implement proper root suite hierarchy filtering if needed

      return {
        items: items.map((item: any) => ZebrunnerShortTestCaseSchema.parse(item)),
        _meta: meta
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

    // Use the main getTestCases method with title search via RQL
    const searchOptions: TestCaseSearchParams = {
      ...options,
      // Build RQL filter for title search
      filter: `title ~= '${query.trim().replace(/'/g, "\\'")}'`
    };

    return this.getTestCases(projectKey, searchOptions);
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

  // === Public API Test Run Methods ===

  /**
   * List Test Runs using Public API with filtering support
   */
  async listPublicTestRuns(options: {
    projectKey: string;
    pageToken?: string;
    maxPageSize?: number;
    filter?: string;
    sortBy?: string;
  }) {
    const { PublicTestRunsResponseSchema } = await import("../types/core.js");
    
    return this.retryRequest(async () => {
      const params: Record<string, any> = {
        projectKey: options.projectKey,
        maxPageSize: options.maxPageSize || 10
      };

      if (options.pageToken) {
        params.pageToken = options.pageToken;
      }
      if (options.filter) {
        params.filter = options.filter;
      }
      if (options.sortBy) {
        params.sortBy = options.sortBy;
      }

      const response = await this.http.get("/test-runs", { params });
      return PublicTestRunsResponseSchema.parse(response.data);
    });
  }

  /**
   * Get Test Run by ID using Public API
   */
  async getPublicTestRunById(options: {
    id: number;
    projectKey: string;
  }) {
    const { PublicTestRunResponseSchema } = await import("../types/core.js");
    
    return this.retryRequest(async () => {
      const params = {
        projectKey: options.projectKey
      };

      const response = await this.http.get(`/test-runs/${options.id}`, { params });
      return PublicTestRunResponseSchema.parse(response.data);
    });
  }

  /**
   * List all Test Cases of a Test Run using Public API
   */
  async listPublicTestRunTestCases(options: {
    testRunId: number;
    projectKey: string;
  }) {
    const { PublicTestRunTestCasesResponseSchema } = await import("../types/core.js");
    
    return this.retryRequest(async () => {
      const params = {
        projectKey: options.projectKey
      };

      const response = await this.http.get(`/test-runs/${options.testRunId}/test-cases`, { params });
      return PublicTestRunTestCasesResponseSchema.parse(response.data);
    });
  }

  /**
   * List Result Statuses using Public API
   */
  async listResultStatuses(options: {
    projectKey: string;
  }) {
    const { ResultStatusesResponseSchema } = await import("../types/core.js");
    
    return this.retryRequest(async () => {
      const params = {
        projectKey: options.projectKey
      };

      const response = await this.http.get("/test-run-settings/result-statuses", { params });
      return ResultStatusesResponseSchema.parse(response.data);
    });
  }

  /**
   * List Configuration Groups using Public API
   */
  async listConfigurationGroups(options: {
    projectKey: string;
  }) {
    const { ConfigurationGroupsResponseSchema } = await import("../types/core.js");
    
    return this.retryRequest(async () => {
      const params = {
        projectKey: options.projectKey
      };

      const response = await this.http.get("/test-run-settings/configuration-groups", { params });
      return ConfigurationGroupsResponseSchema.parse(response.data);
    });
  }

}
