import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { projectTestCases } from '../../src/utils/formatter.js';

/**
 * Contract test for the batch_get_test_cases partition + projection semantics.
 * Mirrors the handler's Promise.allSettled → {results, notFound} logic with a
 * stubbed fetcher, so the "unresolved keys never fail the call" guarantee is
 * locked without a live Zebrunner connection.
 */
async function batchPartition(
  keys: string[],
  fetch: (key: string) => Promise<any>,
  detail: 'summary' | 'full' = 'summary',
) {
  const notFound: string[] = [];
  const settled = await Promise.allSettled(keys.map((k) => fetch(k.trim())));
  const found: any[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) found.push(r.value);
    else notFound.push(keys[i].trim());
  });
  return { requested: keys.length, found: found.length, notFound, results: projectTestCases(found, detail) };
}

describe('batch_get_test_cases partition', () => {
  const db: Record<string, any> = {
    'MCP-1': { id: 1, key: 'MCP-1', title: 'One', priority: { name: 'High' }, automationState: { name: 'Done' }, deprecated: false, description: 'body', steps: [1, 2] },
    'MCP-2': { id: 2, key: 'MCP-2', title: 'Two', deprecated: false },
  };
  const fetch = async (k: string) => {
    if (!db[k]) throw new Error(`not found: ${k}`);
    return db[k];
  };

  it('separates valid keys (results) from invalid keys (notFound)', async () => {
    const out = await batchPartition(['MCP-1', 'NOPE-9', 'MCP-2'], fetch);
    assert.equal(out.requested, 3);
    assert.equal(out.found, 2);
    assert.deepEqual(out.notFound, ['NOPE-9']);
    assert.deepEqual((out.results as any[]).map((r) => r.key), ['MCP-1', 'MCP-2']);
  });

  it('summary projection drops heavy fields on results', async () => {
    const out = await batchPartition(['MCP-1'], fetch);
    const r = (out.results as any[])[0];
    assert.equal(r.description, undefined);
    assert.equal(r.steps, undefined);
    assert.equal(r.title, 'One');
  });

  it('all-invalid input still resolves (never throws)', async () => {
    const out = await batchPartition(['X-1', 'X-2'], fetch);
    assert.equal(out.found, 0);
    assert.deepEqual(out.notFound, ['X-1', 'X-2']);
  });
});
