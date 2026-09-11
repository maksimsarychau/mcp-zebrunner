import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mergeTestCaseProjectionFields } from '../../src/utils/formatter.js';

describe('mergeTestCaseProjectionFields', () => {
  it('auto-includes history when include_history is set with explicit fields', () => {
    const { effectiveFields, warnings } = mergeTestCaseProjectionFields(
      ['id', 'key'],
      'full',
      { includeHistory: true },
    );
    assert.ok(effectiveFields?.includes('history'));
    assert.ok(warnings.some((w) => w.includes('history')));
  });

  it('auto-includes rootSuiteId on summary detail when include_root_suite is set', () => {
    const { effectiveFields } = mergeTestCaseProjectionFields(
      undefined,
      'summary',
      { includeRootSuite: true },
    );
    assert.ok(effectiveFields?.includes('rootSuiteId'));
  });
});
