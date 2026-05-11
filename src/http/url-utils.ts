const API_SUFFIX = '/api/public/v1';

/**
 * Normalise a user-friendly Zebrunner URL into the internal API base URL.
 *
 *   "https://mcp.zebrunner.com"              → "https://mcp.zebrunner.com/api/public/v1"
 *   "https://mcp.zebrunner.com/"             → "https://mcp.zebrunner.com/api/public/v1"
 *   "https://mcp.zebrunner.com/api/public/v1" → kept as-is
 *
 * Rejects empty, non-HTTPS (in production), and obviously malformed URLs.
 */
export function normalizeZebrunnerUrl(input: string): string {
  const trimmed = input?.trim();
  if (!trimmed) {
    throw new Error('Zebrunner URL is required');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(
      `Invalid URL format: "${trimmed}". Expected something like https://your-company.zebrunner.com`,
    );
  }

  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('Zebrunner URL must use HTTPS');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }

  let base = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, '');

  if (!base.endsWith(API_SUFFIX)) {
    base += API_SUFFIX;
  }

  return base;
}

/**
 * Derive the human-readable Zebrunner web URL from the internal API URL.
 *   "https://mcp.zebrunner.com/api/public/v1" → "https://mcp.zebrunner.com"
 */
export function toWebUrl(apiUrl: string): string {
  return apiUrl.replace(/\/api\/public\/v1\/?$/, '');
}
