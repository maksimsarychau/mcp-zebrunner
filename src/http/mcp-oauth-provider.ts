import { randomUUID, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { TokenStore } from './token-store.js';
import { TokenValidator } from './token-validator.js';
import { resolveMcpOAuthClient } from './mcp-client-fallback-redirects.js';
import type { OktaConfig } from './oauth-provider.js';
import {
  InMemoryOAuthFlowStore,
  type OAuthFlowStore,
  type OAuthPendingAuth,
  type OAuthRegisteredClientRecord,
} from './oauth-flow-store.js';

// Re-export for convenience
export type { OktaConfig } from './oauth-provider.js';

interface IssuedCode extends Record<string, unknown> {
  oktaAccessToken: string;
  oktaIdToken?: string;
  mcpClientId: string;
  redirectUri: string;
  codeChallenge: string;
  createdAt: number;
}

/**
 * Custom OAuthServerProvider that delegates authentication to Okta
 * while acting as a full OAuth Authorization Server for MCP clients.
 */
export class McpOAuthServerProvider implements OAuthServerProvider {
  skipLocalPkceValidation = true;

  private flowStore: OAuthFlowStore;
  private oktaConfig: OktaConfig;
  tokenStore: TokenStore;
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private validator: TokenValidator;

  constructor(
    config: OktaConfig,
    tokenStore: TokenStore,
    zebrunnerBaseUrl: string,
    oauthFlowStore?: OAuthFlowStore,
  ) {
    this.flowStore = oauthFlowStore ?? new InMemoryOAuthFlowStore();
    this.oktaConfig = config;
    this.tokenStore = tokenStore;
    this.jwks = createRemoteJWKSet(
      new URL(`https://${config.domain}/oauth2/${config.authServerId}/v1/keys`),
    );
    this.validator = new TokenValidator(zebrunnerBaseUrl, tokenStore);

    const sweep = setInterval(() => { void this.sweep(); }, 60_000);
    sweep.unref();
  }

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

        return {
          ...registered,
          client_secret_expires_at: 0,
        } as any;
      },
    };
  }

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

  async challengeForAuthorizationCode(): Promise<string> {
    return '';
  }

  async exchangeAuthorizationCode(
    client: any,
    authorizationCode: string,
  ): Promise<any> {
    const issued = await this.flowStore.takeIssuedCode<IssuedCode>(authorizationCode);
    if (!issued) {
      throw new Error('Invalid or expired authorization code');
    }

    if (issued.mcpClientId !== client.client_id) {
      throw new Error('Authorization code was issued to a different client');
    }

    return {
      access_token: issued.oktaAccessToken,
      token_type: 'bearer',
      ...(issued.oktaIdToken && { id_token: issued.oktaIdToken }),
    };
  }

  async exchangeRefreshToken(): Promise<any> {
    throw new Error('Refresh tokens are not supported. Re-authenticate via OAuth flow.');
  }

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

  async getPendingAuth(stateKey: string): Promise<OAuthPendingAuth | null> {
    return this.flowStore.getPending(stateKey);
  }

  async deletePendingAuth(stateKey: string): Promise<void> {
    await this.flowStore.deletePending(stateKey);
  }

  async storeIssuedCode(code: string, data: IssuedCode): Promise<void> {
    await this.flowStore.setIssuedCode(code, data);
  }

  getOktaConfig(): OktaConfig {
    return this.oktaConfig;
  }

  private async sweep(): Promise<void> {
    await this.flowStore.sweepExpired();
    this.validator.sweep();
  }
}

let _providerInstance: McpOAuthServerProvider | null = null;

export function createMcpOAuthProvider(
  config: OktaConfig,
  tokenStore: TokenStore,
  zebrunnerBaseUrl: string,
  oauthFlowStore?: OAuthFlowStore,
): McpOAuthServerProvider {
  if (!_providerInstance) {
    _providerInstance = new McpOAuthServerProvider(config, tokenStore, zebrunnerBaseUrl, oauthFlowStore);
  }
  return _providerInstance;
}

export function getMcpOAuthProvider(): McpOAuthServerProvider | null {
  return _providerInstance;
}
