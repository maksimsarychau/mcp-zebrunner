/**
 * Redirect URIs for "recovered" MCP OAuth clients (`mcp_*` IDs) when DCR data was lost
 * (e.g. Cloud Run cold start — in-memory `clients` map is empty).
 *
 * Desktop MCP hosts (Claude + mcp-remote, Cursor) use loopback with an ephemeral port.
 * The MCP SDK's `redirectUriMatches` (RFC 8252 §7.3) allows any port when the registered
 * URI omits the port for the same loopback host + path — so these base URIs accept
 * `http://127.0.0.1:36840/oauth/callback`, `http://localhost:36840/oauth/callback`, etc.
 */
export const RECOVERED_MCP_CLIENT_REDIRECT_URIS: string[] = [
  'http://127.0.0.1/oauth/callback',
  'http://localhost/oauth/callback',
  'http://[::1]/oauth/callback',
];
