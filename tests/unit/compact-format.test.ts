import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { FormatProcessor, projectTestCases } from '../../src/utils/formatter.js';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('compact format responses', () => {
  it('is minified JSON that round-trips and is smaller than pretty json', () => {
    const payload = {
      requested: 2,
      found: 2,
      notFound: [] as string[],
      results: [
        { id: 1, key: 'MCP-1', title: 'Alpha', priority: { name: 'High' }, automationState: { name: 'Automated' }, deprecated: false },
        { id: 2, key: 'MCP-2', title: 'Beta', priority: { name: 'Low' }, automationState: { name: 'Manual' }, deprecated: false },
      ],
    };

    const compact = FormatProcessor.format(payload, 'compact') as string;
    const pretty = FormatProcessor.format(payload, 'json') as string;

    assert.equal(compact, JSON.stringify(payload));
    assert.ok(!compact.includes('\n'));
    assert.deepEqual(JSON.parse(compact), payload);
    assert.ok(bytes(compact) < bytes(pretty), 'compact should be smaller than pretty json');
  });

  it('batch-style summary + compact matches the default batch_get_test_cases shape', () => {
    const found = [
      { id: 1, key: 'MCP-1', title: 'One', priority: { name: 'High' }, automationState: { name: 'Done' }, deprecated: false, description: 'heavy', steps: [1, 2] },
    ];
    const payload = {
      requested: 2,
      found: 1,
      notFound: ['MCP-9'],
      results: projectTestCases(found, 'summary'),
    };

    const text = FormatProcessor.format(payload, 'compact') as string;
    const parsed = JSON.parse(text);

    assert.equal(parsed.found, 1);
    assert.deepEqual(parsed.notFound, ['MCP-9']);
    assert.equal(parsed.results[0].description, undefined);
    assert.equal(parsed.results[0].steps, undefined);
    assert.equal(parsed.results[0].key, 'MCP-1');
  });

  it('launch listing compact matches JSON.stringify (no pretty-print)', () => {
    const launchesData = {
      items: [{ id: 10, name: 'Regression', passed: 90, failed: 2, skipped: 1 }],
      _meta: { total: 1, totalPages: 1, page: 1 },
    };
    const compact = JSON.stringify(launchesData);
    assert.equal(compact, FormatProcessor.format(launchesData, 'compact'));
    assert.ok(!compact.includes('  '));
  });
});
