import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TokenStore } from './token-store.js';
import { getRecoveredMcpClientRedirectUris } from './mcp-client-fallback-redirects.js';

export interface TokenStoreHealth {
  enabled: boolean;
  backend: 'file' | 'none';
  path?: string;
  fileExists?: boolean;
  writable?: boolean;
  storedUserCount?: number;
  loadError?: string;
}

export interface OAuthFlowStoreHealth {
  enabled: boolean;
  backend: 'file' | 'memory';
  directory?: string;
  directoryExists?: boolean;
  writable?: boolean;
  pendingCount?: number;
  issuedCodeCount?: number;
  registeredClientCount?: number;
  scanError?: string;
}

export interface HealthStatusPayload {
  /** Always `ok` when the HTTP server is running (backward compatible with probes). */
  status: 'ok';
  version: string;
  transport: 'streamablehttp';
  authMode: string;
  oauthEnabled: boolean;
  tokenStoreEnabled: boolean;
  activeSessions: number;
  /** Added in 9.0.2 — optional ops fields; omit nothing from pre-9.0.2 clients. */
  mcpServerUrl?: string;
  zebrunnerUrlFromEnv?: boolean;
  storage?: {
    health: 'ok' | 'degraded';
    probeError?: string;
    tokenStore: TokenStoreHealth;
    oauthFlowStore: OAuthFlowStoreHealth;
    recoveredRedirectUriCount: number;
  };
}

async function countEncFiles(dir: string): Promise<number> {
  try {
    const names = await readdir(dir);
    return names.filter((n) => n.endsWith('.enc')).length;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 0;
    throw err;
  }
}

async function pathWritable(dir: string): Promise<boolean> {
  try {
    await access(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function collectTokenStoreHealth(
  tokenStore: TokenStore | undefined,
): Promise<TokenStoreHealth> {
  const path = process.env.TOKEN_STORE_PATH;
  const keyConfigured = !!process.env.TOKEN_STORE_KEY;

  if (!tokenStore || !path || !keyConfigured) {
    return { enabled: false, backend: 'none' };
  }

  const health: TokenStoreHealth = {
    enabled: true,
    backend: 'file',
    path,
  };

  try {
    const st = await stat(path);
    health.fileExists = st.isFile();
  } catch (err: unknown) {
    health.fileExists = false;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      health.loadError = (err as Error).message;
    }
  }

  try {
    health.writable = await pathWritable(dirname(path));
  } catch {
    health.writable = false;
  }

  try {
    health.storedUserCount = (await tokenStore.list()).length;
  } catch (err: unknown) {
    health.loadError = (err as Error).message;
  }

  return health;
}

export async function collectOAuthFlowStoreHealth(): Promise<OAuthFlowStoreHealth> {
  const tokenPath = process.env.TOKEN_STORE_PATH;
  const storeKey = process.env.TOKEN_STORE_KEY;

  if (!tokenPath || !storeKey) {
    return {
      enabled: false,
      backend: 'memory',
    };
  }

  const directory =
    process.env.OAUTH_FLOW_STORE_DIR ?? join(dirname(tokenPath), 'oauth-flow');

  const health: OAuthFlowStoreHealth = {
    enabled: true,
    backend: 'file',
    directory,
  };

  try {
    const st = await stat(directory);
    health.directoryExists = st.isDirectory();
    health.writable = await pathWritable(directory);
    health.pendingCount = await countEncFiles(join(directory, 'pending'));
    health.issuedCodeCount = await countEncFiles(join(directory, 'codes'));
    health.registeredClientCount = await countEncFiles(join(directory, 'clients'));
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      health.directoryExists = false;
      health.pendingCount = 0;
      health.issuedCodeCount = 0;
      health.registeredClientCount = 0;
      health.writable = await pathWritable(dirname(directory));
    } else {
      health.scanError = (err as Error).message;
    }
  }

  return health;
}

export async function buildHealthStatus(input: {
  version: string;
  authMode: string;
  oauthEnabled: boolean;
  tokenStore?: TokenStore;
  mcpServerUrl: string;
  zebrunnerUrlFromEnv: boolean;
  activeSessions: number;
}): Promise<HealthStatusPayload> {
  const tokenStoreHealth = await collectTokenStoreHealth(input.tokenStore);
  const oauthFlowHealth = await collectOAuthFlowStoreHealth();

  const storageDegraded =
    (tokenStoreHealth.enabled && tokenStoreHealth.loadError !== undefined) ||
    (oauthFlowHealth.enabled && oauthFlowHealth.scanError !== undefined) ||
    (tokenStoreHealth.enabled && tokenStoreHealth.writable === false) ||
    (oauthFlowHealth.enabled && oauthFlowHealth.writable === false);

  return {
    status: 'ok',
    version: input.version,
    transport: 'streamablehttp',
    authMode: input.authMode,
    oauthEnabled: input.oauthEnabled,
    tokenStoreEnabled: !!input.tokenStore,
    activeSessions: input.activeSessions,
    mcpServerUrl: input.mcpServerUrl,
    zebrunnerUrlFromEnv: input.zebrunnerUrlFromEnv,
    storage: {
      health: storageDegraded ? 'degraded' : 'ok',
      tokenStore: tokenStoreHealth,
      oauthFlowStore: oauthFlowHealth,
      recoveredRedirectUriCount: getRecoveredMcpClientRedirectUris().length,
    },
  };
}

/** Legacy fields only — used when storage probe throws (still HTTP 200). */
export function buildMinimalHealthStatus(input: {
  version: string;
  authMode: string;
  oauthEnabled: boolean;
  tokenStore?: TokenStore;
  activeSessions: number;
  probeError: string;
}): HealthStatusPayload {
  return {
    status: 'ok',
    version: input.version,
    transport: 'streamablehttp',
    authMode: input.authMode,
    oauthEnabled: input.oauthEnabled,
    tokenStoreEnabled: !!input.tokenStore,
    activeSessions: input.activeSessions,
    storage: {
      health: 'degraded',
      probeError: input.probeError,
      tokenStore: { enabled: !!input.tokenStore, backend: input.tokenStore ? 'file' : 'none' },
      oauthFlowStore: { enabled: false, backend: 'memory' },
      recoveredRedirectUriCount: getRecoveredMcpClientRedirectUris().length,
    },
  };
}
