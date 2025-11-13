import path from 'path';

/**
 * Security utilities for input validation and sanitization
 */

/**
 * Sensitive directories that should be blocked from access
 */
const BLOCKED_DIRECTORIES = [
  '/etc',
  '/home',
  '/.ssh',
  '/root',
  '/var',
  '/usr',
  '/sys',
  '/proc',
  '/dev',
  '/boot',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64'
];

/**
 * Validates a file path to prevent path traversal attacks
 * Blocks access to sensitive system directories
 * 
 * @param userPath - User-provided file path (relative or absolute)
 * @param baseDir - Base directory to resolve relative paths (defaults to cwd)
 * @returns Validated absolute path
 * @throws Error if path is invalid or blocked
 */
export function validateFilePath(userPath: string, baseDir: string = process.cwd()): string {
  // Check for null bytes (common in path traversal attacks)
  if (userPath.includes('\0')) {
    throw new Error('Security: Invalid path - contains null byte');
  }

  // Check for suspicious patterns
  if (userPath.includes('..')) {
    throw new Error('Security: Invalid path - path traversal detected');
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(baseDir, userPath);
  const normalizedPath = path.normalize(resolvedPath);

  // Check if path starts with any blocked directory
  for (const blockedDir of BLOCKED_DIRECTORIES) {
    if (normalizedPath.startsWith(blockedDir)) {
      throw new Error(`Security: Access denied - path in sensitive directory: ${blockedDir}`);
    }
  }

  // Additional check: ensure resolved path doesn't escape base directory for relative paths
  // (only if userPath was relative)
  if (!path.isAbsolute(userPath)) {
    const resolvedBase = path.resolve(baseDir);
    if (!normalizedPath.startsWith(resolvedBase)) {
      throw new Error('Security: Access denied - path escapes base directory');
    }
  }

  return normalizedPath;
}

/**
 * Masks a token for safe logging
 * Shows first 4 and last 4 characters
 * 
 * @param token - Token to mask
 * @returns Masked token string
 */
export function maskToken(token: string): string {
  if (!token) {
    return '[empty token]';
  }

  if (token.length <= 8) {
    return '****';
  }

  const start = token.substring(0, 4);
  const end = token.substring(token.length - 4);
  return `${start}...${end}`;
}

/**
 * Masks an Authorization header value for safe logging
 * 
 * @param authHeader - Authorization header value (e.g., "Bearer xyz123...")
 * @returns Masked header value
 */
export function maskAuthHeader(authHeader: string): string {
  if (!authHeader) {
    return '[no auth]';
  }

  // Extract token from "Bearer <token>" or "Basic <token>"
  const parts = authHeader.split(' ');
  if (parts.length !== 2) {
    return '[invalid format]';
  }

  const [type, token] = parts;
  return `${type} ${maskToken(token)}`;
}

/**
 * Configuration for URL validation
 */
export interface UrlValidationConfig {
  strictMode?: boolean;
  skipOnError?: boolean;
}

/**
 * Validates a file URL to prevent SSRF attacks
 * 
 * @param fileUrl - URL or path to validate
 * @param config - Validation configuration
 * @returns Validated URL
 * @throws Error if URL is invalid (unless skipOnError is true)
 */
export function validateFileUrl(
  fileUrl: string,
  config: UrlValidationConfig = {}
): string {
  const { strictMode = true, skipOnError = false } = config;

  try {
    // Check for null bytes
    if (fileUrl.includes('\0')) {
      throw new Error('Security: Invalid URL - contains null byte');
    }

    // Check for dangerous protocols
    const dangerousProtocols = /^(file|ftp|gopher|data|javascript|vbscript):/i;
    if (dangerousProtocols.test(fileUrl)) {
      throw new Error('Security: Invalid URL - dangerous protocol detected');
    }

    // In strict mode, only allow specific patterns
    if (strictMode) {
      // Allow relative paths starting with /files/ followed by alphanumeric, dash, underscore, dot, or slash
      if (fileUrl.startsWith('/files/')) {
        const pathPart = fileUrl.substring(7); // Remove '/files/'
        if (!/^[a-zA-Z0-9_/.-]+$/.test(pathPart)) {
          throw new Error('Security: Invalid URL - contains disallowed characters');
        }
      }
      // Allow full URLs only if they're HTTPS
      else if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        // Parse URL to validate
        try {
          const url = new URL(fileUrl);
          // Only allow https in production
          if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
            throw new Error('Security: Invalid URL - HTTPS required in production');
          }
        } catch (e) {
          throw new Error('Security: Invalid URL - malformed URL');
        }
      } else {
        throw new Error('Security: Invalid URL - must start with /files/ or be a valid HTTP(S) URL');
      }
    }

    return fileUrl;
  } catch (error) {
    if (skipOnError) {
      console.warn(`[Security] URL validation warning: ${error instanceof Error ? error.message : error}`);
      console.warn(`[Security] Proceeding with unvalidated URL (skipOnError=true): ${fileUrl}`);
      return fileUrl;
    }
    throw error;
  }
}

/**
 * Sanitizes error messages to prevent information leakage
 * Shows full errors in DEBUG/development, generic messages in production
 * 
 * @param error - Error object
 * @param userMessage - User-friendly message to return in production
 * @param context - Optional context for logging
 * @returns Sanitized error message
 */
export function sanitizeErrorMessage(
  error: any,
  userMessage: string = 'An error occurred',
  context?: string
): string {
  const isDebug = process.env.DEBUG === 'true';
  const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

  // In development or debug mode, show full errors
  if (isDebug || isDev) {
    const contextPrefix = context ? `[${context}] ` : '';
    console.error(`${contextPrefix}Full error details:`, error);

    // Return detailed error message in dev/debug
    if (error instanceof Error) {
      return `${userMessage}: ${error.message}`;
    }
    return `${userMessage}: ${String(error)}`;
  }

  // In production, log error internally but return generic message
  if (context) {
    console.error(`[${context}] Error occurred (details hidden in production)`);
  } else {
    console.error('Error occurred (details hidden in production)');
  }

  // Return generic message to user in production
  return userMessage;
}

/**
 * Sanitize error for API responses
 * Ensures no sensitive information leaks through error responses
 * 
 * @param error - Error object  
 * @param operation - Description of operation that failed
 * @returns Sanitized error object for API response
 */
export function sanitizeApiError(error: any, operation: string): { 
  message: string;
  operation: string;
  timestamp: string;
} {
  const isDebug = process.env.DEBUG === 'true';
  const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

  // Log full error internally
  console.error(`[API Error] ${operation}:`, error);

  // In development/debug, return detailed error
  if (isDebug || isDev) {
    return {
      message: error instanceof Error ? error.message : String(error),
      operation,
      timestamp: new Date().toISOString()
    };
  }

  // In production, return generic error
  return {
    message: `Failed to ${operation}. Please try again or contact support if the problem persists.`,
    operation,
    timestamp: new Date().toISOString()
  };
}

