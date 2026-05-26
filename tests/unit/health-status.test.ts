import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectOAuthFlowStoreHealth,
  collectTokenStoreHealth,
  buildHealthStatus,
} from '../../src/http/health-status.js';
import { FileTokenStore } from '../../src/http/token-store.js';

describe('health-status', () => {
  let dir: string;
  const storeKey = 'test-encryption-key-32chars-min!';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'health-status-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    delete process.env.TOKEN_STORE_PATH;
    delete process.env.TOKEN_STORE_KEY;
    delete process.env.OAUTH_FLOW_STORE_DIR;
  });

  it('collectOAuthFlowStoreHealth reports memory backend when token env unset', async () => {
    const health = await collectOAuthFlowStoreHealth();
    assert.equal(health.backend, 'memory');
    assert.equal(health.enabled, false);
  });

  it('collectOAuthFlowStoreHealth counts encrypted files on disk', async () => {
    const tokenPath = join(dir, 'tokens.enc');
    process.env.TOKEN_STORE_PATH = tokenPath;
    process.env.TOKEN_STORE_KEY = storeKey;
    const oauthDir = join(dir, 'oauth-flow');
    await mkdir(join(oauthDir, 'clients'), { recursive: true });
    await mkdir(join(oauthDir, 'pending'), { recursive: true });
    await writeFile(join(oauthDir, 'clients', 'mcp_abc.enc'), 'x');
    await writeFile(join(oauthDir, 'pending', 'state1.enc'), 'y');

    const health = await collectOAuthFlowStoreHealth();
    assert.equal(health.backend, 'file');
    assert.equal(health.directory, oauthDir);
    assert.equal(health.registeredClientCount, 1);
    assert.equal(health.pendingCount, 1);
    assert.equal(health.issuedCodeCount, 0);
    assert.equal(health.directoryExists, true);
  });

  it('collectTokenStoreHealth reports file store with user count', async () => {
    const tokenPath = join(dir, 'tokens.enc');
    process.env.TOKEN_STORE_PATH = tokenPath;
    process.env.TOKEN_STORE_KEY = storeKey;
    const store = new FileTokenStore(tokenPath, storeKey);
    await store.set('user@test.com', { username: 'u', token: 't' });

    const health = await collectTokenStoreHealth(store);
    assert.equal(health.enabled, true);
    assert.equal(health.backend, 'file');
    assert.equal(health.storedUserCount, 1);
    assert.equal(health.fileExists, true);
  });

  it('buildHealthStatus keeps backward-compatible top-level fields', async () => {
    const body = await buildHealthStatus({
      version: '9.0.2',
      authMode: 'selfauth',
      oauthEnabled: true,
      tokenStore: undefined,
      mcpServerUrl: 'https://zebrunner-mcp.mfp.dev',
      zebrunnerUrlFromEnv: true,
      activeSessions: 2,
    });
    assert.equal(body.status, 'ok');
    assert.equal(body.transport, 'streamablehttp');
    assert.equal(body.version, '9.0.2');
    assert.equal(body.authMode, 'selfauth');
    assert.equal(body.oauthEnabled, true);
    assert.equal(body.tokenStoreEnabled, false);
    assert.equal(body.activeSessions, 2);
    assert.equal(body.mcpServerUrl, 'https://zebrunner-mcp.mfp.dev');
    assert.equal(body.storage?.health, 'ok');
    assert.ok((body.storage?.recoveredRedirectUriCount ?? 0) >= 7);
  });
});
