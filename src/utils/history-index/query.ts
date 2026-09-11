import {
  historyValuesMatch,
  type FieldHistoryChangeMatch,
} from '../field-history-search.js';
import type { HistoryIndexData, HistoryIndexQueryOptions, HistoryIndexQueryResult } from './types.js';

function entryInDateRange(
  timestamp: string,
  changedAfter?: Date,
  changedBefore?: Date,
): boolean {
  const t = new Date(timestamp);
  if (Number.isNaN(t.getTime())) return false;
  if (changedAfter && t < changedAfter) return false;
  if (changedBefore && t > changedBefore) return false;
  return true;
}

function suiteMatches(
  testSuiteId: number | undefined,
  suiteId?: number,
  suiteIds?: number[],
): boolean {
  if (suiteId != null) {
    return testSuiteId === suiteId;
  }
  if (suiteIds != null && suiteIds.length > 0) {
    return testSuiteId != null && suiteIds.includes(testSuiteId);
  }
  return true;
}

/** Query a built history index (in-memory filter — fast for whole-project windows). */
export function queryHistoryIndex(
  index: HistoryIndexData,
  options: HistoryIndexQueryOptions,
): HistoryIndexQueryResult {
  const rows = index.byField[options.historyField] ?? [];
  const matches: FieldHistoryChangeMatch[] = [];

  for (const row of rows) {
    if (!entryInDateRange(row.timestamp, options.changedAfter, options.changedBefore)) {
      continue;
    }
    if (!historyValuesMatch(options.fromValue, row.oldValue)) continue;
    if (!historyValuesMatch(options.toValue, row.newValue)) continue;
    if (!suiteMatches(row.testSuiteId, options.suiteId, options.suiteIds)) continue;

    matches.push({
      key: row.caseKey,
      ...(options.includeCaseSummary
        ? {
          title: row.title,
          currentAutomationState: row.currentAutomationState,
        }
        : {}),
      timestamp: row.timestamp,
      author: row.author,
      oldValue: row.oldValue,
      newValue: row.newValue,
      concurrentChanges: row.concurrentChanges,
    });

    if (matches.length >= options.maxResults) break;
  }

  matches.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return {
    matches,
    matchCount: matches.length,
    indexComplete: index.meta.complete,
    indexBuiltAt: index.meta.lastIncrementalAt,
  };
}
