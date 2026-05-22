import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import type { TokenStore } from './token-store.js';
import { normalizeZebrunnerUrl, toWebUrl } from './url-utils.js';

export interface ResetRouterOptions {
  tokenStore: TokenStore;
  zebrunnerBaseUrl?: string;
  zebrunnerUrlFromEnv: boolean;
}

const CONFIRM_TTL_MS = 5 * 60 * 1000;
const pendingConfirmations = new Map<string, { email: string; expiresAt: number }>();

function sweepExpired(): void {
  const now = Date.now();
  for (const [token, entry] of pendingConfirmations) {
    if (now > entry.expiresAt) pendingConfirmations.delete(token);
  }
}

/**
 * Public (unauthenticated) route for clearing stored credentials.
 * Useful when a user's token is revoked, expired, or their account was removed
 * and they can't authenticate to reach /settings.
 *
 * GET  /reset          -> renders the reset form
 * POST /reset          -> looks up user, shows confirmation page
 * POST /reset/confirm  -> deletes credentials after confirmation
 */
export function createResetRouter(opts: ResetRouterOptions): Router {
  const router = Router();
  const { tokenStore, zebrunnerBaseUrl, zebrunnerUrlFromEnv } = opts;

  router.get('/', (req: Request, res: Response) => {
    const success = req.query.success as string | undefined;
    const error = req.query.error as string | undefined;

    res.type('html').send(RESET_FORM_HTML({ zebrunnerUrlFromEnv, success, error }));
  });

  router.post('/', async (req: Request, res: Response) => {
    const { email, zebrunner_url } = req.body as {
      email?: string;
      zebrunner_url?: string;
    };

    if (!email?.trim()) {
      res.redirect('/reset?error=' + encodeURIComponent('Email or username is required.'));
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userKey = normalizedEmail.includes('@') ? normalizedEmail : `${normalizedEmail}@zebrunner`;

    const stored = await tokenStore.get(userKey);
    if (!stored) {
      res.redirect('/reset?error=' + encodeURIComponent('No stored credentials found for this email.'));
      return;
    }

    // In multi-tenant mode, verify the Zebrunner URL matches
    if (!zebrunnerUrlFromEnv && stored.zebrunnerUrl) {
      if (!zebrunner_url?.trim()) {
        res.redirect('/reset?error=' + encodeURIComponent('Zebrunner URL is required to identify your account.'));
        return;
      }
      let providedApiUrl: string;
      try {
        providedApiUrl = normalizeZebrunnerUrl(zebrunner_url);
      } catch (err: any) {
        res.redirect('/reset?error=' + encodeURIComponent(err.message));
        return;
      }
      if (providedApiUrl !== stored.zebrunnerUrl) {
        res.redirect('/reset?error=' + encodeURIComponent('The Zebrunner URL does not match the one stored for this account.'));
        return;
      }
    }

    sweepExpired();
    const confirmToken = randomBytes(16).toString('hex');
    pendingConfirmations.set(confirmToken, {
      email: userKey,
      expiresAt: Date.now() + CONFIRM_TTL_MS,
    });

    const instanceUrl = stored.zebrunnerUrl
      ? toWebUrl(stored.zebrunnerUrl)
      : (zebrunnerBaseUrl ? toWebUrl(zebrunnerBaseUrl) : '');

    res.type('html').send(CONFIRM_HTML({
      email: userKey,
      username: stored.username,
      instanceUrl,
      confirmToken,
    }));
  });

  router.post('/confirm', async (req: Request, res: Response) => {
    const { confirmation_token } = req.body as { confirmation_token?: string };

    if (!confirmation_token) {
      res.redirect('/reset?error=' + encodeURIComponent('Missing confirmation token. Please try again.'));
      return;
    }

    sweepExpired();
    const pending = pendingConfirmations.get(confirmation_token);
    if (!pending) {
      res.redirect('/reset?error=' + encodeURIComponent('Confirmation expired or invalid. Please try again.'));
      return;
    }

    pendingConfirmations.delete(confirmation_token);
    const deleted = await tokenStore.delete(pending.email);

    if (deleted) {
      res.redirect('/reset?success=' + encodeURIComponent(`Credentials for ${pending.email} have been removed. You will be prompted to log in again on next connection.`));
    } else {
      res.redirect('/reset?error=' + encodeURIComponent('Credentials were already removed.'));
    }
  });

  return router;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function RESET_FORM_HTML(opts: {
  zebrunnerUrlFromEnv: boolean;
  success?: string;
  error?: string;
}): string {
  const { zebrunnerUrlFromEnv, success, error } = opts;

  const successHtml = success
    ? `<div class="success">${escapeHtml(success)}</div>`
    : '';
  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : '';

  const urlFieldHtml = !zebrunnerUrlFromEnv
    ? `<label for="zebrunner_url">Zebrunner URL</label>
      <input id="zebrunner_url" name="zebrunner_url" type="url" placeholder="https://your-company.zebrunner.com" autocomplete="url">
      <div class="field-hint">The Zebrunner instance URL you used when logging in.</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Advanced Zebrunner MCP Server — Reset Credentials</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #1d1d1f; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 40px; max-width: 420px; width: 100%; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 6px; }
    .subtitle { color: #6e6e73; font-size: 0.9rem; margin-bottom: 24px; line-height: 1.5; }
    label { display: block; font-weight: 500; font-size: 0.85rem; margin-bottom: 4px; color: #1d1d1f; }
    input { width: 100%; padding: 10px 12px; font-size: 0.95rem; border-radius: 8px; border: 1px solid #d2d2d7; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
    input:focus { border-color: #d97706; box-shadow: 0 0 0 3px rgba(217,119,6,0.15); }
    button { width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: background 0.2s; }
    .btn-warning { background: #d97706; color: #fff; }
    .btn-warning:hover { background: #b45309; }
    .error { background: #fef2f2; color: #991b1b; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 16px; border: 1px solid #fecaca; }
    .success { background: #f0fdf4; color: #166534; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 16px; border: 1px solid #bbf7d0; }
    .field-hint { font-size: 0.75rem; color: #6e6e73; margin: -12px 0 16px 0; }
    .help { margin-top: 16px; font-size: 0.8rem; color: #6e6e73; line-height: 1.5; }
    .help a { color: #0071e3; text-decoration: none; }
    .help a:hover { text-decoration: underline; }
    .warn-icon { font-size: 2rem; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="warn-icon">&#9888;</div>
    <h1>Reset Credentials</h1>
    <p class="subtitle">Clear your stored Zebrunner credentials. Use this if your token was revoked, expired, or you need to re-authenticate.</p>
    ${successHtml}
    ${errorHtml}
    <form method="POST" action="/reset">
      ${urlFieldHtml}
      <label for="email">Email or username</label>
      <input id="email" name="email" type="text" required placeholder="your.name@company.com" autocomplete="username">
      <button type="submit" class="btn-warning">Find &amp; Reset Credentials</button>
    </form>
    <div class="help">
      This only removes your stored credentials on this MCP server.<br>
      Your Zebrunner account is not affected.<br>
      <a href="/login">Back to login</a>
    </div>
  </div>
</body>
</html>`;
}

function CONFIRM_HTML(opts: {
  email: string;
  username: string;
  instanceUrl: string;
  confirmToken: string;
}): string {
  const { email, username, instanceUrl, confirmToken } = opts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Advanced Zebrunner MCP Server — Confirm Reset</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f7; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #1d1d1f; }
    .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); padding: 40px; max-width: 420px; width: 100%; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 6px; }
    .subtitle { color: #6e6e73; font-size: 0.9rem; margin-bottom: 24px; line-height: 1.5; }
    .info-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 20px; font-size: 0.85rem; line-height: 1.6; }
    .info-box strong { color: #92400e; }
    button { width: 100%; padding: 12px; font-size: 1rem; font-weight: 600; border-radius: 10px; border: none; cursor: pointer; transition: background 0.2s; margin-bottom: 8px; }
    .btn-danger { background: #dc2626; color: #fff; }
    .btn-danger:hover { background: #b91c1c; }
    .btn-cancel { background: #fff; color: #1d1d1f; border: 1px solid #d2d2d7; }
    .btn-cancel:hover { background: #f5f5f7; }
    .warn-icon { font-size: 2rem; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="warn-icon">&#9888;</div>
    <h1>Confirm Reset</h1>
    <p class="subtitle">Are you sure you want to remove these stored credentials?</p>
    <div class="info-box">
      <strong>Account:</strong> ${escapeHtml(email)}<br>
      <strong>Username:</strong> ${escapeHtml(username)}<br>
      ${instanceUrl ? `<strong>Instance:</strong> ${escapeHtml(instanceUrl)}<br>` : ''}
    </div>
    <form method="POST" action="/reset/confirm">
      <input type="hidden" name="confirmation_token" value="${escapeHtml(confirmToken)}">
      <button type="submit" class="btn-danger">Yes, Remove Credentials</button>
    </form>
    <form action="/reset" method="GET" style="margin-top: 0;">
      <button type="submit" class="btn-cancel">Cancel</button>
    </form>
  </div>
</body>
</html>`;
}
