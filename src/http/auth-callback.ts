import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { getMcpOAuthProvider } from './mcp-oauth-provider.js';

function decodeJwtPayload(token: string): Record<string, any> {
  const parts = token.split('.');
  if (parts.length < 2) return {};
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/**
 * Express router that handles the Okta OAuth callback.
 *
 * Flow:
 * 1. Okta redirects here after user authenticates (with Duo MFA if configured)
 * 2. We exchange Okta's authorization code for tokens using our OIDC app credentials
 * 3. We check if the user already has Zebrunner credentials in the token store
 * 4a. If YES → generate auth code and redirect to MCP client
 * 4b. If NO  → redirect to /login form (email pre-filled from Okta) to collect Zebrunner creds
 */
export function createAuthCallbackRouter(): Router {
  const router = Router();

  router.get('/auth/callback', async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string>;

    if (error) {
      res.status(400).json({
        error: 'oauth_error',
        message: error_description || error,
      });
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    const provider = getMcpOAuthProvider();
    if (!provider) {
      res.status(500).json({ error: 'OAuth provider not configured' });
      return;
    }

    const pending = provider.getPendingAuth(state);
    if (!pending) {
      res.status(400).json({ error: 'Invalid or expired state parameter. Please restart the login flow.' });
      return;
    }

    try {
      const oktaConfig = provider.getOktaConfig();

      // Exchange Okta's authorization code for tokens
      const tokenResponse = await fetch(
        `https://${oktaConfig.domain}/oauth2/${oktaConfig.authServerId}/v1/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: oktaConfig.clientId,
            client_secret: oktaConfig.clientSecret,
            code,
            redirect_uri: `${oktaConfig.serverUrl}/auth/callback`,
          }).toString(),
        },
      );

      if (!tokenResponse.ok) {
        const errBody = await tokenResponse.text();
        console.error('[auth-callback] Okta token exchange failed:', errBody);
        res.status(502).json({ error: 'Failed to exchange code with Okta' });
        return;
      }

      const oktaTokens = (await tokenResponse.json()) as {
        access_token: string;
        id_token?: string;
        token_type: string;
        expires_in: number;
      };

      // Extract user email from Okta tokens (prefer id_token, fall back to access_token)
      const idPayload = oktaTokens.id_token ? decodeJwtPayload(oktaTokens.id_token) : {};
      const atPayload = decodeJwtPayload(oktaTokens.access_token);
      const email = (idPayload.email ?? atPayload.email ?? atPayload.sub) as string | undefined;

      // Check if user already has Zebrunner credentials stored
      const tokenStore = provider.tokenStore;
      const stored = email ? await tokenStore.get(email) : null;

      if (!stored) {
        // No Zebrunner credentials — redirect to /login form to collect them.
        // Keep the pending auth alive (don't delete it) so /login POST can complete the flow.
        const loginUrl = new URL('/login', oktaConfig.serverUrl || `http://localhost:${req.socket.localPort}`);
        loginUrl.searchParams.set('state', state);
        if (email) loginUrl.searchParams.set('email', email);
        loginUrl.searchParams.set('okta_access_token', oktaTokens.access_token);
        if (oktaTokens.id_token) loginUrl.searchParams.set('okta_id_token', oktaTokens.id_token);

        console.error(`[auth-callback] No Zebrunner creds for ${email ?? 'unknown'}, redirecting to /login`);
        res.redirect(loginUrl.toString());
        return;
      }

      // User has stored creds — issue auth code and redirect to MCP client
      const ourCode = randomBytes(32).toString('hex');

      provider.storeIssuedCode(ourCode, {
        oktaAccessToken: oktaTokens.access_token,
        oktaIdToken: oktaTokens.id_token,
        mcpClientId: pending.mcpClientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        createdAt: Date.now(),
      });

      provider.deletePendingAuth(state);

      const clientRedirect = new URL(pending.redirectUri);
      clientRedirect.searchParams.set('code', ourCode);
      if (pending.state) {
        clientRedirect.searchParams.set('state', pending.state);
      }

      console.error(`[auth-callback] Zebrunner creds found for ${email}, redirecting to client`);
      res.redirect(clientRedirect.toString());
    } catch (err: any) {
      console.error('[auth-callback] Error:', err.message);
      res.status(500).json({ error: 'Authentication callback failed' });
    }
  });

  return router;
}
