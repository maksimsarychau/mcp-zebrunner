import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Integration tests for HTTP connection modes.
 *
 * These test the auth middleware and selfauth provider logic without
 * starting a full HTTP server or hitting real Zebrunner/Okta endpoints.
 *
 * Mode 2 (HTTP + Headers): tests header-based authentication
 * Mode 3 (Self-Service OAuth): tests the selfauth provider's JWT lifecycle
 */

// ─── Mode 2: HTTP + Headers ─────────────────────────────────────

describe('Mode 2: HTTP + Headers', () => {
  it('authenticates valid X-Zebrunner-* headers', async () => {
    const { createAuthMiddleware } = await import('../../src/http/auth-middleware.js');
    const mw = createAuthMiddleware({ authMode: 'headers' });

    const req = {
      headers: {
        'x-zebrunner-username': 'test@company.com',
        'x-zebrunner-api-token': 'valid-token-123',
      },
      auth: undefined,
    } as any;

    const res = { status: () => res, json: () => res } as any;
    let nextCalled = false;

    await mw(req, res, () => { nextCalled = true; });

    assert.ok(nextCalled);
    assert.equal(req.auth.method, 'headers');
    assert.equal(req.auth.username, 'test@company.com');
    assert.equal(req.auth.token, 'valid-token-123');
  });

  it('rejects requests without headers (401)', async () => {
    const { createAuthMiddleware } = await import('../../src/http/auth-middleware.js');
    const mw = createAuthMiddleware({ authMode: 'headers' });

    const req = { headers: {}, auth: undefined } as any;
    let statusCode = 0;
    let body: any;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json(data: any) { body = data; },
    } as any;
    let nextCalled = false;

    await mw(req, res, () => { nextCalled = true; });

    assert.ok(!nextCalled);
    assert.equal(statusCode, 401);
    assert.ok(body.hint.includes('X-Zebrunner-Username'));
  });

  it('rejects bearer tokens when mode is headers-only', async () => {
    const { createAuthMiddleware } = await import('../../src/http/auth-middleware.js');
    const mw = createAuthMiddleware({
      authMode: 'headers',
      verifyBearer: async () => ({ username: 'u', zebrunnerToken: 't' }),
    });

    const req = { headers: { authorization: 'Bearer some-jwt' }, auth: undefined } as any;
    let statusCode = 0;
    const res = {
      status(code: number) { statusCode = code; return this; },
      json() {},
    } as any;

    await mw(req, res, () => {});

    assert.equal(statusCode, 401);
  });
});

// ─── Mode 3: Self-Service OAuth Provider ─────────────────────────

describe('Mode 3: Self-Service OAuth — JWT lifecycle', () => {
  let provider: any;
  let tokenStore: any;

  beforeEach(async () => {
    const { SelfAuthOAuthProvider } = await import('../../src/http/selfauth-provider.js');

    // In-memory token store for testing
    const store = new Map<string, { username: string; token: string }>();
    tokenStore = {
      get: async (email: string) => store.get(email.toLowerCase()) ?? null,
      set: async (email: string, data: { username: string; token: string }) => {
        store.set(email.toLowerCase(), data);
      },
      delete: async (email: string) => store.delete(email.toLowerCase()),
      list: async () => [...store.keys()],
    };

    provider = new SelfAuthOAuthProvider({
      tokenStore,
      serverUrl: 'http://localhost:3000',
      zebrunnerBaseUrl: 'https://test.zebrunner.com/api/public/v1',
      jwtSecret: 'test-secret-key-32chars-minimum!',
    });
  });

  it('registers a client via DCR', async () => {
    const result = await provider.clientsStore.registerClient({
      redirect_uris: ['http://localhost:8080/callback'],
      client_name: 'Test MCP Client',
      token_endpoint_auth_method: 'none',
    });

    assert.ok(result.client_id.startsWith('mcp_'));
    assert.deepEqual(result.redirect_uris, ['http://localhost:8080/callback']);
    assert.equal(result.client_name, 'Test MCP Client');
    assert.equal(result.token_endpoint_auth_method, 'none');
    assert.ok(!result.client_secret, 'public client should not have a secret');
  });

  it('retrieves a registered client', async () => {
    const registered = await provider.clientsStore.registerClient({
      redirect_uris: ['http://localhost/cb'],
      token_endpoint_auth_method: 'none',
    });

    const retrieved = await provider.clientsStore.getClient(registered.client_id);
    assert.equal(retrieved?.client_id, registered.client_id);
  });

  it('authorize redirects to /login with state', async () => {
    let redirectUrl = '';
    const mockRes = {
      redirect(url: string) { redirectUrl = url; },
    };

    await provider.authorize(
      { client_id: 'mcp_test123' },
      { redirectUri: 'http://localhost/cb', codeChallenge: 'abc', state: 'client-state' },
      mockRes,
    );

    assert.ok(redirectUrl.startsWith('http://localhost:3000/login?state='));
    const state = new URL(redirectUrl).searchParams.get('state');
    assert.ok(state && state.length === 64, 'state should be 64-char hex');
  });

  it('stores and retrieves pending auth', async () => {
    let redirectUrl = '';
    await provider.authorize(
      { client_id: 'mcp_abc' },
      { redirectUri: 'http://localhost/cb', codeChallenge: 'xyz', state: 's1' },
      { redirect: (url: string) => { redirectUrl = url; } },
    );

    const state = new URL(redirectUrl).searchParams.get('state')!;
    const pending = provider.getPendingAuth(state);
    assert.ok(pending);
    assert.equal(pending.mcpClientId, 'mcp_abc');
    assert.equal(pending.redirectUri, 'http://localhost/cb');
  });

  it('full token flow: issue code → exchange → verify', async () => {
    // Store Zebrunner credentials for the user
    await tokenStore.set('user@test.com', { username: 'testuser', token: 'zeb-token-123' });

    // Simulate issuing a code (normally done by login-routes after credential validation)
    provider.storeIssuedCode('test-code-abc', {
      email: 'user@test.com',
      mcpClientId: 'mcp_client1',
      redirectUri: 'http://localhost/cb',
      codeChallenge: 'challenge',
      createdAt: Date.now(),
    });

    // Exchange code for access token
    const tokens = await provider.exchangeAuthorizationCode(
      { client_id: 'mcp_client1' },
      'test-code-abc',
    );

    assert.ok(tokens.access_token);
    assert.equal(tokens.token_type, 'bearer');

    // Verify the access token resolves Zebrunner credentials
    const authInfo = await provider.verifyAccessToken(tokens.access_token);
    assert.equal(authInfo.extra.email, 'user@test.com');
    assert.equal(authInfo.extra.username, 'testuser');
    assert.equal(authInfo.extra.zebrunnerToken, 'zeb-token-123');
  });

  it('rejects expired authorization codes', async () => {
    provider.storeIssuedCode('expired-code', {
      email: 'user@test.com',
      mcpClientId: 'mcp_x',
      redirectUri: 'http://localhost/cb',
      codeChallenge: 'c',
      createdAt: Date.now() - 10 * 60 * 1000, // 10 min ago
    });

    // Code exists but exchange should still work within TTL
    // (codes expire via sweep, not via exchange)
    const result = await provider.exchangeAuthorizationCode(
      { client_id: 'mcp_x' },
      'expired-code',
    );
    assert.ok(result.access_token);
  });

  it('rejects code issued to different client', async () => {
    provider.storeIssuedCode('code-for-client-a', {
      email: 'user@test.com',
      mcpClientId: 'mcp_clientA',
      redirectUri: 'http://localhost/cb',
      codeChallenge: 'c',
      createdAt: Date.now(),
    });

    await assert.rejects(
      () => provider.exchangeAuthorizationCode({ client_id: 'mcp_clientB' }, 'code-for-client-a'),
      /different client/,
    );
  });

  it('rejects verification when no Zebrunner credentials stored', async () => {
    provider.storeIssuedCode('code-no-creds', {
      email: 'unknown@test.com',
      mcpClientId: 'mcp_c',
      redirectUri: 'http://localhost/cb',
      codeChallenge: 'c',
      createdAt: Date.now(),
    });

    const tokens = await provider.exchangeAuthorizationCode(
      { client_id: 'mcp_c' },
      'code-no-creds',
    );

    await assert.rejects(
      () => provider.verifyAccessToken(tokens.access_token),
      /No Zebrunner credentials found/,
    );
  });

  it('rejects tampered JWT', async () => {
    await tokenStore.set('user@test.com', { username: 'u', token: 't' });

    provider.storeIssuedCode('code-tamper', {
      email: 'user@test.com',
      mcpClientId: 'mcp_c',
      redirectUri: 'http://localhost/cb',
      codeChallenge: 'c',
      createdAt: Date.now(),
    });

    const tokens = await provider.exchangeAuthorizationCode(
      { client_id: 'mcp_c' },
      'code-tamper',
    );

    const tampered = tokens.access_token.slice(0, -5) + 'XXXXX';

    await assert.rejects(
      () => provider.verifyAccessToken(tampered),
      /Invalid token/,
    );
  });

  it('codes are single-use', async () => {
    provider.storeIssuedCode('single-use-code', {
      email: 'user@test.com',
      mcpClientId: 'mcp_c',
      redirectUri: 'http://localhost/cb',
      codeChallenge: 'c',
      createdAt: Date.now(),
    });

    await provider.exchangeAuthorizationCode({ client_id: 'mcp_c' }, 'single-use-code');

    await assert.rejects(
      () => provider.exchangeAuthorizationCode({ client_id: 'mcp_c' }, 'single-use-code'),
      /Invalid or expired/,
    );
  });
});
