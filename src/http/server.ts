import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IncomingMessage } from 'node:http';
import { requestContext } from './request-context.js';
import { createAuthMiddleware, type BearerVerifier } from './auth-middleware.js';
import { resolveAuthMode, hasStrategy, hasTokenExchange } from '../config/transport.js';
import type { TokenStore } from './token-store.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';

const SESSION_IDLE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface HttpServerOptions {
  port: number;
  serverVersion: string;
  verifyBearer?: BearerVerifier;
  tokenStore?: TokenStore;
  zebrunnerBaseUrl?: string;
  oauthProvider?: OAuthServerProvider;
  mcpServerUrl?: string;
}

export async function startHttpServer(
  createServer: () => Promise<McpServer>,
  options: HttpServerOptions,
): Promise<void> {
  const { port, serverVersion, verifyBearer, tokenStore, zebrunnerBaseUrl, oauthProvider, mcpServerUrl } = options;
  const authMode = resolveAuthMode();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const needsOAuth = hasStrategy(authMode, 'selfauth') || hasStrategy(authMode, 'okta');

  // --- OAuth Authorization Server routes (when oauth mode with provider) ---
  if (needsOAuth && oauthProvider) {
    const { mcpAuthRouter } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
    const issuerUrl = new URL(mcpServerUrl || `http://localhost:${port}`);
    const resourceServerUrl = new URL(`${issuerUrl.href.replace(/\/+$/, '')}/mcp`);

    app.use(mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl,
      resourceServerUrl,
      resourceName: 'Zebrunner MCP Server',
      scopesSupported: ['zebrunner:read', 'zebrunner:write'],
    }));

    // Mount Okta callback for Okta mode (with optional token exchange for Mode 5)
    if (hasStrategy(authMode, 'okta')) {
      const { createAuthCallbackRouter } = await import('./auth-callback.js');
      app.use(createAuthCallbackRouter({
        zebrunnerBaseUrl,
        enableTokenExchange: hasTokenExchange(authMode),
      }));
    }

    // Mount login routes (credential form) for both selfauth and okta modes
    if (zebrunnerBaseUrl) {
      const { createLoginRouter } = await import('./login-routes.js');
      app.use('/login', createLoginRouter({ zebrunnerBaseUrl }));
      console.error(`🔑 Login form available at /login`);
    }

    console.error(`🔐 OAuth endpoints mounted (mode: ${authMode})`);
  }

  // --- Health check (unauthenticated) ---
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: serverVersion,
      transport: 'streamablehttp',
      authMode,
      oauthEnabled: !!oauthProvider,
      tokenStoreEnabled: !!tokenStore,
      activeSessions: sessions.size,
    });
  });

  // --- Auth middleware for /mcp ---
  const mcpServerBase = (mcpServerUrl || `http://localhost:${port}`).replace(/\/+$/, '');
  const resourceMetadataUrl = needsOAuth
    ? `${mcpServerBase}/.well-known/oauth-protected-resource`
    : undefined;
  const authMw = createAuthMiddleware({ authMode, verifyBearer, resourceMetadataUrl });
  app.use('/mcp', authMw);

  // --- Per-session transport management ---
  interface SessionEntry {
    transport: StreamableHTTPServerTransport;
    server: McpServer;
    lastUsed: number;
  }
  const sessions = new Map<string, SessionEntry>();

  app.all('/mcp', async (req, res) => {
    const existingSessionId = req.headers['mcp-session-id'] as string | undefined;
    let entry = existingSessionId ? sessions.get(existingSessionId) : undefined;

    if (!entry) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          sessions.set(sid, entry!);
        },
      });

      const server = await createServer();
      entry = { transport, server, lastUsed: Date.now() };

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) sessions.delete(sid);
      };

      await server.connect(transport);
    }

    entry.lastUsed = Date.now();

    const { username, token } = req.auth!;
    await requestContext.run({ username, token }, async () => {
      await entry!.transport.handleRequest(req as unknown as IncomingMessage, res, req.body);
    });
  });

  // --- Session sweep ---
  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [sid, entry] of sessions) {
      if (now - entry.lastUsed > SESSION_IDLE_MS) {
        entry.transport.close().catch(() => {});
        sessions.delete(sid);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  // --- Start listening ---
  app.listen(port, '0.0.0.0', () => {
    console.error(`✅ MCP HTTP server listening on port ${port} (auth: ${authMode})`);
  });
}
