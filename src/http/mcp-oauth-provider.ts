import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { TokenStore } from './token-store.js';
import { TokenValidator } from './token-validator.js';
import type { OktaConfig } from './oauth-provider.js';

// Re-export for convenience
export type { OktaConfig } from './oauth-provider.js';

interface PendingAuth {
  mcpClientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  createdAt: number;
}

interface IssuedCode {
  oktaAccessToken: string;
  oktaIdToken?: string;
  mcpClientId: string;
  redirectUri: string;
  codeChallenge: string;
  createdAt: number;
}

interface RegisteredClient {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  client_name?: string;
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  client_id_issued_at: number;
}

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ISSUED_CODE_TTL_MS = 5 * 60 * 1000;   // 5 minutes

/**
 * Custom OAuthServerProvider that delegates authentication to Okta
 * while acting as a full OAuth Authorization Server for MCP clients.
 *
 * Flow:
 * 1. MCP client registers via POST /register (dynamic client registration)
 * 2. MCP client redirects user to GET /authorize (our endpoint)
 * 3. We redirect to Okta's /authorize using OUR OIDC app credentials
 * 4. Okta authenticates user (including Duo MFA if configured)
 * 5. Okta redirects to /auth/callback on our server
 * 6. We exchange code for Okta tokens, generate our own auth code
 * 7. We redirect to MCP client's redirect_uri with our code
 * 8. MCP client exchanges our code at POST /token
 * 9. We return the Okta access token
 * 10. MCP client uses Bearer token for /mcp requests
 * 11. We verify JWT via JWKS and look up per-user Zebrunner token from store
 *
 * No shared credentials: every user must have their own Zebrunner
 * token stored in TokenStore (entered via /login after Okta SSO).
 */
export class McpOAuthServerProvider implements OAuthServerProvider {
  skipLocalPkceValidation = true;

  private clients = new Map<string, RegisteredClient>();
  private pendingAuths = new Map<string, PendingAuth>();
  private issuedCodes = new Map<string, IssuedCode>();
  private oktaConfig: OktaConfig;
  tokenStore: TokenStore;
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private validator: TokenValidator;

  constructor(config: OktaConfig, tokenStore: TokenStore, zebrunnerBaseUrl: string) {
    this.oktaConfig = config;
    this.tokenStore = tokenStore;
    this.jwks = createRemoteJWKSet(
      new URL(`https://${config.domain}/oauth2/${config.authServerId}/v1/keys`),
    );
    this.validator = new TokenValidator(zebrunnerBaseUrl, tokenStore);

    const sweep = setInterval(() => this.sweep(), 60_000);
    sweep.unref();
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        const existing = this.clients.get(clientId);
        if (existing) return existing as any;

        // Auto-accept previously registered mcp_* clients whose registration
        // was lost on server restart (in-memory store). Real security comes
        // from Okta authentication + PKCE, not from DCR client validation.
        if (clientId.startsWith('mcp_')) {
          const fallback: RegisteredClient = {
            client_id: clientId,
            redirect_uris: [],
            token_endpoint_auth_method: 'none',
            client_name: 'Auto-recovered MCP client',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            client_id_issued_at: Math.floor(Date.now() / 1000),
          };
          this.clients.set(clientId, fallback);
          return fallback as any;
        }

        return undefined;
      },
      registerClient: async (clientInfo: any) => {
        const clientId = `mcp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const authMethod = clientInfo.token_endpoint_auth_method || 'none';
        const needsSecret = authMethod !== 'none';

        const registered: RegisteredClient = {
          client_id: clientId,
          ...(needsSecret && { client_secret: randomBytes(32).toString('hex') }),
          redirect_uris: clientInfo.redirect_uris || [],
          client_name: clientInfo.client_name,
          grant_types: clientInfo.grant_types || ['authorization_code'],
          response_types: clientInfo.response_types || ['code'],
          token_endpoint_auth_method: authMethod,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };

        this.clients.set(clientId, registered);

        return {
          ...registered,
          client_secret_expires_at: 0,
        } as any;
      },
    };
  }

  /**
   * Step 2: MCP client hits /authorize. We store pending state and redirect to Okta.
   */
  async authorize(
    client: any,
    params: { redirectUri: string; codeChallenge: string; state?: string; scopes?: string[]; resource?: URL },
    res: Response,
  ): Promise<void> {
    const stateKey = randomBytes(32).toString('hex');

    this.pendingAuths.set(stateKey, {
      mcpClientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      state: params.state,
      scopes: params.scopes,
      createdAt: Date.now(),
    });

    const oktaAuthUrl = new URL(
      `https://${this.oktaConfig.domain}/oauth2/${this.oktaConfig.authServerId}/v1/authorize`,
    );
    oktaAuthUrl.searchParams.set('client_id', this.oktaConfig.clientId);
    oktaAuthUrl.searchParams.set('response_type', 'code');
    oktaAuthUrl.searchParams.set('redirect_uri', `${this.oktaConfig.serverUrl}/auth/callback`);
    oktaAuthUrl.searchParams.set('scope', 'openid email profile');
    oktaAuthUrl.searchParams.set('state', stateKey);

    res.redirect(oktaAuthUrl.toString());
  }

  /**
   * Called by the SDK after MCP client sends our code to POST /token.
   * In proxy mode we skip local PKCE since we validated it during code generation.
   */
  async challengeForAuthorizationCode(
    _client: any,
    _authorizationCode: string,
  ): Promise<string> {
    return '';
  }

  /**
   * Step 8: MCP client exchanges our auth code for tokens.
   */
  async exchangeAuthorizationCode(
    client: any,
    authorizationCode: string,
    _codeVerifier?: string,
    _redirectUri?: string,
    _resource?: URL,
  ): Promise<any> {
    const issued = this.issuedCodes.get(authorizationCode);
    if (!issued) {
      throw new Error('Invalid or expired authorization code');
    }

    if (issued.mcpClientId !== client.client_id) {
      throw new Error('Authorization code was issued to a different client');
    }

    this.issuedCodes.delete(authorizationCode);

    return {
      access_token: issued.oktaAccessToken,
      token_type: 'bearer',
      ...(issued.oktaIdToken && { id_token: issued.oktaIdToken }),
    };
  }

  async exchangeRefreshToken(
    _client: any,
    _refreshToken: string,
    _scopes?: string[],
    _resource?: URL,
  ): Promise<any> {
    throw new Error('Refresh tokens are not supported. Re-authenticate via OAuth flow.');
  }

  /**
   * Step 11: Verify the Okta access token on each /mcp request.
   * Extracts user email, looks up per-user Zebrunner credentials from TokenStore.
   * Throws if no credentials are found (user must complete /login first).
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { payload } = await jwtVerify(token, this.jwks, {
      issuer: `https://${this.oktaConfig.domain}/oauth2/${this.oktaConfig.authServerId}`,
    });

    const email = (payload.email ?? payload.sub) as string | undefined;
    if (!email) {
      throw new Error('Token missing email/sub claim');
    }

    const stored = await this.tokenStore.get(email);
    if (!stored) {
      throw new Error(
        `No Zebrunner credentials found for ${email}. ` +
        'Please complete the Zebrunner credential setup at /login.',
      );
    }

    await this.validator.validateOncePerDay(email, stored.token);

    return {
      token,
      clientId: (payload.cid ?? payload.client_id ?? 'unknown') as string,
      scopes: Array.isArray(payload.scp) ? payload.scp as string[] : ['zebrunner:read', 'zebrunner:write'],
      expiresAt: payload.exp,
      extra: {
        email,
        username: stored.username,
        zebrunnerToken: stored.token,
      },
    };
  }

  // --- Methods used by auth-callback.ts ---

  getPendingAuth(stateKey: string): PendingAuth | undefined {
    return this.pendingAuths.get(stateKey);
  }

  deletePendingAuth(stateKey: string): void {
    this.pendingAuths.delete(stateKey);
  }

  storeIssuedCode(code: string, data: IssuedCode): void {
    this.issuedCodes.set(code, data);
  }

  getOktaConfig(): OktaConfig {
    return this.oktaConfig;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, val] of this.pendingAuths) {
      if (now - val.createdAt > PENDING_AUTH_TTL_MS) this.pendingAuths.delete(key);
    }
    for (const [key, val] of this.issuedCodes) {
      if (now - val.createdAt > ISSUED_CODE_TTL_MS) this.issuedCodes.delete(key);
    }
    this.validator.sweep();
  }
}

let _providerInstance: McpOAuthServerProvider | null = null;

/**
 * Create and cache the OAuth provider singleton.
 * TokenStore is required — per-user credentials are mandatory (no shared credentials).
 */
export function createMcpOAuthProvider(
  config: OktaConfig,
  tokenStore: TokenStore,
  zebrunnerBaseUrl: string,
): McpOAuthServerProvider {
  if (!_providerInstance) {
    _providerInstance = new McpOAuthServerProvider(config, tokenStore, zebrunnerBaseUrl);
  }
  return _providerInstance;
}

export function getMcpOAuthProvider(): McpOAuthServerProvider | null {
  return _providerInstance;
}
