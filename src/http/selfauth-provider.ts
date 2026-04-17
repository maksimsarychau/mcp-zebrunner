import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { TokenStore } from './token-store.js';
import { TokenValidator } from './token-validator.js';

interface PendingAuth {
  mcpClientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
  createdAt: number;
}

interface IssuedCode {
  email: string;
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

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
const ISSUED_CODE_TTL_MS = 5 * 60 * 1000;
// Zebrunner API tokens can be permanent (no expiration), so the server-signed
// OAuth JWT also has no expiry. Credentials remain valid until the token store
// is cleared or the actual Zebrunner API call fails.

/**
 * Self-service OAuthServerProvider — Mode 3.
 *
 * Acts as a complete OAuth 2.1 Authorization Server. Instead of delegating to
 * an external IdP (Okta), the "authorize" step redirects to our own /login page
 * where the user enters Zebrunner credentials. Those are validated against
 * Zebrunner IAM and stored encrypted in TokenStore.
 *
 * Subsequent connections look up the user by a server-signed JWT that encodes
 * their email, so they never need to enter credentials again.
 */
export class SelfAuthOAuthProvider implements OAuthServerProvider {
  skipLocalPkceValidation = true;

  private clients = new Map<string, RegisteredClient>();
  private pendingAuths = new Map<string, PendingAuth>();
  private issuedCodes = new Map<string, IssuedCode>();
  private tokenStore: TokenStore;
  private serverUrl: string;
  private zebrunnerBaseUrl: string;
  private jwtSecret: string;
  private validator: TokenValidator;

  constructor(opts: {
    tokenStore: TokenStore;
    serverUrl: string;
    zebrunnerBaseUrl: string;
    jwtSecret: string;
  }) {
    this.tokenStore = opts.tokenStore;
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.zebrunnerBaseUrl = opts.zebrunnerBaseUrl;
    this.jwtSecret = opts.jwtSecret;
    this.validator = new TokenValidator(opts.zebrunnerBaseUrl, opts.tokenStore);

    const sweep = setInterval(() => this.sweep(), 60_000);
    sweep.unref();
  }

  // ─── DCR ────────────────────────────────────────────────────────

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        const existing = this.clients.get(clientId);
        if (existing) return existing as any;

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
        return { ...registered, client_secret_expires_at: 0 } as any;
      },
    };
  }

  // ─── Authorize → redirect to our /login page ───────────────────

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

    res.redirect(`${this.serverUrl}/login?state=${stateKey}`);
  }

  async challengeForAuthorizationCode(): Promise<string> {
    return '';
  }

  // ─── Token exchange: our code → server-signed JWT ──────────────

  async exchangeAuthorizationCode(
    client: any,
    authorizationCode: string,
  ): Promise<any> {
    const issued = this.issuedCodes.get(authorizationCode);
    if (!issued) throw new Error('Invalid or expired authorization code');
    if (issued.mcpClientId !== client.client_id) {
      throw new Error('Authorization code was issued to a different client');
    }
    this.issuedCodes.delete(authorizationCode);

    const accessToken = this.signJwt(issued.email);

    return { access_token: accessToken, token_type: 'bearer' };
  }

  async exchangeRefreshToken(): Promise<any> {
    throw new Error('Refresh tokens not supported. Re-authenticate via the login flow.');
  }

  // ─── Verify JWT on each /mcp request → resolve Zebrunner creds ─

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const payload = this.verifyJwt(token);

    const stored = await this.tokenStore.get(payload.email);
    if (!stored) {
      throw new Error(
        `No Zebrunner credentials found for ${payload.email}. ` +
        'Please re-authenticate to enter your Zebrunner credentials.',
      );
    }

    await this.validator.validateOncePerDay(payload.email, stored.token);

    return {
      token,
      clientId: payload.cid ?? 'unknown',
      scopes: ['zebrunner:read', 'zebrunner:write'],
      expiresAt: payload.exp,
      extra: {
        email: payload.email,
        username: stored.username,
        zebrunnerToken: stored.token,
      },
    };
  }

  // ─── Methods used by login-routes.ts ───────────────────────────

  getPendingAuth(stateKey: string): PendingAuth | undefined {
    return this.pendingAuths.get(stateKey);
  }

  deletePendingAuth(stateKey: string): void {
    this.pendingAuths.delete(stateKey);
  }

  storeIssuedCode(code: string, data: IssuedCode): void {
    this.issuedCodes.set(code, data);
  }

  getTokenStore(): TokenStore {
    return this.tokenStore;
  }

  getZebrunnerBaseUrl(): string {
    return this.zebrunnerBaseUrl;
  }

  // ─── Server-signed JWT helpers ─────────────────────────────────

  private signJwt(email: string): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      email,
      cid: 'selfauth',
      iat: now,
    };

    const segments = [
      Buffer.from(JSON.stringify(header)).toString('base64url'),
      Buffer.from(JSON.stringify(payload)).toString('base64url'),
    ];
    const signature = createHmac('sha256', this.jwtSecret)
      .update(segments.join('.'))
      .digest('base64url');

    return `${segments.join('.')}.${signature}`;
  }

  private verifyJwt(token: string): { email: string; cid: string; exp?: number } {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');

    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (expectedSig !== signatureB64) throw new Error('Invalid token signature');

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      throw new Error('Token expired');
    }

    return payload;
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

let _selfAuthInstance: SelfAuthOAuthProvider | null = null;

export function createSelfAuthProvider(opts: {
  tokenStore: TokenStore;
  serverUrl: string;
  zebrunnerBaseUrl: string;
  jwtSecret: string;
}): SelfAuthOAuthProvider {
  if (!_selfAuthInstance) {
    _selfAuthInstance = new SelfAuthOAuthProvider(opts);
  }
  return _selfAuthInstance;
}

export function getSelfAuthProvider(): SelfAuthOAuthProvider | null {
  return _selfAuthInstance;
}
