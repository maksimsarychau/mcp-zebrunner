import { Router, type Request, type Response } from 'express';
import type { TokenStore } from './token-store.js';
import { normalizeZebrunnerUrl, toWebUrl } from './url-utils.js';

export interface SettingsRouterOptions {
  tokenStore: TokenStore;
  zebrunnerBaseUrl?: string;
  zebrunnerUrlFromEnv: boolean;
}

/**
 * Authenticated settings page where users can view / update / disconnect
 * their stored Zebrunner credentials.
 *
 * GET  /settings?email=...  -> renders the form pre-populated with current data
 * POST /settings            -> validates and updates credentials
 * POST /settings/disconnect -> deletes stored credentials
 */
export function createSettingsRouter(opts: SettingsRouterOptions): Router {
  const router = Router();
  const { tokenStore, zebrunnerBaseUrl, zebrunnerUrlFromEnv } = opts;

  router.get('/', async (req: Request, res: Response) => {
    const email = req.query.email as string | undefined;
    const success = req.query.success as string | undefined;
    const error = req.query.error as string | undefined;

    if (!email) {
      res.status(400).send('Missing email parameter.');
      return;
    }

    const stored = await tokenStore.get(email);
    if (!stored) {
      res.status(404).send('No stored credentials for this user. Please log in first.');
      return;
    }

    const currentUrl = stored.zebrunnerUrl ?? zebrunnerBaseUrl ?? '';
    const maskedToken = stored.token.length > 8
      ? `${stored.token.slice(0, 4)}..${stored.token.slice(-4)}`
      : '****';

    res.type('html').send(SETTINGS_HTML({
      email,
      username: stored.username,
      maskedToken,
      zebrunnerUrl: currentUrl ? toWebUrl(currentUrl) : '',
      zebrunnerUrlFromEnv,
      success,
      error,
    }));
  });

  router.post('/', async (req: Request, res: Response) => {
    const { email, username, token, zebrunner_url } = req.body as {
      email?: string;
      username?: string;
      token?: string;
      zebrunner_url?: string;
    };

    if (!email) {
      res.status(400).send('Missing email');
      return;
    }

    const stored = await tokenStore.get(email);
    if (!stored) {
      res.redirect(`/settings?email=${encodeURIComponent(email)}&error=${encodeURIComponent('No stored credentials found. Please log in first.')}`);
      return;
    }

    const newUsername = username?.trim() || stored.username;
    const newToken = token?.trim() || stored.token;

    let newUrl = stored.zebrunnerUrl;
    if (!zebrunnerUrlFromEnv && zebrunner_url?.trim()) {
      try {
        newUrl = normalizeZebrunnerUrl(zebrunner_url);
      } catch (err: any) {
        res.redirect(`/settings?email=${encodeURIComponent(email)}&error=${encodeURIComponent(err.message)}`);
        return;
      }
    }

    // Validate new token against IAM if token was changed
    if (newToken !== stored.token) {
      const iamBase = (newUrl ?? zebrunnerBaseUrl ?? '').replace(/\/api\/public\/v1\/?$/, '');
      if (!iamBase) {
        res.redirect(`/settings?email=${encodeURIComponent(email)}&error=${encodeURIComponent('Zebrunner URL is required to validate token')}`);
        return;
      }
      try {
        const resp = await fetch(`${iamBase}/api/iam/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: newToken }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) {
          res.redirect(`/settings?email=${encodeURIComponent(email)}&error=${encodeURIComponent('Invalid API token. Please check and try again.')}`);
          return;
        }
      } catch {
        res.redirect(`/settings?email=${encodeURIComponent(email)}&error=${encodeURIComponent('Could not connect to Zebrunner to validate token.')}`);
        return;
      }
    }

    await tokenStore.set(email, {
      username: newUsername,
      token: newToken,
      ...(zebrunnerUrlFromEnv ? {} : { zebrunnerUrl: newUrl }),
    });

    res.redirect(`/settings?email=${encodeURIComponent(email)}&success=${encodeURIComponent('Credentials updated successfully.')}`);
  });

  router.post('/disconnect', async (req: Request, res: Response) => {
    const { email } = req.body as { email?: string };
    if (!email) {
      res.status(400).send('Missing email');
      return;
    }

    await tokenStore.delete(email);
    res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Disconnected</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f7;display:flex;justify-content:center;align-items:center;min-height:100vh;color:#1d1d1f}
  .card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:40px;max-width:420px;width:100%;text-align:center}
  h1{font-size:1.3rem;margin-bottom:12px}
  p{color:#6e6e73;font-size:.9rem;line-height:1.5}
</style></head><body><div class="card">
<h1>Disconnected</h1>
<p>Your Zebrunner credentials have been removed. Close this window and reconnect from your MCP client to log in again.</p>
</div></body></html>`);
  });

  return router;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function SETTINGS_HTML(opts: {
  email: string;
  username: string;
  maskedToken: string;
  zebrunnerUrl: string;
  zebrunnerUrlFromEnv: boolean;
  success?: string;
  error?: string;
}): string {
  const { email, username, maskedToken, zebrunnerUrl, zebrunnerUrlFromEnv, success, error } = opts;

  const showUrlField = !zebrunnerUrlFromEnv;
  const successHtml = success
    ? `<div class="success">${escapeHtml(success)}</div>`
    : '';
  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : '';

  const urlFieldHtml = showUrlField
    ? `<label for="zebrunner_url">Zebrunner URL</label>
      <input id="zebrunner_url" name="zebrunner_url" type="url" placeholder="https://your-company.zebrunner.com" value="${escapeHtml(zebrunnerUrl)}">
      <div class="field-hint">Leave unchanged to keep your current Zebrunner instance.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Zebrunner MCP — Settings</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #1d1d1f; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 40px; max-width: 420px; width: 100%; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 6px; }
    .subtitle { color: #6e6e73; font-size: 0.9rem; margin-bottom: 24px; line-height: 1.5; }
    label { display: block; font-weight: 500; font-size: 0.85rem; margin-bottom: 4px; color: #1d1d1f; }
    input { width: 100%; padding: 10px 12px; font-size: 0.95rem; border-radius: 8px; border: 1px solid #d2d2d7; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #0071e3; box-shadow: 0 0 0 3px rgba(0,113,227,0.15); }
    button { width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: background 0.2s; margin-bottom: 8px; }
    .btn-primary { background: #0071e3; color: #fff; }
    .btn-primary:hover { background: #0077ed; }
    .btn-danger { background: #fff; color: #dc2626; border: 1px solid #fecaca; }
    .btn-danger:hover { background: #fef2f2; }
    .error { background: #fef2f2; color: #991b1b; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 16px; border: 1px solid #fecaca; }
    .success { background: #f0fdf4; color: #166534; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 16px; border: 1px solid #bbf7d0; }
    .field-hint { font-size: 0.75rem; color: #6e6e73; margin: -12px 0 16px 0; }
    .current-info { font-size: 0.8rem; color: #6e6e73; margin-bottom: 24px; padding: 12px; background: #f5f5f7; border-radius: 8px; line-height: 1.6; }
    .current-info strong { color: #1d1d1f; }
    .separator { border: none; border-top: 1px solid #e5e5ea; margin: 16px 0; }
    .gear-icon { font-size: 2rem; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="gear-icon">&#9881;</div>
    <h1>Settings</h1>
    <p class="subtitle">Update your Zebrunner connection details or disconnect.</p>
    ${successHtml}
    ${errorHtml}
    <div class="current-info">
      <strong>Current connection</strong><br>
      User: ${escapeHtml(username)}<br>
      Token: ${escapeHtml(maskedToken)}<br>
      ${zebrunnerUrl ? `Instance: ${escapeHtml(zebrunnerUrl)}` : ''}
    </div>
    <form method="POST" action="/settings">
      <input type="hidden" name="email" value="${escapeHtml(email)}">
      ${urlFieldHtml}
      <label for="username">Username or email</label>
      <input id="username" name="username" type="text" placeholder="Leave blank to keep current" value="${escapeHtml(username)}">
      <label for="token">New API token</label>
      <input id="token" name="token" type="password" placeholder="Enter new token to change" autocomplete="off">
      <div class="field-hint">Leave blank to keep your current token.</div>
      <button type="submit" class="btn-primary">Update</button>
    </form>
    <hr class="separator">
    <form method="POST" action="/settings/disconnect">
      <input type="hidden" name="email" value="${escapeHtml(email)}">
      <button type="submit" class="btn-danger" onclick="return confirm('This will remove your stored credentials. You will need to log in again.')">Disconnect</button>
    </form>
  </div>
</body>
</html>`;
}
