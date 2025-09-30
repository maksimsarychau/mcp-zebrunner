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
  rulesFileMinContentLength: 50 // Minimum chars for meaningful content (excluding whitespace/comments)
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
  ENABLE_RULES_ENGINE: 'enableRulesEngine'
} as const;

/**
 * Required environment variables that must be set
 */
export const REQUIRED_ENV_VARS = [
  'ZEBRUNNER_URL',
  'ZEBRUNNER_LOGIN', 
  'ZEBRUNNER_TOKEN'
] as const;
