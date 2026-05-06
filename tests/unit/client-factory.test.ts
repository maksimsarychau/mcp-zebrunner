import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { ClientFactory } from '../../src/http/client-factory.js';

describe('ClientFactory', () => {
  let factory: ClientFactory;

  beforeEach(() => {
    factory = new ClientFactory({
      timeout: 5000,
      debug: false,
      defaultPageSize: 10,
      maxPageSize: 100,
    });
  });

  it('creates clients on first call', () => {
    const clients = factory.getOrCreate(
      'https://test.zebrunner.com/api/public/v1',
      'user1',
      'token-abc123xyz',
    );
    assert.ok(clients.client);
    assert.ok(clients.mutationClient);
    assert.ok(clients.reportingClient);
    assert.ok(clients.reportingHandlers);
    assert.equal(factory.size, 1);
  });

  it('returns cached clients on subsequent calls with same credentials', () => {
    const first = factory.getOrCreate('https://z.com/api/public/v1', 'user1', 'token-abc');
    const second = factory.getOrCreate('https://z.com/api/public/v1', 'user1', 'token-abc');
    assert.strictEqual(first, second);
    assert.equal(factory.size, 1);
  });

  it('creates separate clients for different users', () => {
    const a = factory.getOrCreate('https://z.com/api/public/v1', 'alice', 'token-aaa');
    const b = factory.getOrCreate('https://z.com/api/public/v1', 'bob', 'token-bbb');
    assert.notStrictEqual(a, b);
    assert.equal(factory.size, 2);
  });

  it('cleans up on destroy', () => {
    factory.getOrCreate('https://z.com/api/public/v1', 'user1', 'token-123');
    factory.destroy();
    assert.equal(factory.size, 0);
  });
});
