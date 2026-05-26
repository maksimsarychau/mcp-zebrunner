import type { OAuthFlowStore, OAuthRegisteredClientRecord } from './oauth-flow-store.js';
import { filterAllowedMcpRedirectUris } from './oauth-redirect-uri-validation.js';

/**
 * Redirect URIs for "recovered" MCP OAuth clients (`mcp_*` IDs) when DCR data was lost
 * or a persisted record is missing canonical host URIs (e.g. after redeploy).
 *
 * Host coverage:
 * - Claude Desktop + mcp-remote: loopback `/oauth/callback` (RFC 8252 §7.3 port matching)
 * - Claude Code native HTTP MCP: loopback `/callback`
 * - Cursor native MCP OAuth: `cursor://anysphere.cursor-mcp/oauth/callback`
 */
export const RECOVERED_MCP_CLIENT_REDIRECT_URIS: readonly string[] = [
  // Claude Desktop + mcp-remote
  'http://127.0.0.1/oauth/callback',
  'http://localhost/oauth/callback',
  'http://[::1]/oauth/callback',
  // Claude Code native HTTP MCP
  'http://127.0.0.1/callback',
  'http://localhost/callback',
  'http://[::1]/callback',
  // Cursor native MCP OAuth
  'cursor://anysphere.cursor-mcp/oauth/callback',
];

/** Canonical list plus optional `OAUTH_RECOVERED_REDIRECT_URIS` (comma-separated). */
export function getRecoveredMcpClientRedirectUris(): string[] {
  const extraRaw =
    process.env.OAUTH_RECOVERED_REDIRECT_URIS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const extra = filterAllowedMcpRedirectUris(extraRaw);
  return [...RECOVERED_MCP_CLIENT_REDIRECT_URIS, ...extra];
}

export function needsRecoveredRedirectMerge(redirectUris: string[]): boolean {
  const canonical = getRecoveredMcpClientRedirectUris();
  return canonical.some((uri) => !redirectUris.includes(uri));
}

export function mergeRecoveredRedirectUris(redirectUris: string[]): string[] {
  const merged = [...redirectUris];
  for (const uri of getRecoveredMcpClientRedirectUris()) {
    if (!merged.includes(uri)) merged.push(uri);
  }
  return merged;
}

export function createRecoveredMcpClientRecord(clientId: string): OAuthRegisteredClientRecord {
  return {
    client_id: clientId,
    redirect_uris: getRecoveredMcpClientRedirectUris(),
    token_endpoint_auth_method: 'none',
    client_name: 'Auto-recovered MCP client',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Load or recover an `mcp_*` OAuth client; merge canonical redirect URIs into stale persisted records.
 */
export async function resolveMcpOAuthClient(
  flowStore: OAuthFlowStore,
  clientId: string,
): Promise<OAuthRegisteredClientRecord | null> {
  const existing = await flowStore.getClient(clientId);

  if (!clientId.startsWith('mcp_')) {
    return existing;
  }

  if (existing) {
    if (!needsRecoveredRedirectMerge(existing.redirect_uris)) {
      return existing;
    }
    const merged: OAuthRegisteredClientRecord = {
      ...existing,
      redirect_uris: mergeRecoveredRedirectUris(existing.redirect_uris),
    };
    await flowStore.setClient(clientId, merged);
    return merged;
  }

  const fallback = createRecoveredMcpClientRecord(clientId);
  await flowStore.setClient(clientId, fallback);
  return fallback;
}
