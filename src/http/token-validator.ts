import type { TokenStore } from './token-store.js';

const VALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Lightweight daily validation of stored Zebrunner tokens.
 *
 * On the first request of each day (per user), calls Zebrunner IAM
 * `POST /api/iam/v1/auth/refresh` to confirm the token is still valid.
 * If the token has been revoked or expired, deletes it from the store
 * and throws — forcing the user to re-authenticate.
 *
 * Shared by SelfAuthOAuthProvider (Mode 3) and McpOAuthServerProvider (Mode 4).
 */
export class TokenValidator {
  private lastValidated = new Map<string, number>();
  private iamUrl: string;
  private tokenStore: TokenStore;

  constructor(zebrunnerBaseUrl: string, tokenStore: TokenStore) {
    this.iamUrl = zebrunnerBaseUrl.replace(/\/api\/public\/v1\/?$/, '') + '/api/iam/v1/auth/refresh';
    this.tokenStore = tokenStore;
  }

  /**
   * Validate a user's stored Zebrunner token at most once per day.
   * Does nothing if last validation was < 24h ago.
   * Throws (and deletes token) if Zebrunner rejects it.
   */
  async validateOncePerDay(email: string, zebrunnerToken: string): Promise<void> {
    const now = Date.now();
    const last = this.lastValidated.get(email);
    if (last && now - last < VALIDATION_INTERVAL_MS) {
      return;
    }

    let resp: Response;
    try {
      resp = await fetch(this.iamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: zebrunnerToken }),
      });
    } catch {
      // Network error (DNS, timeout, unreachable) — skip validation silently.
      // Don't delete the token; Zebrunner might just be temporarily unavailable.
      return;
    }

    if (resp.ok) {
      this.lastValidated.set(email, now);
      return;
    }

    // Zebrunner explicitly rejected the token (401/403) — delete and force re-auth
    this.lastValidated.delete(email);
    await this.tokenStore.delete(email);
    throw new Error(
      `Zebrunner credentials for ${email} are no longer valid (IAM returned ${resp.status}). ` +
      'Your stored token has been removed. Please re-authenticate to enter fresh credentials.',
    );
  }

  /**
   * Remove a user's validation cache entry (e.g. when their token is manually deleted).
   */
  clearCache(email: string): void {
    this.lastValidated.delete(email.toLowerCase());
  }

  /**
   * Periodic cleanup — called by provider sweep() methods.
   */
  sweep(): void {
    const cutoff = Date.now() - VALIDATION_INTERVAL_MS;
    for (const [key, ts] of this.lastValidated) {
      if (ts < cutoff) this.lastValidated.delete(key);
    }
  }
}
