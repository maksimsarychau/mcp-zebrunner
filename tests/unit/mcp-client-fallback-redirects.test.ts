import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RECOVERED_MCP_CLIENT_REDIRECT_URIS,
  getRecoveredMcpClientRedirectUris,
  mergeRecoveredRedirectUris,
  needsRecoveredRedirectMerge,
  createRecoveredMcpClientRecord,
  resolveMcpOAuthClient,
} from '../../src/http/mcp-client-fallback-redirects.js';
import { FileOAuthFlowStore } from '../../src/http/oauth-flow-store.js';

const CURSOR_URI = 'cursor://anysphere.cursor-mcp/oauth/callback';
const LOOPBACK_OAUTH_CALLBACK = 'http://127.0.0.1/oauth/callback';
const LOOPBACK_CALLBACK = 'http://127.0.0.1/callback';
const ENV_EXTRA_APP_URI = 'myapp://cb';
const ENV_EXTRA_HTTPS_URI = 'https://example.com/cb';
const CUSTOM_MERGE_URI = 'https://custom.example/oauth/cb';

/** Exact redirect URI membership (avoids CodeQL incomplete URL substring warnings on `.includes()`). */
function hasExactRedirectUri(uris: readonly string[], expected: string): boolean {
  return uris.some((u) => u === expected);
}

describe('mcp-client-fallback-redirects', () => {
  it('includes Cursor, Claude Desktop, and Claude Code redirect patterns', () => {
    assert.ok(hasExactRedirectUri(RECOVERED_MCP_CLIENT_REDIRECT_URIS, CURSOR_URI));
    assert.ok(hasExactRedirectUri(RECOVERED_MCP_CLIENT_REDIRECT_URIS, LOOPBACK_OAUTH_CALLBACK));
    assert.ok(hasExactRedirectUri(RECOVERED_MCP_CLIENT_REDIRECT_URIS, LOOPBACK_CALLBACK));
  });

  it('appends allowed OAUTH_RECOVERED_REDIRECT_URIS from env and drops unsafe URLs', () => {
    const prev = process.env.OAUTH_RECOVERED_REDIRECT_URIS;
    process.env.OAUTH_RECOVERED_REDIRECT_URIS = `${ENV_EXTRA_APP_URI}, ${ENV_EXTRA_HTTPS_URI}`;
    try {
      const uris = getRecoveredMcpClientRedirectUris();
      assert.ok(hasExactRedirectUri(uris, ENV_EXTRA_APP_URI));
      assert.ok(!hasExactRedirectUri(uris, ENV_EXTRA_HTTPS_URI));
    } finally {
      if (prev === undefined) delete process.env.OAUTH_RECOVERED_REDIRECT_URIS;
      else process.env.OAUTH_RECOVERED_REDIRECT_URIS = prev;
    }
  });

  it('needsRecoveredRedirectMerge detects missing canonical URIs', () => {
    assert.ok(needsRecoveredRedirectMerge(['http://127.0.0.1/oauth/callback']));
    assert.ok(!needsRecoveredRedirectMerge([...getRecoveredMcpClientRedirectUris()]));
  });

  it('mergeRecoveredRedirectUris preserves custom URIs', () => {
    const merged = mergeRecoveredRedirectUris([CUSTOM_MERGE_URI]);
    assert.ok(hasExactRedirectUri(merged, CUSTOM_MERGE_URI));
    assert.ok(hasExactRedirectUri(merged, CURSOR_URI));
  });

  describe('resolveMcpOAuthClient', () => {
    let dir: string;
    const storeKey = 'test-encryption-key-32chars-min!';

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'oauth-fallback-test-'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('creates recovered client with full redirect list when missing', async () => {
      const store = new FileOAuthFlowStore(dir, storeKey);
      const client = await resolveMcpOAuthClient(store, 'mcp_newclient0001');
      assert.ok(client);
      assert.ok(hasExactRedirectUri(client!.redirect_uris, CURSOR_URI));
      assert.ok(hasExactRedirectUri(client!.redirect_uris, LOOPBACK_CALLBACK));
    });

    it('merges canonical URIs into stale loopback-only persisted client', async () => {
      const store = new FileOAuthFlowStore(dir, storeKey);
      const staleId = 'mcp_staleloopback01';
      await store.setClient(staleId, {
        client_id: staleId,
        redirect_uris: ['http://127.0.0.1/oauth/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        client_id_issued_at: 1,
      });

      const client = await resolveMcpOAuthClient(store, staleId);
      assert.ok(hasExactRedirectUri(client!.redirect_uris, CURSOR_URI));
      assert.ok(hasExactRedirectUri(client!.redirect_uris, LOOPBACK_CALLBACK));

      const reloaded = await store.getClient(staleId);
      assert.ok(hasExactRedirectUri(reloaded!.redirect_uris, CURSOR_URI));
    });

    it('returns null for unknown non-mcp client', async () => {
      const store = new FileOAuthFlowStore(dir, storeKey);
      const client = await resolveMcpOAuthClient(store, 'not_mcp_client');
      assert.equal(client, null);
    });
  });

  it('createRecoveredMcpClientRecord sets expected defaults', () => {
    const record = createRecoveredMcpClientRecord('mcp_abc123');
    assert.equal(record.client_id, 'mcp_abc123');
    assert.equal(record.token_endpoint_auth_method, 'none');
    assert.ok(hasExactRedirectUri(record.redirect_uris, CURSOR_URI));
  });
});
