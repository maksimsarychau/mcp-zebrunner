import type { Request, Response, NextFunction } from 'express';
import type { AuthMode } from '../config/transport.js';
import { hasStrategy } from '../config/transport.js';

export interface AuthResult {
  method: 'headers' | 'bearer';
  username: string;
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthResult;
    }
  }
}

function extractHeaderAuth(req: Request): AuthResult | null {
  const username = (
    req.headers['x-zebrunner-username'] ??
    req.headers['x-zebrunner-api-username']
  ) as string | undefined;

  const token = (
    req.headers['x-zebrunner-api-token'] ??
    req.headers['x-zebrunner-token']
  ) as string | undefined;

  if (username && token) {
    return { method: 'headers', username, token };
  }
  return null;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7);
}

export type BearerVerifier = (token: string) => Promise<{ username: string; zebrunnerToken: string }>;

export interface AuthMiddlewareOptions {
  authMode?: AuthMode;
  verifyBearer?: BearerVerifier;
  resourceMetadataUrl?: string;
}

/**
 * Express middleware that authenticates via Zebrunner-compatible custom headers
 * and/or an OAuth Bearer token, depending on authMode. Populates req.auth on success.
 *
 * Strategies:
 *  - "headers"  → only X-Zebrunner-* headers
 *  - "selfauth" → only Bearer tokens (self-service OAuth)
 *  - "okta"     → only Bearer tokens (Okta OAuth)
 *  - "headers,selfauth" / "headers,okta" → try headers first, then Bearer
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions = {}) {
  const mode = options.authMode ?? 'headers';
  const allowHeaders = hasStrategy(mode, 'headers');
  const allowBearer = hasStrategy(mode, 'selfauth') || hasStrategy(mode, 'okta');

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (allowHeaders) {
      const headerResult = extractHeaderAuth(req);
      if (headerResult) {
        req.auth = headerResult;
        next();
        return;
      }
    }

    if (allowBearer && options.verifyBearer) {
      const bearerToken = extractBearerToken(req);
      if (bearerToken) {
        try {
          const { username, zebrunnerToken } = await options.verifyBearer(bearerToken);
          req.auth = { method: 'bearer', username, token: zebrunnerToken };
          next();
          return;
        } catch {
          res.status(401).json({ error: 'Invalid or expired Bearer token' });
          return;
        }
      }
    }

    const hints: string[] = [];
    if (allowHeaders) hints.push('X-Zebrunner-Username + X-Zebrunner-Api-Token headers');
    if (allowBearer) hints.push('Authorization: Bearer <token>');

    if (allowBearer && options.resourceMetadataUrl) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${options.resourceMetadataUrl}"`);
    }

    res.status(401).json({
      error: 'Authentication required',
      hint: `Provide ${hints.join(', or ')}`,
    });
  };
}
