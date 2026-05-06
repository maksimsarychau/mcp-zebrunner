import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { FileTokenStore } from '../../src/http/token-store.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('FileTokenStore', () => {
  let tmpDir: string;
  let storePath: string;
  const key = 'test-encryption-key-32chars!@#$%^';

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mcp-token-store-test-'));
    storePath = join(tmpDir, 'tokens.enc');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null for non-existent email', async () => {
    const store = new FileTokenStore(storePath, key);
    const result = await store.get('nobody@test.com');
    assert.equal(result, null);
  });

  it('stores and retrieves a token entry', async () => {
    const store = new FileTokenStore(storePath, key);
    await store.set('alice@test.com', { username: 'alice', token: 'tok-aaa' });
    const result = await store.get('alice@test.com');
    assert.deepEqual(result, { username: 'alice', token: 'tok-aaa' });
  });

  it('persists data across instances', async () => {
    const store1 = new FileTokenStore(storePath, key);
    await store1.set('bob@test.com', { username: 'bob', token: 'tok-bbb' });

    const store2 = new FileTokenStore(storePath, key);
    const result = await store2.get('bob@test.com');
    assert.deepEqual(result, { username: 'bob', token: 'tok-bbb' });
  });

  it('is case-insensitive for email keys', async () => {
    const store = new FileTokenStore(storePath, key);
    await store.set('Alice@Test.COM', { username: 'alice', token: 'tok' });
    const result = await store.get('alice@test.com');
    assert.equal(result?.username, 'alice');
  });

  it('deletes a token entry', async () => {
    const store = new FileTokenStore(storePath, key);
    await store.set('del@test.com', { username: 'del', token: 'tok' });
    const deleted = await store.delete('del@test.com');
    assert.equal(deleted, true);
    const result = await store.get('del@test.com');
    assert.equal(result, null);
  });

  it('returns false when deleting non-existent entry', async () => {
    const store = new FileTokenStore(storePath, key);
    const deleted = await store.delete('nope@test.com');
    assert.equal(deleted, false);
  });

  it('lists stored emails', async () => {
    const store = new FileTokenStore(storePath, key);
    await store.set('a@test.com', { username: 'a', token: 'ta' });
    await store.set('b@test.com', { username: 'b', token: 'tb' });
    const emails = await store.list();
    assert.deepEqual(emails.sort(), ['a@test.com', 'b@test.com']);
  });

  it('fails to decrypt with wrong key', async () => {
    const store1 = new FileTokenStore(storePath, key);
    await store1.set('user@test.com', { username: 'user', token: 'tok' });

    const store2 = new FileTokenStore(storePath, 'wrong-key-totally-different!!');
    await assert.rejects(() => store2.get('user@test.com'));
  });
});
