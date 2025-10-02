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
  MilestonesResponse,
  MilestonesResponseSchema,
  AvailableProjectsResponse,
  AvailableProjectsResponseSchema,
  ProjectsLimitResponse,
  ProjectsLimitResponseSchema,
  LaunchesResponse,
  LaunchesResponseSchema,
  ZebrunnerReportingError,
  ZebrunnerReportingAuthError,
  ZebrunnerReportingNotFoundError
} from "../types/reporting.js";

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

  constructor(config: ZebrunnerReportingConfig) {
    this.config = {
      timeout: 30_000,
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
          console.log(`[ZebrunnerReportingClient] ${config.method?.toUpperCase()} ${config.url}`);
          if (config.data) {
            console.log('[ZebrunnerReportingClient] Request data:', config.data);
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
          console.log(`[ZebrunnerReportingClient] Response ${response.status}:`, response.data);
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
        console.log('[ZebrunnerReportingClient] Authentication successful, token expires at:', this.tokenExpiresAt);
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

    const response = await this.http.request(config);
    return response.data;
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
    
    try {
      const response = await this.makeAuthenticatedRequest<any>('GET', url);
      const data = response.data || response;
      
      // Expected format: array of { id: number, name: string } objects
      if (Array.isArray(data)) {
        return data.map((item: any) => ({
          id: item.id,
          name: item.name
        }));
      }
      
      throw new ZebrunnerReportingError('Unexpected response format for automation states');
    } catch (error) {
      // If the API call fails, return default mapping
      console.warn('Failed to fetch automation states from API, using default mapping:', error);
      return [
        { id: 10, name: "Not Automated" },
        { id: 11, name: "To Be Automated" },
        { id: 12, name: "Automated" }
      ];
    }
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
      // Enhanced error logging
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`❌ Failed to fetch priorities from API (${url}):`, errorMessage);
      
      if (this.config.debug && error instanceof Error) {
        console.error('Full error details:', error);
      }
      
      // Return fallback priorities based on your actual system
      console.warn('Using fallback priority mapping based on actual system values');
      return [
        { id: 15, name: "High" },
        { id: 16, name: "Medium" },
        { id: 17, name: "Low" },
        { id: 18, name: "Trivial" },
        { id: 35, name: "Critical" }
      ];
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
}
