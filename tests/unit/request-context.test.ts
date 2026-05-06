import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { requestContext, getCurrentContext } from '../../src/http/request-context.js';

describe('RequestContext (AsyncLocalStorage)', () => {
  it('returns undefined outside of a run() call', () => {
    assert.equal(getCurrentContext(), undefined);
  });

  it('returns the context inside a run() call', async () => {
    const ctx = { username: 'alice', token: 'tok-abc' };
    await requestContext.run(ctx, async () => {
      const current = getCurrentContext();
      assert.deepEqual(current, ctx);
    });
  });

  it('returns undefined after run() completes', async () => {
    await requestContext.run({ username: 'bob', token: 'tok-def' }, async () => {
      assert.ok(getCurrentContext());
    });
    assert.equal(getCurrentContext(), undefined);
  });

  it('isolates concurrent contexts', async () => {
    const results: string[] = [];

    await Promise.all([
      requestContext.run({ username: 'user-1', token: 't1' }, async () => {
        await new Promise(r => setTimeout(r, 10));
        results.push(getCurrentContext()!.username);
      }),
      requestContext.run({ username: 'user-2', token: 't2' }, async () => {
        await new Promise(r => setTimeout(r, 5));
        results.push(getCurrentContext()!.username);
      }),
    ]);

    assert.ok(results.includes('user-1'));
    assert.ok(results.includes('user-2'));
  });

  it('supports nested runs with inner context winning', async () => {
    await requestContext.run({ username: 'outer', token: 't1' }, async () => {
      assert.equal(getCurrentContext()!.username, 'outer');
      await requestContext.run({ username: 'inner', token: 't2' }, async () => {
        assert.equal(getCurrentContext()!.username, 'inner');
      });
      assert.equal(getCurrentContext()!.username, 'outer');
    });
  });
});
