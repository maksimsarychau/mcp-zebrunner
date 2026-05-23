import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileOAuthFlowStore,
  InMemoryOAuthFlowStore,
  sanitizeOAuthStoreKey,
  PENDING_AUTH_TTL_MS,
  ISSUED_CODE_TTL_MS,
} from '../../src/http/oauth-flow-store.js';

describe('OAuthFlowStore', () => {
  describe('sanitizeOAuthStoreKey', () => {
    it('rejects path traversal', () => {
      assert.throws(() => sanitizeOAuthStoreKey('../etc/passwd'), /Invalid OAuth flow store key/);
    });
  });

  describe('InMemoryOAuthFlowStore', () => {
    it('takeIssuedCode is single-use', async () => {
      const store = new InMemoryOAuthFlowStore();
      await store.setIssuedCode('code1', { mcpClientId: 'mcp_a', createdAt: Date.now() });
      const first = await store.takeIssuedCode('code1');
      assert.ok(first);
      const second = await store.takeIssuedCode('code1');
      assert.equal(second, null);
    });
  });

  describe('FileOAuthFlowStore multi-instance', () => {
    let dir: string;
    const key = 'test-encryption-key-32chars-min!';

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'oauth-flow-test-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('writes on instance A, reads on instance B', async () => {
      const storeA = new FileOAuthFlowStore(dir, key);
      const storeB = new FileOAuthFlowStore(dir, key);

      await storeA.setPending('abc123state', {
        mcpClientId: 'mcp_test',
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'xyz',
        createdAt: Date.now(),
      });

      const pending = await storeB.getPending('abc123state');
      assert.ok(pending);
      assert.equal(pending!.mcpClientId, 'mcp_test');
    });

    it('expires pending auth by TTL', async () => {
      const store = new FileOAuthFlowStore(dir, key);
      await store.setPending('oldstate', {
        mcpClientId: 'mcp_x',
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'c',
        createdAt: Date.now() - PENDING_AUTH_TTL_MS - 1,
      });
      const pending = await store.getPending('oldstate');
      assert.equal(pending, null);
    });

    it('expires issued codes on take when past TTL', async () => {
      const store = new FileOAuthFlowStore(dir, key);
      await store.setIssuedCode('oldcode', {
        email: 'u@test.com',
        mcpClientId: 'mcp_x',
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'c',
        createdAt: Date.now() - ISSUED_CODE_TTL_MS - 1,
      });
      const taken = await store.takeIssuedCode('oldcode');
      assert.equal(taken, null);
    });
  });
});
