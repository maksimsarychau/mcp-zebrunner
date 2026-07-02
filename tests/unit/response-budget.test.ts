import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { projectTestCases, projectSuites, FormatProcessor } from '../../src/utils/formatter.js';

/**
 * Response-size budget regression gate (token-cost optimization Phase 5.2).
 * Locks the projected/compact defaults under a byte budget so a regression that re-fattens the
 * default read shape fails CI.
 */
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function fatCase(i: number) {
  return {
    id: i, key: `ANDR-${i}`, title: `Test case number ${i} with a moderately long descriptive title`,
    priority: { name: 'High' }, automationState: { name: 'Automation Complete' }, deprecated: false,
    description: '<p>'.padEnd(400, 'x') + '</p>',
    steps: Array.from({ length: 10 }, (_, s) => ({ action: 'step ' + s, expected: 'result ' + s })),
    customField: { manualOnly: false, component: 'X' },
  };
}

describe('response-size budgets (zebrunner defaults)', () => {
  it('50 test cases at detail=summary (compact) stay well under the full-body size', () => {
    const cases = Array.from({ length: 50 }, (_, i) => fatCase(i));
    const full = bytes(FormatProcessor.format(cases, 'compact') as string);
    const summary = bytes(FormatProcessor.format(projectTestCases(cases, 'summary'), 'compact') as string);
    // Summary must be < 25% of the full-body compact payload, and under an absolute 12 KB budget.
    assert.ok(summary < full * 0.25, `summary ${summary} should be <25% of full ${full}`);
    assert.ok(summary < 12_000, `summary ${summary} should be under 12KB budget`);
  });

  it('50 suites at detail=summary stay under budget', () => {
    const suites = Array.from({ length: 50 }, (_, i) => ({
      id: i, title: `Suite ${i}`, name: `Suite ${i}`, parentSuiteId: 1, rootSuiteId: 0, testCasesCount: i,
      description: 'x'.repeat(300), relativePosition: i, createdBy: { username: 'u' },
    }));
    const summary = bytes(FormatProcessor.format(projectSuites(suites, 'summary'), 'compact') as string);
    assert.ok(summary < 8_000, `suite summary ${summary} should be under 8KB budget`);
  });
});
