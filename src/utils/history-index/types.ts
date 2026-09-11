import type { FieldHistoryChangeMatch } from '../field-history-search.js';

export const HISTORY_INDEX_VERSION = 1 as const;

export interface IndexedFieldChange {
  caseId: number;
  caseKey: string;
  title?: string;
  testSuiteId?: number;
  currentAutomationState?: string;
  timestamp: string;
  author: string;
  field: string;
  oldValue: string;
  newValue: string;
  concurrentChanges: Array<{ field: string; oldValue: string; newValue: string }>;
}

export interface HistoryIndexCaseSnapshot {
  lastModifiedAt?: string;
  indexedAt: string;
}

export interface HistoryIndexBuildCursor {
  pageToken?: string;
  casesProcessedThisRun: number;
  startedAt: string;
}

export interface HistoryIndexMeta {
  version: typeof HISTORY_INDEX_VERSION;
  projectKey: string;
  projectId: number;
  builtAt: string;
  lastIncrementalAt: string;
  complete: boolean;
  totalCasesIndexed: number;
  caseSnapshots: Record<string, HistoryIndexCaseSnapshot>;
  buildCursor?: HistoryIndexBuildCursor;
}

export interface HistoryIndexData {
  meta: HistoryIndexMeta;
  /** field path → denormalized change rows (e.g. customField.manualOnly) */
  byField: Record<string, IndexedFieldChange[]>;
}

export interface HistoryIndexQueryOptions {
  historyField: string;
  fromValue?: string;
  toValue?: string;
  changedAfter?: Date;
  changedBefore?: Date;
  suiteId?: number;
  rootSuiteId?: number;
  suiteIds?: number[];
  maxResults: number;
  includeCaseSummary: boolean;
}

export interface HistoryIndexQueryResult {
  matches: FieldHistoryChangeMatch[];
  /** Number of matches returned (≤ maxResults). */
  matchCount: number;
  /** Total matches for the query before maxResults truncation. */
  totalMatches: number;
  indexComplete: boolean;
  indexBuiltAt: string;
}

export interface BuildHistoryIndexOptions {
  projectKey: string;
  projectId: number;
  maxCasesPerBatch?: number;
  historyLimit?: number;
  historyConcurrency?: number;
  forceRefresh?: boolean;
  continueBuild?: boolean;
}

export interface BuildHistoryIndexResult {
  projectKey: string;
  complete: boolean;
  casesProcessedThisBatch: number;
  totalCasesIndexed: number;
  casesSkippedFresh: number;
  continueToken?: string;
  durationMs: number;
  indexPath: string;
  notes: string[];
}
