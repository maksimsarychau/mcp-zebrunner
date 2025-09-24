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
    const project = ProjectResponseSchema.parse(projectData);
    
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
   * Clear project cache
   */
  clearProjectCache(): void {
    this.projectCache.clear();
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
