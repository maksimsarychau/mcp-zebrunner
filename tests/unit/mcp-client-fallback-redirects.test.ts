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

describe('mcp-client-fallback-redirects', () => {
  it('includes Cursor, Claude Desktop, and Claude Code redirect patterns', () => {
    assert.ok(RECOVERED_MCP_CLIENT_REDIRECT_URIS.includes(CURSOR_URI));
    assert.ok(RECOVERED_MCP_CLIENT_REDIRECT_URIS.some((u) => u.endsWith('/oauth/callback')));
    assert.ok(RECOVERED_MCP_CLIENT_REDIRECT_URIS.some((u) => u.endsWith('/callback') && !u.includes('oauth')));
  });

  it('appends OAUTH_RECOVERED_REDIRECT_URIS from env', () => {
    const prev = process.env.OAUTH_RECOVERED_REDIRECT_URIS;
    process.env.OAUTH_RECOVERED_REDIRECT_URIS = 'myapp://cb, https://example.com/cb';
    try {
      const uris = getRecoveredMcpClientRedirectUris();
      assert.ok(uris.includes('myapp://cb'));
      assert.ok(uris.includes('https://example.com/cb'));
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
    const merged = mergeRecoveredRedirectUris(['https://custom.example/oauth/cb']);
    assert.ok(merged.includes('https://custom.example/oauth/cb'));
    assert.ok(merged.includes(CURSOR_URI));
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
      assert.ok(client!.redirect_uris.includes(CURSOR_URI));
      assert.ok(client!.redirect_uris.some((u) => u.endsWith('/callback') && !u.includes('oauth')));
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
      assert.ok(client!.redirect_uris.includes(CURSOR_URI));
      assert.ok(client!.redirect_uris.includes('http://127.0.0.1/callback'));

      const reloaded = await store.getClient(staleId);
      assert.ok(reloaded!.redirect_uris.includes(CURSOR_URI));
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
    assert.ok(record.redirect_uris.includes(CURSOR_URI));
  });
});
