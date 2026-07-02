import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileOAuthFlowStore } from '../../src/http/oauth-flow-store.js';
import { SelfAuthOAuthProvider } from '../../src/http/selfauth-provider.js';

describe('OAuth flow across two provider instances (multi-pod)', () => {
  it('authorize on pod A, getPendingAuth on pod B', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oauth-multipod-'));
    try {
      const flowStore = new FileOAuthFlowStore(dir, 'multipod-test-key-32chars-min!!');
      const tokenStore = {
        get: async () => null,
        set: async () => {},
        delete: async () => false,
        list: async () => [],
      };

      const podA = new SelfAuthOAuthProvider({
        tokenStore,
        serverUrl: 'https://mcp.example.com',
        zebrunnerBaseUrl: 'https://test.zebrunner.com/api/public/v1',
        jwtSecret: 'jwt-secret-key-32chars-minimum!!',
        oauthFlowStore: flowStore,
      });

      const podB = new SelfAuthOAuthProvider({
        tokenStore,
        serverUrl: 'https://mcp.example.com',
        zebrunnerBaseUrl: 'https://test.zebrunner.com/api/public/v1',
        jwtSecret: 'jwt-secret-key-32chars-minimum!!',
        oauthFlowStore: flowStore,
      });

      let redirectUrl = '';
      await podA.authorize(
        { client_id: 'mcp_podtest123456' },
        { redirectUri: 'http://127.0.0.1/oauth/callback', codeChallenge: 'abc', state: 'client-state' },
        { redirect: (url: string) => { redirectUrl = url; } },
      );

      const state = new URL(redirectUrl).searchParams.get('state');
      assert.ok(state);

      const pending = await podB.getPendingAuth(state!);
      assert.ok(pending);
      assert.equal(pending!.mcpClientId, 'mcp_podtest123456');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
