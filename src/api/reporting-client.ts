import axios, { AxiosInstance, AxiosError } from "axios";
import {
  ZebrunnerReportingConfig,
  AuthTokenResponse,
  AuthTokenResponseSchema,
  LaunchResponse,
  LaunchResponseSchema,
  ProjectResponse,
  ProjectResponseSchema,
  TestSessionsResponse,
  TestSessionsResponseSchema,
  TestRunResponse,
  TestRunResponseSchema,
  TestRunsResponse,
  TestRunsResponseSchema,
  TestExecutionHistoryResponse,
  TestExecutionHistoryResponseSchema,
  MilestonesResponse,
  MilestonesResponseSchema,
  AvailableProjectsResponse,
  AvailableProjectsResponseSchema,
  ProjectsLimitResponse,
  ProjectsLimitResponseSchema,
  LaunchesResponse,
  LaunchesResponseSchema,
  LogsAndScreenshotsResponse,
  LogsAndScreenshotsResponseSchema,
  JiraIntegrationsResponse,
  JiraIntegrationsResponseSchema,
  LaunchAttemptsResponse,
  LaunchAttemptsResponseSchema,
  ZebrunnerReportingError,
  ZebrunnerReportingAuthError,
  ZebrunnerReportingNotFoundError
} from "../types/reporting.js";
import { maskToken, maskAuthHeader, validateFileUrl } from "../utils/security.js";

/** Field metadata from the fields-layout API */
export interface FieldLayoutItem {
  id: number;
  type: 'SYSTEM' | 'CUSTOM';
  tabId: number | null;
  relativePosition: number;
  name: string;
  enabled: boolean;
  dataType: string;
  description: string | null;
}

export interface FieldsLayout {
  tabs: { id: number; name: string; relativePosition: number; displayMode: string }[];
  fields: FieldLayoutItem[];
}

/** A single TCM test case execution (manual or automated) */
export interface TestCaseExecution {
  id: number;
  trackedBy: number;
  trackedAt: string;
  status: {
    id: number;
    name: string;
    colorHex: string;
    isCompleted: boolean;
    isFinal: boolean;
  };
  issueType: string | null;
  issueId: string | null;
  details: string | null;
  elapsedTimeInMillis: number | null;
  type: 'MANUAL' | 'AUTOMATED';
  automationLaunchId: number | null;
  automationExecutionId: number | null;
  attachments: any[];
  environment: { id: number; key: string; name: string } | null;
  configurations: { groupId: number; groupName: string; optionId: number; optionName: string }[];
  userId: number;
}

/**
 * Zebrunner Reporting API Client
 * 
 * Uses access token authentication with bearer token exchange
 * Separate from the TCM Public API client
 */
export class ZebrunnerReportingClient {
  private http: AxiosInstance;
  private config: ZebrunnerReportingConfig;
  private bearerToken: string | null = null;
  private tokenExpiresAt: Date | null = null;
  private projectCache: Map<string, { project: ProjectResponse, timestamp: number }> = new Map();
  private fieldsLayoutCache: Map<number, { data: FieldsLayout, timestamp: number }> = new Map();
  private jiraBaseUrlCache: string | null = null;
  private _jiraResolutionWarning: string | null = null;

  constructor(config: ZebrunnerReportingConfig) {
    this.config = {
      timeout: 60_000,
      debug: false,
      ...config
    };

    // Initialize HTTP client for base URL without /api prefix
    const baseURL = this.config.baseUrl.replace(/\/+$/, "");
    
    this.http = axios.create({
      baseURL,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.http.interceptors.request.use(
      (config) => {
        if (this.config.debug) {
          console.error(`[ZebrunnerReportingClient] ${config.method?.toUpperCase()} ${config.url}`);
          
          // Mask Authorization header if present
          if (config.headers?.Authorization) {
            const maskedHeader = maskAuthHeader(config.headers.Authorization as string);
            console.error('[ZebrunnerReportingClient] Authorization:', maskedHeader);
          }
          
          if (config.data) {
            console.error('[ZebrunnerReportingClient] Request data:', config.data);
          }
        }
        return config;
      },
      (error) => {
        if (this.config.debug) {
          console.error('[ZebrunnerReportingClient] Request error:', error);
        }
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.http.interceptors.response.use(
      (response) => {
        if (this.config.debug) {
          console.error(`[ZebrunnerReportingClient] Response ${response.status}:`, response.data);
        }
        return response;
      },
      (error: AxiosError) => {
        const enhancedError = this.enhanceError(error);
        if (this.config.debug) {
          console.error('[ZebrunnerReportingClient] Response error:', enhancedError);
        }
        return Promise.reject(enhancedError);
      }
    );
  }

  private enhanceError(error: AxiosError): ZebrunnerReportingError {
    const status = error.response?.status;
    const responseData = error.response?.data as any;
    const message = responseData?.message || error.message;

    if (status === 401) {
      return new ZebrunnerReportingAuthError(
        `Authentication failed: ${message}`,
        status
      );
    }

    if (status === 404) {
      return new ZebrunnerReportingNotFoundError(
        `Resource not found: ${message}`,
        status
      );
    }

    return new ZebrunnerReportingError(
      `API error: ${message}`,
      status,
      error.response?.data
    );
  }

  /**
   * Exchange access token for short-living bearer token
   */
  async authenticate(): Promise<string> {
    try {
      const response = await this.http.post('/api/iam/v1/auth/refresh', {
        refreshToken: this.config.accessToken
      });

      const authData = AuthTokenResponseSchema.parse(response.data);
      this.bearerToken = authData.authToken;
      
      // Set expiration time (default to 1 hour if not provided)
      const expiresInMs = (authData.expiresIn || 3600) * 1000;
      this.tokenExpiresAt = new Date(Date.now() + expiresInMs);

      if (this.config.debug) {
        const maskedToken = maskToken(this.bearerToken);
        console.error(`[ZebrunnerReportingClient] Authentication successful, token: ${maskedToken}, expires at:`, this.tokenExpiresAt);
      }

      return this.bearerToken;
    } catch (error) {
      if (this.config.debug) {
        console.error('[ZebrunnerReportingClient] Authentication failed:', error);
      }
      throw error;
    }
  }

  /**
   * Get valid bearer token, refreshing if necessary
   */
  private async getBearerToken(): Promise<string> {
    // Check if we have a valid token
    if (this.bearerToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date()) {
      return this.bearerToken;
    }

    // Token is missing or expired, authenticate
    return await this.authenticate();
  }

  /**
   * Make authenticated request to reporting API
   */
  private async makeAuthenticatedRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    data?: any
  ): Promise<T> {
    const bearerToken = await this.getBearerToken();
    
    const config = {
      method,
      url,
      headers: {
        'Authorization': `Bearer ${bearerToken}`
      },
      ...(data && { data })
    };

    try {
      const response = await this.http.request(config);
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        if (status === 401) {
          throw new ZebrunnerReportingAuthError('Reporting API authentication failed. Token may have expired.');
        }
        if (status === 404) {
          throw new ZebrunnerReportingNotFoundError(`Resource not found: ${method} ${url}`);
        }
        throw new ZebrunnerReportingError(
          `Reporting API error ${status || 'unknown'}: ${error.message} (${method} ${url})`
        );
      }
      throw error;
    }
  }

  /**
   * Get launch details by ID
   */
  async getLaunch(launchId: number, projectId: number): Promise<LaunchResponse> {
    const url = `/api/reporting/v1/launches/${launchId}?projectId=${projectId}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Extract the actual launch data from the nested response
    const launchData = response.data || response;
    
    return LaunchResponseSchema.parse(launchData);
  }

  /**
   * Get launch attempts (re-run history) for a launch
   * Returns the sequence of execution attempts including initial run and all re-runs
   */
  async getLaunchAttempts(launchId: number, projectId: number): Promise<LaunchAttemptsResponse> {
    const url = `/api/reporting/v1/launches/${launchId}/attempts?projectId=${projectId}`;

    if (this.config.debug) {
      console.error(`[ZebrunnerReportingClient] Fetching launch attempts for launch ${launchId}`);
    }

    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const data = response.data || response;
    return LaunchAttemptsResponseSchema.parse(data);
  }

  /**
   * Test connection to the reporting API
   */
  async testConnection(): Promise<{ success: boolean; message: string; details?: any }> {
    try {
      const bearerToken = await this.authenticate();
      
      return {
        success: true,
        message: 'Connection successful to Zebrunner Reporting API',
        details: {
          baseUrl: this.config.baseUrl,
          tokenLength: bearerToken.length,
          expiresAt: this.tokenExpiresAt
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        details: { error }
      };
    }
  }

  /**
   * Get project by key
   */
  async getProject(projectKey: string): Promise<ProjectResponse> {
    // Check cache first (cache for 5 minutes)
    const cached = this.projectCache.get(projectKey);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.project;
    }

    const url = `/api/projects/v1/projects/${projectKey}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Extract the actual project data from the nested response
    const projectData = response.data || response;
    
    // Debug: Log the actual data being parsed
    if (process.env.DEBUG === 'true') {
      console.error('Project data being parsed:', JSON.stringify(projectData, null, 2));
    }
    
    let project;
    try {
      project = ProjectResponseSchema.parse(projectData);
    } catch (error) {
      if (process.env.DEBUG === 'true') {
        console.error('ProjectResponseSchema validation failed:', error);
        console.error('Raw projectData:', projectData);
      }
      throw new ZebrunnerReportingError(`Failed to parse project data for ${projectKey}: ${error instanceof Error ? error.message : error}`);
    }
    
    // Cache the result
    this.projectCache.set(projectKey, { project, timestamp: Date.now() });
    
    return project;
  }

  /**
   * Get project ID by key (convenience method)
   */
  async getProjectId(projectKey: string): Promise<number> {
    const project = await this.getProject(projectKey);
    return project.id;
  }

  /**
   * Get project key by ID
   */
  async getProjectKey(projectId: number): Promise<string> {
    // Check if we have it in cache (reverse lookup)
    for (const [key, cached] of this.projectCache.entries()) {
      if (cached.project.id === projectId && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        return cached.project.key;
      }
    }

    // If not in cache, fetch all available projects and find the one
    const projects = await this.getAvailableProjects();
    const project = projects.items.find(p => p.id === projectId);
    
    if (!project) {
      throw new ZebrunnerReportingError(`Project with ID ${projectId} not found`);
    }
    
    // Cache it for future use
    const fullProject = await this.getProject(project.key);
    
    return fullProject.key;
  }

  /**
   * Get test sessions for a launch
   */
  async getTestSessions(launchId: number, projectId: number): Promise<TestSessionsResponse> {
    const url = `/api/reporting/v1/launches/${launchId}/test-sessions?projectId=${projectId}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Handle different response structures
    const sessionsData = response.data || response;
    
    return TestSessionsResponseSchema.parse(sessionsData);
  }

  /**
   * Get ALL test sessions for a launch (auto-paginate through all pages)
   */
  async getAllTestSessions(launchId: number, projectId: number, pageSize: number = 200): Promise<TestSessionsResponse> {
    const firstPage = await this.getTestSessions(launchId, projectId);
    const totalElements = firstPage.totalElements ?? firstPage.items.length;

    if (firstPage.items.length >= totalElements) {
      return firstPage;
    }

    const allItems = [...firstPage.items];
    let currentPage = 2;
    const totalPages = firstPage.totalPages ?? Math.ceil(totalElements / pageSize);

    while (currentPage <= totalPages) {
      const url = `/api/reporting/v1/launches/${launchId}/test-sessions?projectId=${projectId}&page=${currentPage}&size=${pageSize}`;
      const response = await this.makeAuthenticatedRequest<any>('GET', url);
      const data = response.data || response;
      const parsed = TestSessionsResponseSchema.parse(data);
      allItems.push(...parsed.items);

      if (this.config.debug) {
        console.error(`[ZebrunnerReportingClient] Sessions page ${currentPage}: ${parsed.items.length} items (total: ${allItems.length}/${totalElements})`);
      }
      currentPage++;
    }

    return {
      items: allItems,
      totalElements: allItems.length,
      totalPages: 1,
      page: 1,
      size: allItems.length
    };
  }

  /**
   * Get a single test by ID from a launch (full detail including issueReferences).
   */
  async getTestById(
    launchId: number,
    testId: number,
    projectId: number
  ): Promise<TestRunResponse> {
    const url = `/api/reporting/v1/launches/${launchId}/tests/${testId}?projectId=${projectId}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const data = response.data || response;
    return TestRunResponseSchema.parse(data);
  }

  /**
   * Get test runs (test executions) for a launch
   */
  async getTestRuns(
    launchId: number,
    projectId: number,
    options: {
      page?: number;
      pageSize?: number;
    } = {}
  ): Promise<TestRunsResponse> {
    const { page = 1, pageSize = 50 } = options;
    const url = `/api/reporting/v1/launches/${launchId}/tests?projectId=${projectId}&page=${page}&pageSize=${pageSize}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Handle different response structures
    const runsData = response.data || response;
    
    return TestRunsResponseSchema.parse(runsData);
  }

  /**
   * Get ALL test runs for a launch (auto-paginate through all pages)
   */
  async getAllTestRuns(
    launchId: number,
    projectId: number,
    pageSize: number = 100
  ): Promise<TestRunsResponse> {
    const allItems: any[] = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      const response = await this.getTestRuns(launchId, projectId, {
        page: currentPage,
        pageSize
      });

      allItems.push(...response.items);

      // Check if there are more pages
      const totalElements = response.totalElements || 0;
      const fetchedSoFar = currentPage * pageSize;
      hasMorePages = fetchedSoFar < totalElements;

      if (this.config.debug) {
        console.error(`[ZebrunnerReportingClient] Fetched page ${currentPage}: ${response.items.length} items (total: ${allItems.length}/${totalElements})`);
      }

      currentPage++;
    }

    return {
      items: allItems,
      totalElements: allItems.length,
      totalPages: Math.ceil(allItems.length / pageSize),
      page: 1,
      size: allItems.length
    };
  }

  /**
   * Get test execution history for a specific test
   * Returns history of test executions across multiple launches
   * 
   * @param launchId - Launch ID containing the test
   * @param testId - Test ID to get history for
   * @param projectId - Project ID
   * @param limit - Number of history items to return (default: 10)
   * @returns Test execution history with status, duration, timestamps
   */
  async getTestExecutionHistory(
    launchId: number,
    testId: number,
    projectId: number,
    limit: number = 10
  ): Promise<TestExecutionHistoryResponse> {
    const url = `/api/reporting/v1/launches/${launchId}/tests/${testId}/history?projectId=${projectId}&limit=${limit}`;
    
    if (this.config.debug) {
      console.error(`[ZebrunnerReportingClient] Fetching test execution history for test ${testId} (limit: ${limit})`);
    }
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Handle different response structures
    const historyData = response.data || response;
    
    return TestExecutionHistoryResponseSchema.parse(historyData);
  }

  /**
   * Get test logs and screenshots for a specific test run
   * Uses the test-execution-logs API endpoint
   */
  async getTestLogsAndScreenshots(
    testRunId: number,
    testId: number,
    options: {
      maxPageSize?: number;
    } = {}
  ): Promise<LogsAndScreenshotsResponse> {
    const { maxPageSize = 1000 } = options;
    const url = `/api/test-execution-logs/v1/test-runs/${testRunId}/tests/${testId}/logs-and-screenshots?maxPageSize=${maxPageSize}`;
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const logsData = response.data || response;
    return LogsAndScreenshotsResponseSchema.parse(logsData);
  }

  /**
   * Get test sessions for a specific test to retrieve artifacts (video, logs)
   */
  async getTestSessionsForTest(
    launchId: number,
    testId: number,
    projectId: number
  ): Promise<TestSessionsResponse> {
    const url = `/api/reporting/v1/launches/${launchId}/test-sessions?testId=${testId}&projectId=${projectId}`;
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const sessionsData = response.data || response;
    
    if (this.config.debug) {
      console.error(`[ZebrunnerReportingClient] Test sessions response for test ${testId}:`, JSON.stringify(sessionsData, null, 2));
    }
    
    return TestSessionsResponseSchema.parse(sessionsData);
  }

  /**
   * Download screenshot file with authentication
   * @param fileUrl - Relative or absolute URL to screenshot file (e.g., "/files/abc123" or "https://your-workspace.zebrunner.com/files/abc123")
   * @returns Buffer containing the image data
   */
  async downloadScreenshot(fileUrl: string): Promise<Buffer> {
    try {
      // Get URL validation config from environment or defaults
      const strictMode = process.env.STRICT_URL_VALIDATION !== 'false'; // Default true
      const skipOnError = process.env.SKIP_URL_VALIDATION_ON_ERROR === 'true'; // Default false
      
      // Validate URL before processing
      // Note: allowedHost is intentionally omitted — screenshot/video URLs
      // may reside on CDN or storage hosts that differ from the API hostname.
      const validatedUrl = validateFileUrl(fileUrl, {
        strictMode,
        skipOnError
      });
      
      const bearerToken = await this.getBearerToken();
      
      // Construct full URL if relative path provided
      let fullUrl = validatedUrl;
      if (validatedUrl.startsWith('/files/')) {
        fullUrl = `${this.config.baseUrl}${validatedUrl}`;
      }
      
      if (this.config.debug) {
        console.error(`[ZebrunnerReportingClient] Downloading screenshot: ${fullUrl}`);
      }
      
      const response = await this.http.get(fullUrl, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`
        },
        responseType: 'arraybuffer'
      });
      
      if (this.config.debug) {
        console.error(`[ZebrunnerReportingClient] Screenshot downloaded successfully, size: ${response.data.byteLength} bytes`);
      }
      
      return Buffer.from(response.data);
    } catch (error) {
      if (this.config.debug) {
        console.error('[ZebrunnerReportingClient] Screenshot download failed:', error);
      }
      throw new ZebrunnerReportingError(
        `Failed to download screenshot from ${fileUrl}: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Get milestones for a project
   */
  async getMilestones(
    projectId: number, 
    options: {
      page?: number;
      pageSize?: number;
      completed?: boolean | 'all';
    } = {}
  ): Promise<MilestonesResponse> {
    const { page = 1, pageSize = 10, completed = false } = options;
    
    let url = `/api/reporting/v1/milestones?projectId=${projectId}&page=${page}&pageSize=${pageSize}`;
    
    // Add completed filter if not 'all'
    if (completed !== 'all') {
      url += `&completed=${completed}`;
    }
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Handle different response structures
    const milestonesData = response.data || response;
    
    try {
      return MilestonesResponseSchema.parse(milestonesData);
    } catch (error) {
      throw new ZebrunnerReportingError(`Failed to parse milestones data: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get available projects with optional filtering
   */
  async getAvailableProjects(
    options: {
      starred?: boolean;
      publiclyAccessible?: boolean;
      extraFields?: string[];
    } = {}
  ): Promise<AvailableProjectsResponse> {
    const { starred, publiclyAccessible, extraFields = ['starred'] } = options;
    
    let url = `/api/projects/v1/projects`;
    const params = new URLSearchParams();
    
    // Add extraFields parameter
    if (extraFields.length > 0) {
      params.append('extraFields', extraFields.join(','));
    }
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Handle different response structures
    const projectsData = response.data || response;
    
    try {
      const parsedData = AvailableProjectsResponseSchema.parse(projectsData);
      
      // Apply client-side filtering
      let filteredItems = parsedData.items.filter(project => !project.deleted); // Always exclude deleted
      
      if (starred !== undefined) {
        filteredItems = filteredItems.filter(project => project.starred === starred);
      }
      
      if (publiclyAccessible !== undefined) {
        filteredItems = filteredItems.filter(project => project.publiclyAccessible === publiclyAccessible);
      }
      
      return {
        items: filteredItems
      };
    } catch (error) {
      throw new ZebrunnerReportingError(`Failed to parse projects data: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get projects pagination info
   */
  async getProjectsLimit(): Promise<ProjectsLimitResponse> {
    const url = `/api/projects/v1/projects-limit`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    const limitData = response.data || response;
    
    try {
      return ProjectsLimitResponseSchema.parse(limitData);
    } catch (error) {
      throw new ZebrunnerReportingError(`Failed to parse projects limit data: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get test case fields layout for a project (cached for 10 minutes).
   * Returns system fields (Deprecated, Draft, Priority, etc.) and custom fields
   * with their types and tab placement. Useful for distinguishing system vs custom fields.
   */
  async getFieldsLayout(projectId: number): Promise<FieldsLayout> {
    const cached = this.fieldsLayoutCache.get(projectId);
    if (cached && Date.now() - cached.timestamp < 10 * 60 * 1000) {
      return cached.data;
    }

    const url = `/api/tcm/v1/test-case-settings/fields-layout?projectId=${projectId}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const data = response.data?.data || response.data || response;
    const layout: FieldsLayout = {
      tabs: data.tabs || [],
      fields: (data.fields || []).map((f: any) => ({
        id: f.id,
        type: f.type,
        tabId: f.tabId,
        relativePosition: f.relativePosition,
        name: f.name,
        enabled: f.enabled,
        dataType: f.dataType,
        description: f.description || null
      }))
    };

    this.fieldsLayoutCache.set(projectId, { data: layout, timestamp: Date.now() });
    return layout;
  }

  /**
   * Get TCM test case execution history (manual + automated).
   * Endpoint: GET /api/tcm/v1/test-cases/{testCaseId}/executions?projectId={projectId}
   * Returns the most recent executions, capped at `limit`.
   */
  async getTestCaseExecutions(testCaseId: number, projectId: number, limit: number = 10): Promise<TestCaseExecution[]> {
    const url = `/api/tcm/v1/test-cases/${testCaseId}/executions?projectId=${projectId}`;
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const data = response.data?.data || response.data || response;
    const items: TestCaseExecution[] = (data.items || data || []).slice(0, limit);
    return items;
  }

  /**
   * Clear project cache
   */
  clearProjectCache(): void {
    this.projectCache.clear();
  }

  /**
   * Get launches for a project
   */
  async getLaunches(
    projectId: number,
    options: {
      page?: number;
      pageSize?: number;
      milestone?: string;
      query?: string;
    } = {}
  ): Promise<LaunchesResponse> {
    const { page = 1, pageSize = 20, milestone, query } = options;
    
    let url = `/api/reporting/v1/launches?projectId=${projectId}&page=${page}&pageSize=${pageSize}`;
    
    // Add milestone filter if provided
    if (milestone) {
      url += `&milestone=${encodeURIComponent(milestone)}`;
    }
    
    // Add query filter if provided
    if (query) {
      url += `&query=${encodeURIComponent(query)}`;
    }
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    
    // Handle different response structures
    const launchesData = response.data || response;
    
    try {
      return LaunchesResponseSchema.parse(launchesData);
    } catch (error) {
      throw new ZebrunnerReportingError(`Failed to parse launches data: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Get automation states for a project
   */
  async getAutomationStates(projectId: number): Promise<{ id: number; name: string }[]> {
    const url = `/api/tcm/v1/test-case-settings/system-fields/automation-states?projectId=${projectId}`;
    
    const response = await this.makeAuthenticatedRequest<any>('GET', url);
    const data = response.data || response;
    
    let statesArray: any[] = [];
    if (data && Array.isArray(data.items)) {
      statesArray = data.items;
    } else if (Array.isArray(data)) {
      statesArray = data;
    } else {
      throw new ZebrunnerReportingError(
        `Unexpected response format for automation states: ${JSON.stringify(data).slice(0, 200)}`
      );
    }
    
    return statesArray.map((item: any) => ({
      id: item.id,
      name: item.name
    }));
  }

  /**
   * Get priorities for a project
   */
  async getPriorities(projectId: number): Promise<{ id: number; name: string }[]> {
    const url = `/api/tcm/v1/test-case-settings/system-fields/priorities?projectId=${projectId}`;
    
    try {
      if (this.config.debug) {
        console.error(`🔍 Fetching priorities from: ${url}`);
      }
      
      const response = await this.makeAuthenticatedRequest<any>('GET', url);
      const data = response.data || response;
      
      if (this.config.debug) {
        console.error(`🔍 Priorities API response:`, JSON.stringify(data, null, 2));
      }
      
      // Handle response format: {"items": [...]} or direct array
      let prioritiesArray: any[] = [];
      if (data && Array.isArray(data.items)) {
        prioritiesArray = data.items;
      } else if (Array.isArray(data)) {
        prioritiesArray = data;
      } else {
        throw new ZebrunnerReportingError('Unexpected response format for priorities - no items array found');
      }
      
      // Map to expected format
      const priorities = prioritiesArray.map((item: any) => ({
        id: item.id,
        name: item.name
      }));
      
      if (this.config.debug) {
        console.error(`🔍 Parsed ${priorities.length} priorities:`, priorities);
      }
      
      return priorities;
    } catch (error) {
      throw new ZebrunnerReportingError(
        `Failed to fetch priorities: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  /**
   * Get current authentication status
   */
  getAuthStatus(): { authenticated: boolean; expiresAt: Date | null; timeToExpiry?: number } {
    const authenticated = !!(this.bearerToken && this.tokenExpiresAt && this.tokenExpiresAt > new Date());
    const timeToExpiry = this.tokenExpiresAt ? this.tokenExpiresAt.getTime() - Date.now() : undefined;
    
    return {
      authenticated,
      expiresAt: this.tokenExpiresAt,
      timeToExpiry
    };
  }

  /**
   * Fetch JIRA integrations from Zebrunner
   */
  async getJiraIntegrations(): Promise<JiraIntegrationsResponse> {
    const response = await this.makeAuthenticatedRequest<any>(
      'GET',
      '/api/integrations/v2/integrations/tool:jira'
    );

    const integrationsData = response.data || response;
    return JiraIntegrationsResponseSchema.parse(integrationsData);
  }

  /**
   * Resolve JIRA base URL with caching.
   * Priority: 
   * 1. Explicit override (from tool parameter)
   * 2. Cached value (session-level cache)
   * 3. Zebrunner integrations API (match by projectId, fallback to any enabled)
   * 4. Environment variable (JIRA_BASE_URL)
   * @throws {ZebrunnerReportingError} if no JIRA URL can be resolved
   */
  async resolveJiraBaseUrl(projectId?: number, override?: string): Promise<string> {
    this._jiraResolutionWarning = null;

    if (override) {
      const url = override.replace(/\/+$/, '');
      this.jiraBaseUrlCache = url;
      return url;
    }

    if (this.jiraBaseUrlCache) {
      return this.jiraBaseUrlCache;
    }

    try {
      const integrations = await this.getJiraIntegrations();
      
      if (integrations.items.length > 0) {
        const enabledIntegrations = integrations.items.filter(
          (integration) => integration.enabled && integration.tool === 'JIRA'
        );

        if (enabledIntegrations.length > 0) {
          let selectedIntegration = enabledIntegrations[0];

          if (projectId) {
            const projectMatch = enabledIntegrations.find((integration) =>
              integration.projectsMapping.enabledForZebrunnerProjectIds.includes(projectId)
            );
            if (projectMatch) {
              selectedIntegration = projectMatch;
            }
          }

          const jiraUrl = selectedIntegration.config.url;
          if (jiraUrl) {
            this.jiraBaseUrlCache = jiraUrl.replace(/\/+$/, '');
            return this.jiraBaseUrlCache;
          }
        }
      }
    } catch (error: any) {
      const status = error?.response?.status ?? error?.status;
      if (status === 403 || status === 401) {
        this._jiraResolutionWarning =
          'Your Zebrunner token does not have permission to read JIRA integrations. ' +
          'Set JIRA_BASE_URL in your MCP server environment or pass jira_base_url as a tool parameter.';
      } else {
        this._jiraResolutionWarning =
          `Failed to fetch JIRA integrations from Zebrunner: ${error instanceof Error ? error.message : error}. ` +
          'Set JIRA_BASE_URL in your MCP server environment or pass jira_base_url as a tool parameter.';
      }
    }

    const envJiraUrl = process.env.JIRA_BASE_URL;
    if (envJiraUrl) {
      this.jiraBaseUrlCache = envJiraUrl.replace(/\/+$/, '');
      return this.jiraBaseUrlCache;
    }

    const hint = this._jiraResolutionWarning
      ? this._jiraResolutionWarning
      : 'No JIRA integrations found in Zebrunner and JIRA_BASE_URL env var is not set. ' +
        'Configure JIRA_BASE_URL in your MCP server environment or pass jira_base_url as a tool parameter.';
    throw new ZebrunnerReportingError(hint);
  }

  get jiraResolutionWarning(): string | null {
    return this._jiraResolutionWarning;
  }

  /**
   * Build a JIRA issue URL
   * @param issueKey - JIRA issue key (e.g., "QAS-22939", "APPS-2771")
   * @param projectId - Optional project ID for project-specific JIRA integration
   * @param jiraBaseUrlOverride - Optional explicit JIRA base URL (skips API lookup)
   */
  async buildJiraUrl(issueKey: string, projectId?: number, jiraBaseUrlOverride?: string): Promise<string> {
    const jiraBaseUrl = await this.resolveJiraBaseUrl(projectId, jiraBaseUrlOverride);
    return `${jiraBaseUrl}/browse/${issueKey}`;
  }
}
