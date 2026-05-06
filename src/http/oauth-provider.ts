import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { TokenStore } from './token-store.js';

export interface OktaConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
  authServerId: string;
  serverUrl: string;
}

export function loadOktaConfigFromEnv(): OktaConfig | null {
  const domain = process.env.OKTA_DOMAIN;
  const clientId = process.env.OKTA_CLIENT_ID;
  const clientSecret = process.env.OKTA_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) return null;

  return {
    domain,
    clientId,
    clientSecret,
    authServerId: process.env.OKTA_AUTH_SERVER_ID ?? 'default',
    serverUrl: process.env.MCP_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
  };
}

export interface BearerVerifierOptions {
  config: OktaConfig;
  tokenStore: TokenStore;
}

/**
 * Create a Bearer token verifier using Okta JWKS. Validates the JWT, then
 * resolves per-user Zebrunner credentials from TokenStore.
 *
 * Throws if no per-user credentials are found (the user must complete /login first).
 */
export function createOktaBearerVerifier(options: BearerVerifierOptions) {
  const { config, tokenStore } = options;
  const jwksUrl = new URL(
    `https://${config.domain}/oauth2/${config.authServerId}/v1/keys`,
  );
  const JWKS = createRemoteJWKSet(jwksUrl);

  return async (token: string): Promise<{ username: string; zebrunnerToken: string }> => {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${config.domain}/oauth2/${config.authServerId}`,
    });

    const email = (payload.email ?? payload.sub) as string | undefined;
    if (!email) {
      throw new Error('Okta token missing email/sub claim');
    }

    const stored = await tokenStore.get(email);
    if (!stored) {
      throw new Error(
        `No Zebrunner credentials found for ${email}. ` +
        'Please complete the Zebrunner credential setup at /login.',
      );
    }

    return { username: stored.username, zebrunnerToken: stored.token };
  };
}
