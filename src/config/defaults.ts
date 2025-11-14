/**
 * Default configuration values for Zebrunner MCP Server
 * 
 * These defaults are used when environment variables are not set.
 * Only ZEBRUNNER_URL, ZEBRUNNER_LOGIN, and ZEBRUNNER_TOKEN are mandatory.
 */

export interface ZebrunnerDefaults {
  // Core API settings
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  
  // Pagination settings
  maxPageSize: number;
  defaultPageSize: number;
  
  // Feature flags
  debug: boolean;
  experimentalFeatures: boolean;
  enableRulesEngine: boolean | 'auto'; // 'auto' means detect from rules file
  
  // Rules engine settings
  rulesFileName: string;
  rulesFileMinContentLength: number; // Minimum meaningful content length
  
  // Security settings
  strictUrlValidation: boolean; // Enable strict URL validation for downloads
  skipUrlValidationOnError: boolean; // Skip validation if it fails (less secure, more permissive)
  
  // Rate limiting settings
  enableRateLimiting: boolean; // Enable rate limiting for API calls
  maxRequestsPerSecond: number; // Maximum requests per second (default: 5)
  rateLimitingBurst: number; // Allow burst of requests (default: 10)
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: ZebrunnerDefaults = {
  // Core API settings
  timeout: 30_000, // 30 seconds
  retryAttempts: 3,
  retryDelay: 1000, // 1 second
  
  // Pagination settings
  maxPageSize: 100,
  defaultPageSize: 10,
  
  // Feature flags
  debug: false,
  experimentalFeatures: false,
  enableRulesEngine: 'auto', // Auto-detect based on rules file
  
  // Rules engine settings
  rulesFileName: 'mcp-zebrunner-rules.md',
  rulesFileMinContentLength: 50, // Minimum chars for meaningful content (excluding whitespace/comments)
  
  // Security settings
  strictUrlValidation: true, // Enable strict URL validation by default for security
  skipUrlValidationOnError: false, // Throw error on validation failure by default
  
  // Rate limiting settings
  enableRateLimiting: true, // Enable rate limiting by default to prevent API abuse
  maxRequestsPerSecond: 5, // Conservative default: 5 requests per second
  rateLimitingBurst: 10 // Allow burst of up to 10 requests
};

/**
 * Environment variable mappings
 */
export const ENV_MAPPINGS = {
  ZEBRUNNER_URL: 'baseUrl',
  ZEBRUNNER_LOGIN: 'login', 
  ZEBRUNNER_TOKEN: 'authToken',
  TIMEOUT: 'timeout',
  RETRY_ATTEMPTS: 'retryAttempts',
  RETRY_DELAY: 'retryDelay',
  MAX_PAGE_SIZE: 'maxPageSize',
  DEFAULT_PAGE_SIZE: 'defaultPageSize',
  DEBUG: 'debug',
  ENABLE_RULES_ENGINE: 'enableRulesEngine',
  STRICT_URL_VALIDATION: 'strictUrlValidation',
  SKIP_URL_VALIDATION_ON_ERROR: 'skipUrlValidationOnError',
  ENABLE_RATE_LIMITING: 'enableRateLimiting',
  MAX_REQUESTS_PER_SECOND: 'maxRequestsPerSecond',
  RATE_LIMITING_BURST: 'rateLimitingBurst'
} as const;

/**
 * Required environment variables that must be set
 */
export const REQUIRED_ENV_VARS = [
  'ZEBRUNNER_URL',
  'ZEBRUNNER_LOGIN', 
  'ZEBRUNNER_TOKEN'
] as const;
