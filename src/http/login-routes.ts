import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { getSelfAuthProvider } from './selfauth-provider.js';
import { getMcpOAuthProvider } from './mcp-oauth-provider.js';

/**
 * Express router serving the Zebrunner credential collection form.
 *
 * Used by:
 *  - Mode 3 (selfauth): as the "authorize" destination after OAuth discovery
 *  - Mode 4 (okta): when Okta login succeeds but no Zebrunner creds are stored
 *
 * GET  /login?state=...          → renders the credential form
 * POST /login                    → validates creds via Zebrunner IAM, stores, redirects
 */
export function createLoginRouter(opts: { zebrunnerBaseUrl: string }): Router {
  const router = Router();
  const { zebrunnerBaseUrl } = opts;

  router.get('/', (req: Request, res: Response) => {
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;
    const email = req.query.email as string | undefined;
    const oktaAccessToken = req.query.okta_access_token as string | undefined;
    const oktaIdToken = req.query.okta_id_token as string | undefined;
    if (!state) {
      res.status(400).send('Missing state parameter. Please restart the login flow from your MCP client.');
      return;
    }
    res.type('html').send(LOGIN_HTML(zebrunnerBaseUrl, state, error, email, oktaAccessToken, oktaIdToken));
  });

  router.post('/', async (req: Request, res: Response) => {
    const { username, token, state, okta_access_token, okta_id_token } = req.body as {
      username?: string;
      token?: string;
      state?: string;
      okta_access_token?: string;
      okta_id_token?: string;
    };

    if (!username || !token || !state) {
      res.redirect(`/login?state=${state ?? ''}&error=${encodeURIComponent('Username and API token are required')}`);
      return;
    }

    // Try self-auth provider first (Mode 3), then Okta provider (Mode 4)
    const selfAuth = getSelfAuthProvider();
    const oktaAuth = getMcpOAuthProvider();
    const provider = selfAuth ?? oktaAuth;

    if (!provider) {
      res.status(500).send('No OAuth provider configured');
      return;
    }

    const pending = provider.getPendingAuth(state);
    if (!pending) {
      res.status(400).send('Invalid or expired state. Please restart the login flow from your MCP client.');
      return;
    }

    try {
      // Validate credentials against Zebrunner IAM
      const iamBase = zebrunnerBaseUrl.replace(/\/api\/public\/v1\/?$/, '');
      const authResp = await fetch(`${iamBase}/api/iam/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: token }),
      });

      if (!authResp.ok) {
        res.redirect(
          `/login?state=${state}` +
          `&email=${encodeURIComponent(username)}` +
          `${okta_access_token ? `&okta_access_token=${encodeURIComponent(okta_access_token)}` : ''}` +
          `${okta_id_token ? `&okta_id_token=${encodeURIComponent(okta_id_token)}` : ''}` +
          `&error=${encodeURIComponent('Invalid API token. Please check your credentials and try again.')}`,
        );
        return;
      }

      // Extract username from Zebrunner JWT response and verify ownership
      const authData = (await authResp.json()) as { authToken: string };
      const jwt = authData.authToken;
      const payload = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'),
      );
      const zebrunnerUsername: string = payload.unm ?? payload.username ?? username;

      const enteredNorm = username.toLowerCase().trim();
      const tokenOwnerNorm = zebrunnerUsername.toLowerCase().trim();
      if (
        tokenOwnerNorm !== enteredNorm &&
        !enteredNorm.startsWith(tokenOwnerNorm) &&
        !tokenOwnerNorm.startsWith(enteredNorm)
      ) {
        res.redirect(
          `/login?state=${state}` +
          `&email=${encodeURIComponent(username)}` +
          `${okta_access_token ? `&okta_access_token=${encodeURIComponent(okta_access_token)}` : ''}` +
          `${okta_id_token ? `&okta_id_token=${encodeURIComponent(okta_id_token)}` : ''}` +
          `&error=${encodeURIComponent(`This API token belongs to "${zebrunnerUsername}", not "${username}". Please use your own API token.`)}`,
        );
        return;
      }

      // Determine which TokenStore to use
      const tokenStore = selfAuth
        ? selfAuth.getTokenStore()
        : (oktaAuth as any)?.tokenStore;

      if (!tokenStore) {
        res.status(500).send('Token store not configured');
        return;
      }

      // Store per-user credentials (keyed by username-as-email for selfauth)
      const userKey = username.includes('@') ? username : `${username}@zebrunner`;
      await tokenStore.set(userKey, { username: zebrunnerUsername, token });

      // Generate authorization code and redirect back to MCP client
      const ourCode = randomBytes(32).toString('hex');
      provider.storeIssuedCode(ourCode, {
        ...(selfAuth
          ? { email: userKey }
          : { oktaAccessToken: okta_access_token ?? '', oktaIdToken: okta_id_token }),
        mcpClientId: pending.mcpClientId,
        redirectUri: pending.redirectUri,
        codeChallenge: pending.codeChallenge,
        createdAt: Date.now(),
      } as any);

      provider.deletePendingAuth(state);

      const clientRedirect = new URL(pending.redirectUri);
      clientRedirect.searchParams.set('code', ourCode);
      if (pending.state) {
        clientRedirect.searchParams.set('state', pending.state);
      }

      res.redirect(clientRedirect.toString());
    } catch (err: any) {
      console.error('[login-routes] Error:', err.message);
      res.redirect(
        `/login?state=${state}&error=${encodeURIComponent(`Validation failed: ${err.message}`)}`,
      );
    }
  });

  return router;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function LOGIN_HTML(
  zebrunnerBaseUrl: string,
  state: string,
  error?: string,
  email?: string,
  oktaAccessToken?: string,
  oktaIdToken?: string,
): string {
  const profileUrl = zebrunnerBaseUrl.replace(/\/api\/public\/v1\/?$/, '') + '/account/profile';
  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : '';
  const emailValue = email ? escapeHtml(email) : '';
  const oktaHiddenFields = oktaAccessToken
    ? `<input type="hidden" name="okta_access_token" value="${escapeHtml(oktaAccessToken)}">`
      + (oktaIdToken ? `<input type="hidden" name="okta_id_token" value="${escapeHtml(oktaIdToken)}">` : '')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zebrunner MCP — Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #1d1d1f; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 40px; max-width: 420px; width: 100%; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 6px; }
    .subtitle { color: #6e6e73; font-size: 0.9rem; margin-bottom: 24px; line-height: 1.5; }
    label { display: block; font-weight: 500; font-size: 0.85rem; margin-bottom: 4px; color: #1d1d1f; }
    input { width: 100%; padding: 10px 12px; font-size: 0.95rem; border-radius: 8px; border: 1px solid #d2d2d7; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #0071e3; box-shadow: 0 0 0 3px rgba(0,113,227,0.15); }
    input.prefilled { background: #f5f5f7; color: #6e6e73; cursor: not-allowed; }
    button { width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; border-radius: 10px; border: none; background: #0071e3; color: #fff; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #0077ed; }
    .help { margin-top: 16px; font-size: 0.8rem; color: #6e6e73; line-height: 1.5; }
    .help a { color: #0071e3; text-decoration: none; }
    .help a:hover { text-decoration: underline; }
    .error { background: #fef2f2; color: #991b1b; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 16px; border: 1px solid #fecaca; }
    .lock-icon { font-size: 2rem; margin-bottom: 12px; }
    .okta-badge { display: inline-block; background: #e8f0fe; color: #1967d2; font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 4px; margin-left: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="lock-icon">&#128274;</div>
    <h1>Connect to Zebrunner${email ? '<span class="okta-badge">Okta verified</span>' : ''}</h1>
    <p class="subtitle">${email
      ? 'You\'re signed in via Okta. Enter your Zebrunner API token to complete the setup.'
      : 'Enter your Zebrunner credentials to connect your MCP client. This is a one-time setup — your credentials will be stored securely.'}</p>
    ${errorHtml}
    <form method="POST" action="/login">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      ${oktaHiddenFields}
      <label for="username">Username or email</label>
      <input id="username" name="username" type="${oktaAccessToken ? 'text' : 'text'}" required placeholder="your.name@company.com" autocomplete="username" value="${emailValue}"${oktaAccessToken ? ' readonly class="prefilled"' : ''}>
      <label for="token">API token</label>
      <input id="token" name="token" type="password" required placeholder="Paste your Zebrunner API token" autocomplete="off"${email ? ' autofocus' : ''}>
      <button type="submit">Connect</button>
    </form>
    <div class="help">
      Get your API token from <a href="${profileUrl}" target="_blank">Zebrunner Profile &rarr; API Tokens</a>.<br>
      Your credentials are encrypted and stored on the server. They are never shared.
    </div>
  </div>
</body>
</html>`;
}
