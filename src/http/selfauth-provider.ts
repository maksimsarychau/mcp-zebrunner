import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { TokenStore } from './token-store.js';
import { TokenValidator } from './token-validator.js';
import { resolveMcpOAuthClient } from './mcp-client-fallback-redirects.js';
import {
  InMemoryOAuthFlowStore,
  type OAuthFlowStore,
  type OAuthPendingAuth,
  type OAuthRegisteredClientRecord,
} from './oauth-flow-store.js';

interface IssuedCode extends Record<string, unknown> {
  email: string;
  mcpClientId: string;
  redirectUri: string;
  codeChallenge: string;
  createdAt: number;
}

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

  private flowStore: OAuthFlowStore;
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
    oauthFlowStore?: OAuthFlowStore;
  }) {
    this.flowStore = opts.oauthFlowStore ?? new InMemoryOAuthFlowStore();
    this.tokenStore = opts.tokenStore;
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.zebrunnerBaseUrl = opts.zebrunnerBaseUrl;
    this.jwtSecret = opts.jwtSecret;
    this.validator = new TokenValidator(opts.zebrunnerBaseUrl, opts.tokenStore);

    const sweep = setInterval(() => { void this.sweep(); }, 60_000);
    sweep.unref();
  }

  // ─── DCR ────────────────────────────────────────────────────────

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: async (clientId: string) => {
        const client = await resolveMcpOAuthClient(this.flowStore, clientId);
        return (client ?? undefined) as any;
      },
      registerClient: async (clientInfo: any) => {
        const clientId = `mcp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const authMethod = clientInfo.token_endpoint_auth_method || 'none';
        const needsSecret = authMethod !== 'none';

        const registered: OAuthRegisteredClientRecord = {
          client_id: clientId,
          ...(needsSecret && { client_secret: randomBytes(32).toString('hex') }),
          redirect_uris: clientInfo.redirect_uris || [],
          client_name: clientInfo.client_name,
          grant_types: clientInfo.grant_types || ['authorization_code'],
          response_types: clientInfo.response_types || ['code'],
          token_endpoint_auth_method: authMethod,
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };

        await this.flowStore.setClient(clientId, registered);
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

    await this.flowStore.setPending(stateKey, {
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
    const issued = await this.flowStore.takeIssuedCode<IssuedCode>(authorizationCode);
    if (!issued) throw new Error('Invalid or expired authorization code');
    if (issued.mcpClientId !== client.client_id) {
      throw new Error('Authorization code was issued to a different client');
    }

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

    await this.validator.validateOncePerDay(payload.email, stored.token, stored.zebrunnerUrl);

    return {
      token,
      clientId: payload.cid ?? 'unknown',
      scopes: ['zebrunner:read', 'zebrunner:write'],
      expiresAt: payload.exp,
      extra: {
        email: payload.email,
        username: stored.username,
        zebrunnerToken: stored.token,
        zebrunnerUrl: stored.zebrunnerUrl,
      },
    };
  }

  // ─── Methods used by login-routes.ts ───────────────────────────

  async getPendingAuth(stateKey: string): Promise<OAuthPendingAuth | null> {
    return this.flowStore.getPending(stateKey);
  }

  async deletePendingAuth(stateKey: string): Promise<void> {
    await this.flowStore.deletePending(stateKey);
  }

  async storeIssuedCode(code: string, data: IssuedCode): Promise<void> {
    await this.flowStore.setIssuedCode(code, data);
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

  private async sweep(): Promise<void> {
    await this.flowStore.sweepExpired();
    this.validator.sweep();
  }
}

let _selfAuthInstance: SelfAuthOAuthProvider | null = null;

export function createSelfAuthProvider(opts: {
  tokenStore: TokenStore;
  serverUrl: string;
  zebrunnerBaseUrl: string;
  jwtSecret: string;
  oauthFlowStore?: OAuthFlowStore;
}): SelfAuthOAuthProvider {
  if (!_selfAuthInstance) {
    _selfAuthInstance = new SelfAuthOAuthProvider(opts);
  }
  return _selfAuthInstance;
}

export function getSelfAuthProvider(): SelfAuthOAuthProvider | null {
  return _selfAuthInstance;
}
