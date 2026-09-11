import type { HistoryEntry } from '../testCaseHistory.js';
import type { ZebrunnerShortTestCase } from '../../types/core.js';
import type { IndexedFieldChange } from './types.js';

function formatConcurrentChange(
  change: HistoryEntry['changes'][number],
): { field: string; oldValue: string; newValue: string } {
  const field = change.subField
    ? `${change.field}[${change.stepIndex ?? 0}].${change.subField}`
    : change.field;
  return { field, oldValue: change.oldValue, newValue: change.newValue };
}

/** Flatten parsed history entries into index rows (one row per field change). */
export function historyEntriesToIndexedChanges(
  testCase: ZebrunnerShortTestCase,
  entries: HistoryEntry[],
): IndexedFieldChange[] {
  const rows: IndexedFieldChange[] = [];
  const caseId = testCase.id!;
  const caseKey = testCase.key ?? String(caseId);

  for (const entry of entries) {
    for (const change of entry.changes) {
      rows.push({
        caseId,
        caseKey,
        title: testCase.title,
        testSuiteId: testCase.testSuite?.id,
        currentAutomationState: testCase.automationState?.name,
        timestamp: entry.timestamp,
        author: entry.author,
        field: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        concurrentChanges: entry.changes
          .filter(c => c !== change)
          .map(formatConcurrentChange),
      });
    }
  }

  return rows;
}

export function removeCaseFromIndex(
  byField: Record<string, IndexedFieldChange[]>,
  caseId: number,
): void {
  for (const field of Object.keys(byField)) {
    byField[field] = byField[field].filter(row => row.caseId !== caseId);
  }
}

export function mergeIndexedChanges(
  byField: Record<string, IndexedFieldChange[]>,
  rows: IndexedFieldChange[],
): void {
  for (const row of rows) {
    if (!byField[row.field]) {
      byField[row.field] = [];
    }
    byField[row.field].push(row);
  }
}
