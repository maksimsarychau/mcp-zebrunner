/**
 * Server-side scan for test-case field transitions in TCM change history.
 * Option 2 from the adv_find_field_history_changes spec: paginate cases internally,
 * fetch /changes per case, return only matching events (not full case payloads).
 */

import type { FieldsLayout } from '../api/reporting-client.js';
import type { ZebrunnerReportingClient } from '../api/reporting-client.js';
import type { EnhancedZebrunnerClient } from '../api/enhanced-client.js';
import type { ZebrunnerShortTestCase, ZebrunnerTestSuite } from '../types/core.js';
import { fetchAllTestCasePages } from './test-case-pagination.js';
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
}

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
  } = options;

  const changedAfterDate = parseOptionalDate(changedAfter, 'changed_after');
  const changedBeforeDate = parseOptionalDate(changedBefore, 'changed_before');

  const fieldsLayout = await deps.getFieldsLayout(projectId);
  const resolved = resolveHistoryFieldPath(field, fieldsLayout);

  let rqlFilter: string | undefined;
  if (suiteId != null || rootSuiteId != null) {
    const allSuites = await deps.client.getAllTestSuites(projectKey);
    rqlFilter = buildRqlSuiteFilter(suiteId, rootSuiteId, allSuites);
  }

  const pageResult = await fetchAllTestCasePages({
    fetchPage: (pageToken, pageSize) =>
      deps.client.getTestCases(projectKey, {
        size: pageSize,
        filter: rqlFilter,
        pageToken,
      }),
    pageSize: 100,
    debugLog: deps.debugLog,
  });

  const candidates = pageResult.items.filter(tc => tc.id != null && !tc.deleted);
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
  let nextIndex = 0;

  if (pageResult.hasMorePages) {
    scanNotes.push(
      `Pagination stopped after ${pageResult.pagesTraversed} pages (${pageResult.stoppedReason}); ` +
      'casesScanned may be incomplete.',
    );
  }

  const HISTORY_CONCURRENCY = 5;

  async function scanWorker(): Promise<void> {
    while (true) {
      if (matches.length >= maxResults) {
        stoppedEarly = true;
        return;
      }

      const index = nextIndex++;
      if (index >= candidates.length) return;

      const tc = candidates[index];

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
  }

  const workers = Array.from(
    { length: Math.min(HISTORY_CONCURRENCY, Math.max(candidates.length, 1)) },
    () => scanWorker(),
  );
  await Promise.all(workers);

  const casesScanned = Math.min(nextIndex, candidates.length);

  return {
    project: projectKey,
    field: resolved.historyField,
    fieldLabel: resolved.displayLabel,
    matches,
    casesScanned,
    matchCount: matches.length,
    stoppedEarly,
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
