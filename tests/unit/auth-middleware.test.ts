import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createAuthMiddleware } from '../../src/http/auth-middleware.js';

function mockReq(headers: Record<string, string> = {}) {
  return { headers, auth: undefined } as any;
}

function mockRes() {
  let statusCode = 200;
  let body: any;
  return {
    status(code: number) { statusCode = code; return this; },
    json(data: any) { body = data; return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  } as any;
}

describe('Auth Middleware', () => {
  describe('header auth', () => {
    it('authenticates with X-Zebrunner-Username + X-Zebrunner-Api-Token', async () => {
      const mw = createAuthMiddleware();
      const req = mockReq({
        'x-zebrunner-username': 'testuser',
        'x-zebrunner-api-token': 'abc123',
      });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled, 'next() should be called');
      assert.deepEqual(req.auth, {
        method: 'headers',
        username: 'testuser',
        token: 'abc123',
      });
    });

    it('accepts alternative header names (x-zebrunner-api-username, x-zebrunner-token)', async () => {
      const mw = createAuthMiddleware();
      const req = mockReq({
        'x-zebrunner-api-username': 'user2',
        'x-zebrunner-token': 'token2',
      });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.equal(req.auth?.username, 'user2');
      assert.equal(req.auth?.token, 'token2');
    });

    it('rejects when no auth headers are present', async () => {
      const mw = createAuthMiddleware();
      const req = mockReq({});
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(!nextCalled, 'next() should not be called');
      assert.equal(res.statusCode, 401);
      assert.ok(res.body.error);
    });

    it('rejects when only username header is present', async () => {
      const mw = createAuthMiddleware();
      const req = mockReq({ 'x-zebrunner-username': 'user' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 401);
    });
  });

  describe('bearer auth (selfauth mode)', () => {
    it('delegates to verifyBearer when authMode=selfauth', async () => {
      const mw = createAuthMiddleware({
        authMode: 'selfauth',
        verifyBearer: async (token) => {
          assert.equal(token, 'jwt-token-123');
          return { username: 'self-user', zebrunnerToken: 'zeb-token' };
        },
      });
      const req = mockReq({ authorization: 'Bearer jwt-token-123' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.deepEqual(req.auth, {
        method: 'bearer',
        username: 'self-user',
        token: 'zeb-token',
      });
    });

    it('rejects header auth when authMode=selfauth', async () => {
      const mw = createAuthMiddleware({ authMode: 'selfauth' });
      const req = mockReq({
        'x-zebrunner-username': 'user',
        'x-zebrunner-api-token': 'token',
      });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 401);
    });
  });

  describe('bearer auth (okta mode)', () => {
    it('delegates to verifyBearer when authMode=okta', async () => {
      const mw = createAuthMiddleware({
        authMode: 'okta',
        verifyBearer: async (token) => {
          assert.equal(token, 'okta-jwt-456');
          return { username: 'sso-user', zebrunnerToken: 'zeb-token' };
        },
      });
      const req = mockReq({ authorization: 'Bearer okta-jwt-456' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.deepEqual(req.auth, {
        method: 'bearer',
        username: 'sso-user',
        token: 'zeb-token',
      });
    });

    it('returns 401 when bearer verification fails', async () => {
      const mw = createAuthMiddleware({
        authMode: 'okta',
        verifyBearer: async () => { throw new Error('invalid'); },
      });
      const req = mockReq({ authorization: 'Bearer bad-token' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 401);
    });

    it('rejects header auth when authMode=okta', async () => {
      const mw = createAuthMiddleware({ authMode: 'okta' });
      const req = mockReq({
        'x-zebrunner-username': 'user',
        'x-zebrunner-api-token': 'token',
      });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 401);
    });

    it('ignores bearer when authMode=headers (default)', async () => {
      const mw = createAuthMiddleware({
        verifyBearer: async () => ({ username: 'u', zebrunnerToken: 't' }),
      });
      const req = mockReq({ authorization: 'Bearer some-token' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(!nextCalled);
      assert.equal(res.statusCode, 401);
    });
  });

  describe('combined modes', () => {
    it('prefers header auth over bearer when authMode=headers,okta', async () => {
      const mw = createAuthMiddleware({
        authMode: 'headers,okta',
        verifyBearer: async () => ({ username: 'bearer-user', zebrunnerToken: 'bearer-token' }),
      });
      const req = mockReq({
        'x-zebrunner-username': 'header-user',
        'x-zebrunner-api-token': 'header-token',
        authorization: 'Bearer jwt',
      });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.equal(req.auth?.method, 'headers');
      assert.equal(req.auth?.username, 'header-user');
    });

    it('falls back to bearer when headers are missing in authMode=headers,okta', async () => {
      const mw = createAuthMiddleware({
        authMode: 'headers,okta',
        verifyBearer: async () => ({ username: 'bearer-user', zebrunnerToken: 'bearer-token' }),
      });
      const req = mockReq({ authorization: 'Bearer jwt' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.equal(req.auth?.method, 'bearer');
      assert.equal(req.auth?.username, 'bearer-user');
    });

    it('prefers header auth over bearer when authMode=headers,selfauth', async () => {
      const mw = createAuthMiddleware({
        authMode: 'headers,selfauth',
        verifyBearer: async () => ({ username: 'self-user', zebrunnerToken: 'self-token' }),
      });
      const req = mockReq({
        'x-zebrunner-username': 'header-user',
        'x-zebrunner-api-token': 'header-token',
        authorization: 'Bearer jwt',
      });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.equal(req.auth?.method, 'headers');
    });

    it('falls back to bearer when headers are missing in authMode=headers,selfauth', async () => {
      const mw = createAuthMiddleware({
        authMode: 'headers,selfauth',
        verifyBearer: async () => ({ username: 'self-user', zebrunnerToken: 'self-token' }),
      });
      const req = mockReq({ authorization: 'Bearer jwt' });
      const res = mockRes();
      let nextCalled = false;

      await mw(req, res, () => { nextCalled = true; });

      assert.ok(nextCalled);
      assert.equal(req.auth?.method, 'bearer');
    });
  });
});
