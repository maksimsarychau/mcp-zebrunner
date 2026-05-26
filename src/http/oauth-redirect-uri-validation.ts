const MAX_REDIRECT_URI_LENGTH = 2048;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const LOOPBACK_PATHS = new Set(['/oauth/callback', '/callback']);

/**
 * Validate redirect URIs allowed for recovered / env-extended MCP OAuth clients.
 * Blocks dangerous schemes; loopback http(s) and known native client schemes only.
 */
export function isAllowedMcpRedirectUri(uri: string): boolean {
  if (uri.length === 0 || uri.length > MAX_REDIRECT_URI_LENGTH) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme === 'javascript:' || scheme === 'data:' || scheme === 'file:') {
    return false;
  }

  if (scheme === 'http:' || scheme === 'https:') {
    return LOOPBACK_HOSTS.has(parsed.hostname) && LOOPBACK_PATHS.has(parsed.pathname);
  }

  if (scheme === 'cursor:') {
    return (
      parsed.hostname === 'anysphere.cursor-mcp' &&
      parsed.pathname === '/oauth/callback'
    );
  }

  // Other registered custom schemes (e.g. myapp://cb for tests / future clients)
  return /^[a-z][a-z0-9+.-]*:$/i.test(parsed.protocol);
}

export function filterAllowedMcpRedirectUris(uris: string[]): string[] {
  return uris.filter(isAllowedMcpRedirectUri);
}
