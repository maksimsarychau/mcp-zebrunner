/**
 * Server-side scan for test-case field transitions in TCM change history.
 * Option 2 from the adv_find_field_history_changes spec: paginate cases internally,
 * fetch /changes per case, return only matching events (not full case payloads).
 */

import type { FieldsLayout } from '../api/reporting-client.js';
import type { ZebrunnerReportingClient } from '../api/reporting-client.js';
import type { EnhancedZebrunnerClient } from '../api/enhanced-client.js';
import type { ZebrunnerShortTestCase, ZebrunnerTestSuite } from '../types/core.js';
import {
  expandSuiteIds,
  findManualOnlyField,
  SYSTEM_FIELD_NAME_MAP,
  type SystemFieldDataType,
} from './tcm-widget-field.js';
import {
  enrichTestCasesWithHistory,
  type AutomationStatesMap,
  type HistoryEntry,
} from './testCaseHistory.js';
import {
  isIndexUsable,
  loadHistoryIndex,
  queryHistoryIndex,
} from './history-index/index.js';

export interface ResolvedHistoryField {
  historyField: string;
  displayLabel: string;
}

export interface FieldHistoryChangeMatch {
  key: string;
  title?: string;
  timestamp: string;
  author: string;
  oldValue: string;
  newValue: string;
  concurrentChanges: Array<{ field: string; oldValue: string; newValue: string }>;
  currentAutomationState?: string;
}

export interface FindFieldHistoryChangesResult {
  project: string;
  field: string;
  fieldLabel: string;
  matches: FieldHistoryChangeMatch[];
  casesScanned: number;
  matchCount: number;
  stoppedEarly: boolean;
  scanNotes?: string[];
  /** True when matches came from the local history index (Option 1). */
  indexUsed?: boolean;
  indexComplete?: boolean;
}

export type FieldHistoryIndexMode = 'auto' | 'scan' | 'index';

export interface FindFieldHistoryChangesOptions {
  projectKey: string;
  projectId: number;
  field: string;
  fromValue?: string;
  toValue?: string;
  changedAfter?: string;
  changedBefore?: string;
  suiteId?: number;
  rootSuiteId?: number;
  includeCaseSummary?: boolean;
  maxResults?: number;
  historyLimit?: number;
  /** Stop after this many cases receive a history fetch (partial results + scanNotes). Default 2500. */
  maxCasesToScan?: number;
  /** Parallel /changes fetches per page batch. Default 10. */
  historyConcurrency?: number;
  /** auto = use index when complete; scan = live API only; index = require index. Default auto. */
  indexMode?: FieldHistoryIndexMode;
}

function displayNameToSystemName(name: string): string {
  return name
    .charAt(0)
    .toLowerCase()
    + name.slice(1).replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/\s+/g, '');
}

function systemDataTypeFromLayoutName(name: string): SystemFieldDataType | undefined {
  return SYSTEM_FIELD_NAME_MAP[name.trim().toLowerCase()];
}

/** Map tool `field` arg to history `changes[].field` path (same as testCaseHistory parser output). */
export function resolveHistoryFieldPath(
  fieldInput: string,
  fieldsLayout: FieldsLayout,
): ResolvedHistoryField {
  const trimmed = fieldInput.trim();
  if (!trimmed) {
    throw new Error('field is required');
  }

  if (trimmed.startsWith('customField.')) {
    return { historyField: trimmed, displayLabel: trimmed };
  }

  const compact = trimmed.toLowerCase().replace(/[\s_-]+/g, '');
  const topLevel: Record<string, string> = {
    automationstate: 'automationState',
    deprecated: 'deprecated',
    steps: 'steps',
    preconditions: 'preConditions',
    postconditions: 'postConditions',
    title: 'title',
    priority: 'priority',
    draft: 'draft',
    isautomated: 'isAutomated',
  };
  if (topLevel[compact]) {
    return { historyField: topLevel[compact], displayLabel: trimmed };
  }

  const systemType = SYSTEM_FIELD_NAME_MAP[trimmed.toLowerCase()];
  if (systemType === 'AUTOMATION_STATE') {
    return { historyField: 'automationState', displayLabel: 'Automation State' };
  }
  if (systemType === 'MANUAL_ONLY') {
    const manualOnly = findManualOnlyField(fieldsLayout);
    const systemName = manualOnly ? displayNameToSystemName(manualOnly.name) : 'manualOnly';
    return {
      historyField: `customField.${systemName}`,
      displayLabel: manualOnly?.name ?? 'Manual Only',
    };
  }

  const layoutItem = fieldsLayout.fields.find(
    f => f.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  if (!layoutItem) {
    throw new Error(
      `Field "${fieldInput}" not found in project fields-layout. ` +
      'Use a display name (e.g. "Manual Only"), automationState, or customField.<systemName>.',
    );
  }

  const layoutSystemType = systemDataTypeFromLayoutName(layoutItem.name);
  if (layoutItem.type === 'SYSTEM' && layoutSystemType === 'AUTOMATION_STATE') {
    return { historyField: 'automationState', displayLabel: layoutItem.name };
  }
  if (layoutSystemType === 'MANUAL_ONLY' || layoutItem.name.trim().toLowerCase() === 'manual only') {
    const manualOnly = findManualOnlyField(fieldsLayout) ?? layoutItem;
    const systemName = displayNameToSystemName(manualOnly.name);
    return {
      historyField: `customField.${systemName}`,
      displayLabel: manualOnly.name,
    };
  }

  if (layoutItem.type === 'SYSTEM') {
    const mapped = layoutSystemType?.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (mapped && topLevel[mapped.replace(/[^a-z]/g, '')]) {
      return { historyField: topLevel[mapped.replace(/[^a-z]/g, '')], displayLabel: layoutItem.name };
    }
  }

  const systemName = displayNameToSystemName(layoutItem.name);
  return {
    historyField: `customField.${systemName}`,
    displayLabel: layoutItem.name,
  };
}

/** Normalize audit values for comparison (Yes/No ↔ id:1/id:0, case-insensitive). */
export function normalizeHistoryCompareValue(value: string | undefined): string {
  if (value == null) return '';
  const v = String(value).trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower === 'yes' || lower === 'id:1' || lower === 'true' || lower === '1') return 'yes';
  if (lower === 'no' || lower === 'id:0' || lower === 'false' || lower === '0') return 'no';
  return lower;
}

export function historyValuesMatch(expected: string | undefined, actual: string): boolean {
  if (expected == null || expected === '') return true;
  return normalizeHistoryCompareValue(expected) === normalizeHistoryCompareValue(actual);
}

function parseOptionalDate(iso?: string, label?: string): Date | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label ?? 'date'}: "${iso}"`);
  }
  return d;
}

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

/** Pure scan over parsed history entries (unit-testable). */
export function scanHistoryForFieldChanges(
  entries: HistoryEntry[],
  options: {
    historyField: string;
    fromValue?: string;
    toValue?: string;
    changedAfter?: Date;
    changedBefore?: Date;
  },
): Array<{
  timestamp: string;
  author: string;
  oldValue: string;
  newValue: string;
  concurrentChanges: Array<{ field: string; oldValue: string; newValue: string }>;
}> {
  const out: Array<{
    timestamp: string;
    author: string;
    oldValue: string;
    newValue: string;
    concurrentChanges: Array<{ field: string; oldValue: string; newValue: string }>;
  }> = [];

  for (const entry of entries) {
    if (!entryInDateRange(entry.timestamp, options.changedAfter, options.changedBefore)) {
      continue;
    }

    for (const change of entry.changes) {
      if (change.field !== options.historyField) continue;
      if (!historyValuesMatch(options.fromValue, change.oldValue)) continue;
      if (!historyValuesMatch(options.toValue, change.newValue)) continue;

      out.push({
        timestamp: entry.timestamp,
        author: entry.author,
        oldValue: change.oldValue,
        newValue: change.newValue,
        concurrentChanges: entry.changes
          .filter(c => c !== change)
          .map(c => ({
            field: c.subField ? `${c.field}[${c.stepIndex ?? 0}].${c.subField}` : c.field,
            oldValue: c.oldValue,
            newValue: c.newValue,
          })),
      });
    }
  }

  return out;
}

/**
 * Skip history fetch when the case could not have changed since `changedAfter`.
 * `lastModifiedAt` is not RQL-filterable; this is a safe client-side prefilter only.
 * Cases without lastModifiedAt are still scanned (conservative).
 */
export function caseLikelyChangedSince(
  testCase: { lastModifiedAt?: string },
  changedAfter?: Date,
): boolean {
  if (!changedAfter) return true;
  if (!testCase.lastModifiedAt) return true;
  const modified = new Date(testCase.lastModifiedAt);
  if (Number.isNaN(modified.getTime())) return true;
  return modified >= changedAfter;
}

function buildRqlSuiteFilter(
  suiteId: number | undefined,
  rootSuiteId: number | undefined,
  allSuites: ZebrunnerTestSuite[],
): string | undefined {
  if (suiteId != null) {
    return `testSuite.id = ${suiteId}`;
  }
  if (rootSuiteId != null) {
    const ids = expandSuiteIds(allSuites, [rootSuiteId], [], true);
    if (ids.length === 0) return `testSuite.id = ${rootSuiteId}`;
    return `testSuite.id IN [${ids.join(', ')}]`;
  }
  return undefined;
}

export interface FieldHistorySearchDeps {
  client: EnhancedZebrunnerClient;
  reportingClient: ZebrunnerReportingClient;
  getFieldsLayout: (projectId: number) => Promise<FieldsLayout>;
  debugLog?: (message: string, data?: Record<string, unknown>) => void;
}

export async function findFieldHistoryChanges(
  deps: FieldHistorySearchDeps,
  options: FindFieldHistoryChangesOptions,
): Promise<FindFieldHistoryChangesResult> {
  const {
    projectKey,
    projectId,
    field,
    fromValue,
    toValue,
    changedAfter,
    changedBefore,
    suiteId,
    rootSuiteId,
    includeCaseSummary = true,
    maxResults = 100,
    historyLimit = 100,
    maxCasesToScan = 2500,
    historyConcurrency = 10,
  } = options;

  const changedAfterDate = parseOptionalDate(changedAfter, 'changed_after');
  const changedBeforeDate = parseOptionalDate(changedBefore, 'changed_before');

  const fieldsLayout = await deps.getFieldsLayout(projectId);
  const resolved = resolveHistoryFieldPath(field, fieldsLayout);

  const indexMode = options.indexMode ?? 'auto';
  let suiteIdsForIndex: number[] | undefined;
  if (rootSuiteId != null) {
    const allSuites = await deps.client.getAllTestSuites(projectKey);
    suiteIdsForIndex = expandSuiteIds(allSuites, [rootSuiteId], [], true);
  }

  if (indexMode !== 'scan') {
    const index = loadHistoryIndex(projectKey);
    if (index && isIndexUsable(index.meta, projectId)) {
      const indexed = queryHistoryIndex(index, {
        historyField: resolved.historyField,
        fromValue,
        toValue,
        changedAfter: changedAfterDate,
        changedBefore: changedBeforeDate,
        suiteId,
        rootSuiteId,
        suiteIds: suiteIdsForIndex,
        maxResults,
        includeCaseSummary,
      });
      return {
        project: projectKey,
        field: resolved.historyField,
        fieldLabel: resolved.displayLabel,
        matches: indexed.matches,
        casesScanned: index.meta.totalCasesIndexed,
        matchCount: indexed.matchCount,
        stoppedEarly: indexed.matchCount >= maxResults,
        indexUsed: true,
        indexComplete: indexed.indexComplete,
        scanNotes: [
          `Queried local history index at ${indexed.indexBuiltAt} ` +
          `(${index.meta.totalCasesIndexed} cases indexed).`,
        ],
      };
    }
    if (indexMode === 'index') {
      throw new Error(
        'History index is missing or incomplete for this project. ' +
        'Run adv_build_field_history_index (repeat until complete=true) or use index_mode=scan.',
      );
    }
  }

  let rqlFilter: string | undefined;
  if (suiteId != null || rootSuiteId != null) {
    const allSuites = await deps.client.getAllTestSuites(projectKey);
    rqlFilter = buildRqlSuiteFilter(suiteId, rootSuiteId, allSuites);
  }

  const statesMap: AutomationStatesMap = await (async () => {
    try {
      const states = await deps.reportingClient.getAutomationStates(projectId);
      return Object.fromEntries(states.map(s => [s.id, s.name]));
    } catch {
      return {};
    }
  })();

  const matches: FieldHistoryChangeMatch[] = [];
  let stoppedEarly = false;
  const scanNotes: string[] = [];
  let casesScanned = 0;
  let casesSkippedByModified = 0;
  let pagesTraversed = 0;
  let hasMorePages = false;

  const pageSize = 100;
  const maxPages = 100;
  let pageToken: string | undefined;

  async function scanCase(tc: ZebrunnerShortTestCase): Promise<void> {
    if (matches.length >= maxResults) {
      stoppedEarly = true;
      return;
    }
    if (casesScanned >= maxCasesToScan) {
      stoppedEarly = true;
      return;
    }

    casesScanned++;

    const historyResults = await enrichTestCasesWithHistory(
      [tc],
      deps.reportingClient,
      projectId,
      statesMap,
      { filter: 'all', maxResults: historyLimit },
    );

    const entryMatches = scanHistoryForFieldChanges(historyResults[0] ?? [], {
      historyField: resolved.historyField,
      fromValue,
      toValue,
      changedAfter: changedAfterDate,
      changedBefore: changedBeforeDate,
    });

    for (const m of entryMatches) {
      if (matches.length >= maxResults) {
        stoppedEarly = true;
        return;
      }
      matches.push({
        key: tc.key ?? String(tc.id),
        ...(includeCaseSummary
          ? {
            title: tc.title,
            currentAutomationState: tc.automationState?.name,
          }
          : {}),
        timestamp: m.timestamp,
        author: m.author,
        oldValue: m.oldValue,
        newValue: m.newValue,
        concurrentChanges: m.concurrentChanges,
      });
    }
  }

  async function scanBatch(batch: ZebrunnerShortTestCase[]): Promise<void> {
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(historyConcurrency, Math.max(batch.length, 1)) },
      async () => {
        while (!stoppedEarly && matches.length < maxResults && casesScanned < maxCasesToScan) {
          const index = nextIndex++;
          if (index >= batch.length) return;
          await scanCase(batch[index]!);
        }
      },
    );
    await Promise.all(workers);
  }

  while (pagesTraversed < maxPages && !stoppedEarly && matches.length < maxResults) {
    const response = await deps.client.getTestCases(projectKey, {
      size: pageSize,
      filter: rqlFilter,
      pageToken,
    });
    pagesTraversed++;

    const pageItems = (response.items ?? []).filter(
      (tc): tc is ZebrunnerShortTestCase => tc.id != null && !tc.deleted,
    );

    const candidates: ZebrunnerShortTestCase[] = [];
    for (const tc of pageItems) {
      if (caseLikelyChangedSince(tc, changedAfterDate)) {
        candidates.push(tc);
      } else {
        casesSkippedByModified++;
      }
    }

    if (candidates.length > 0) {
      await scanBatch(candidates);
    }

    deps.debugLog?.('Field history scan page', {
      pagesTraversed,
      pageItems: pageItems.length,
      candidates: candidates.length,
      casesScanned,
      matchCount: matches.length,
      skippedByModified: casesSkippedByModified,
    });

    const nextToken = response._meta?.nextPageToken;
    if (!nextToken || pageItems.length === 0) {
      break;
    }
    if (casesScanned >= maxCasesToScan || matches.length >= maxResults) {
      if (nextToken) {
        hasMorePages = true;
      }
      break;
    }
    pageToken = nextToken;
  }

  if (pagesTraversed >= maxPages && pageToken) {
    hasMorePages = true;
  }

  if (hasMorePages) {
    scanNotes.push(
      `Scan stopped before all project pages were read (casesScanned=${casesScanned}). ` +
      'Narrow with suite_id/root_suite_id or raise max_cases_to_scan.',
    );
  }
  if (casesScanned >= maxCasesToScan && matches.length < maxResults) {
    scanNotes.push(
      `Reached max_cases_to_scan=${maxCasesToScan} before finding ${maxResults} matches. ` +
      'Results may be incomplete — add suite_id/root_suite_id or raise max_cases_to_scan.',
    );
  }
  if (casesSkippedByModified > 0 && changedAfterDate) {
    scanNotes.push(
      `Skipped ${casesSkippedByModified} case(s) with lastModifiedAt before changed_after (client prefilter).`,
    );
  }

  return {
    project: projectKey,
    field: resolved.historyField,
    fieldLabel: resolved.displayLabel,
    matches,
    casesScanned,
    matchCount: matches.length,
    stoppedEarly,
    indexUsed: false,
    ...(scanNotes.length > 0 ? { scanNotes } : {}),
  };
}

/** Fields commonly present in TCM audit history for a project (for future list_supported_history_fields). */
export function listCommonHistoryFields(fieldsLayout: FieldsLayout): string[] {
  const fields = [
    'automationState',
    'deprecated',
    'steps',
    'preConditions',
    'postConditions',
    'title',
    'priority',
  ];
  for (const item of fieldsLayout.fields) {
    if (item.type === 'CUSTOM' && item.enabled) {
      fields.push(`customField.${displayNameToSystemName(item.name)}`);
    }
  }
  return [...new Set(fields)];
}
