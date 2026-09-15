import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Mirrors EnhancedZebrunnerClient.buildRQLFilter compose behavior (v9.4.2).
 */
function composeRqlFilter(customFilter: string | undefined, builtParts: string[]): string {
  const base = builtParts.join(' AND ');
  if (customFilter) {
    if (!base) return customFilter;
    return `(${customFilter}) AND (${base})`;
  }
  return base;
}

describe('RQL filter compose', () => {
  it('returns custom filter alone when no other parts', () => {
    assert.equal(composeRqlFilter('testSuite.id=1', []), 'testSuite.id=1');
  });

  it('AND-composes custom filter with automation clause', () => {
    const result = composeRqlFilter('testSuite.id IN [1,2]', ['automationState.id = 10']);
    assert.equal(result, '(testSuite.id IN [1,2]) AND (automationState.id = 10)');
  });

  it('returns built parts when no custom filter', () => {
    assert.equal(composeRqlFilter(undefined, ['deprecated = false']), 'deprecated = false');
  });
});
