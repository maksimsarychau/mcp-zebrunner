export type TransportMode = 'stdio' | 'http';

export type AuthMode = 'headers' | 'selfauth' | 'okta' | 'headers,selfauth' | 'headers,okta';

/** Ordered list of individual auth strategies that can be composed. */
export type AuthStrategy = 'headers' | 'selfauth' | 'okta';

export function resolveTransportMode(): TransportMode {
  const explicit = process.env.MCP_TRANSPORT?.toLowerCase();
  if (explicit === 'stdio') return 'stdio';
  if (explicit === 'http' || explicit === 'streamablehttp') {
    if (!process.env.PORT) {
      throw new Error('MCP_TRANSPORT=http requires PORT to be set');
    }
    return 'http';
  }
  if (explicit === 'auto' || !explicit) {
    return process.env.PORT ? 'http' : 'stdio';
  }
  throw new Error(
    `Invalid MCP_TRANSPORT="${explicit}". Must be "stdio", "http", or "auto"`,
  );
}

const VALID_STRATEGIES: AuthStrategy[] = ['headers', 'selfauth', 'okta'];

/**
 * Resolve the authentication mode from MCP_AUTH_MODE.
 *
 * Accepted values:
 *  - "headers"          → Mode 2 (X-Zebrunner-* headers only)
 *  - "selfauth"         → Mode 3 (self-service OAuth, credential form)
 *  - "okta"             → Mode 4 (Okta OIDC + credential form)
 *  - "headers,selfauth" → Mode 2 + 3 (try headers first, fall back to selfauth OAuth)
 *  - "headers,okta"     → Mode 2 + 4 (try headers first, fall back to Okta OAuth)
 *
 * Legacy: "oauth" is treated as "okta", "both" is treated as "headers,okta".
 */
export function resolveAuthMode(): AuthMode {
  const raw = (process.env.MCP_AUTH_MODE ?? 'headers').toLowerCase().trim();

  // Legacy aliases
  if (raw === 'oauth') return 'okta';
  if (raw === 'both') return 'headers,okta';

  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  if (parts.length === 1 && VALID_STRATEGIES.includes(parts[0] as AuthStrategy)) {
    return parts[0] as AuthMode;
  }

  if (parts.length === 2) {
    const sorted = parts.sort() as [string, string];
    const combo = sorted.join(',');
    if (combo === 'headers,okta' || combo === 'headers,selfauth') {
      return combo as AuthMode;
    }
  }

  throw new Error(
    `Invalid MCP_AUTH_MODE="${raw}". ` +
    `Accepted: headers, selfauth, okta, headers,selfauth, headers,okta (legacy: oauth, both)`,
  );
}

/** Check whether a given strategy is active in the resolved mode. */
export function hasStrategy(mode: AuthMode, strategy: AuthStrategy): boolean {
  return mode === strategy || mode.split(',').includes(strategy);
}
