/**
 * Test case change history: fetching, parsing, filtering, and enrichment.
 *
 * Consumes the TCM audit-log endpoint
 *   GET /api/tcm/v1/test-cases/{id}/changes?projectId={pid}&maxPageSize={n}
 * and transforms raw entries into structured HistoryEntry objects with
 * named lifecycle events and field-level diffs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HistoryFilter = 'steps_only' | 'events_only' | 'all';

/**
 * Named lifecycle events derived from test case changes.
 * Automation state events are generated dynamically as `became_<state_name>`
 * (e.g. "became_automated", "became_manual_only").
 */
export type NamedEvent =
  | `became_${string}`
  | 'became_deprecated'
  | 'became_undeprecated'
  | 'steps_changed'
  | 'preconditions_changed'
  | 'postconditions_changed';

export interface FieldChange {
  field: string;
  stepIndex?: number;
  subField?: 'action' | 'expectedResult' | 'full';
  oldValue: string;
  newValue: string;
}

export interface HistoryEntry {
  entryId: number;
  timestamp: string;
  author: string;
  events: NamedEvent[];
  changes: FieldChange[];
}

export interface HistoryOptions {
  filter: HistoryFilter;
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Raw API shapes
// ---------------------------------------------------------------------------

interface RawChangeEntry {
  id: number;
  instant: string;
  userId: number;
  type: string; // 'CREATE' | 'UPDATE' | 'LAYOUT_UPDATE'
  items: RawChangeItem[];
}

interface RawChangeItem {
  field: string;
  action: string;
  // Scalar shape
  oldValue?: any;
  newValue?: any;
  // Array shape (steps / preConditions / postConditions)
  oldValues?: StepValue[];
  newValues?: StepValue[];
}

interface StepValue {
  relativePosition: number;
  action: string;
  expectedResult: string;
  attachments?: any[];
}

// ---------------------------------------------------------------------------
// Automation state resolution (dynamically provided per-project)
// ---------------------------------------------------------------------------

/** Map from automation state ID → human-readable name, fetched from the API */
export type AutomationStatesMap = Record<number, string>;

/** Derive a named event from any automation state name. */
function stateNameToEvent(stateName: string): NamedEvent {
  return `became_${stateName.toLowerCase().replace(/\s+/g, '_')}` as NamedEvent;
}

// ---------------------------------------------------------------------------
// Inline concurrency limiter (avoids adding p-limit dependency)
// ---------------------------------------------------------------------------

const REQUEST_DELAY_MS = 100;

function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  function next() {
    if (queue.length > 0 && active < concurrency) {
      active++;
      queue.shift()!();
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        const delayed = () =>
          new Promise<void>(r => setTimeout(r, REQUEST_DELAY_MS)).then(fn);
        delayed().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
}

// ---------------------------------------------------------------------------
// Automation state resolution
// ---------------------------------------------------------------------------

function resolveAutomationStateName(
  stateValue: any,
  statesMap: AutomationStatesMap
): string | undefined {
  if (!stateValue) return undefined;

  if (typeof stateValue.name === 'string' && stateValue.name) {
    return stateValue.name;
  }

  const id = typeof stateValue === 'number' ? stateValue : stateValue?.id;
  if (typeof id === 'number' && Number.isFinite(id) && id > 0) {
    const name = statesMap[id];
    if (name) return name;
    console.error(
      `[history] Automation state ID ${id} not found in states map ` +
      `(known IDs: ${Object.keys(statesMap).join(', ') || 'none'}). ` +
      `The state name will be omitted from this change entry.`
    );
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Deprecated value resolution
// ---------------------------------------------------------------------------

function resolveDeprecatedValue(value: string): boolean | undefined {
  if (value === 'id:1') return true;
  if (value === 'id:0') return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Steps diff
// ---------------------------------------------------------------------------

const ARRAY_FIELDS = new Set(['steps', 'preConditions', 'postConditions']);

const ARRAY_FIELD_EVENT: Record<string, NamedEvent> = {
  steps: 'steps_changed',
  preConditions: 'preconditions_changed',
  postConditions: 'postconditions_changed',
};

function parseStepsDiff(
  field: string,
  oldValues: StepValue[] | undefined,
  newValues: StepValue[] | undefined
): FieldChange[] {
  const changes: FieldChange[] = [];
  const olds = oldValues ?? [];
  const news = newValues ?? [];

  if (field === 'preConditions' || field === 'postConditions') {
    const oldText = olds.map(v => `${v.action}\n${v.expectedResult}`.trim()).join('\n') || '';
    const newText = news.map(v => `${v.action}\n${v.expectedResult}`.trim()).join('\n') || '';
    if (oldText !== newText) {
      changes.push({ field, subField: 'full', oldValue: oldText, newValue: newText });
    }
    return changes;
  }

  // steps: diff by relativePosition
  const positions = new Set<number>();
  for (const v of olds) positions.add(v.relativePosition);
  for (const v of news) positions.add(v.relativePosition);

  for (const pos of positions) {
    const oldStep = olds.find(v => v.relativePosition === pos);
    const newStep = news.find(v => v.relativePosition === pos);

    if (!oldStep && newStep) {
      // Step added
      changes.push({
        field,
        stepIndex: pos,
        subField: 'action',
        oldValue: '',
        newValue: newStep.action || '',
      });
      if (newStep.expectedResult) {
        changes.push({
          field,
          stepIndex: pos,
          subField: 'expectedResult',
          oldValue: '',
          newValue: newStep.expectedResult,
        });
      }
    } else if (oldStep && !newStep) {
      // Step removed
      changes.push({
        field,
        stepIndex: pos,
        subField: 'action',
        oldValue: oldStep.action || '',
        newValue: '',
      });
      if (oldStep.expectedResult) {
        changes.push({
          field,
          stepIndex: pos,
          subField: 'expectedResult',
          oldValue: oldStep.expectedResult,
          newValue: '',
        });
      }
    } else if (oldStep && newStep) {
      if (oldStep.action !== newStep.action) {
        changes.push({
          field,
          stepIndex: pos,
          subField: 'action',
          oldValue: oldStep.action || '',
          newValue: newStep.action || '',
        });
      }
      if (oldStep.expectedResult !== newStep.expectedResult) {
        changes.push({
          field,
          stepIndex: pos,
          subField: 'expectedResult',
          oldValue: oldStep.expectedResult || '',
          newValue: newStep.expectedResult || '',
        });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Single change-item parsing
// ---------------------------------------------------------------------------

function parseChangeItem(
  item: RawChangeItem,
  statesMap: AutomationStatesMap
): { changes: FieldChange[]; events: NamedEvent[] } {
  const changes: FieldChange[] = [];
  const events: NamedEvent[] = [];

  if (item.action === 'FIELD_DISABLING') return { changes, events };

  // Array-shaped fields: steps, preConditions, postConditions
  if (ARRAY_FIELDS.has(item.field)) {
    const diffs = parseStepsDiff(item.field, item.oldValues, item.newValues);
    changes.push(...diffs);
    if (diffs.length > 0) {
      const event = ARRAY_FIELD_EVENT[item.field];
      if (event) events.push(event);
    }
    return { changes, events };
  }

  // automationState
  if (item.field === 'automationState') {
    const oldName = resolveAutomationStateName(item.oldValue, statesMap) ?? '';
    const newName = resolveAutomationStateName(item.newValue, statesMap) ?? '';
    changes.push({ field: 'automationState', oldValue: oldName, newValue: newName });
    if (newName) events.push(stateNameToEvent(newName));
    return { changes, events };
  }

  // customFields — check for deprecated (exact systemName match)
  if (item.field === 'customFields') {
    const systemName = item.newValue?.customField?.systemName
      ?? item.oldValue?.customField?.systemName;

    if (systemName === 'deprecated') {
      const oldVal = resolveDeprecatedValue(item.oldValue?.value ?? '');
      const newVal = resolveDeprecatedValue(item.newValue?.value ?? '');
      changes.push({
        field: 'deprecated',
        oldValue: oldVal === true ? 'true' : oldVal === false ? 'false' : String(item.oldValue?.value ?? ''),
        newValue: newVal === true ? 'true' : newVal === false ? 'false' : String(item.newValue?.value ?? ''),
      });
      if (newVal === true) events.push('became_deprecated');
      if (newVal === false) events.push('became_undeprecated');
      return { changes, events };
    }

    if (systemName && /deprecat/i.test(systemName) && systemName !== 'deprecated') {
      console.error(
        `[history] Custom field '${systemName}' looks like a deprecation field ` +
        `but does not match 'deprecated'. If this is your deprecated marker, ` +
        `test case deprecation events may not be detected.`
      );
    }

    const fieldName = `customField.${systemName ?? 'unknown'}`;
    changes.push({
      field: fieldName,
      oldValue: stringifyValue(item.oldValue?.value),
      newValue: stringifyValue(item.newValue?.value),
    });
    return { changes, events };
  }

  // All other scalar fields
  changes.push({
    field: item.field,
    oldValue: stringifyValue(item.oldValue),
    newValue: stringifyValue(item.newValue),
  });

  return { changes, events };
}

function stringifyValue(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

// ---------------------------------------------------------------------------
// Full entry parsing
// ---------------------------------------------------------------------------

function parseChangeEntry(
  raw: RawChangeEntry,
  statesMap: AutomationStatesMap,
  userMap: Map<number, string>
): HistoryEntry {
  const allChanges: FieldChange[] = [];
  const allEvents: NamedEvent[] = [];

  for (const item of raw.items ?? []) {
    const { changes, events } = parseChangeItem(item, statesMap);
    allChanges.push(...changes);
    allEvents.push(...events);
  }

  const author = userMap.get(raw.userId) ?? `userId:${raw.userId}`;

  return {
    entryId: raw.id,
    timestamp: raw.instant,
    author,
    events: [...new Set(allEvents)],
    changes: allChanges,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

const STEP_FIELDS = new Set(['steps', 'preConditions', 'postConditions', 'deprecated', 'automationState']);

function filterEntry(entry: HistoryEntry, filter: HistoryFilter): HistoryEntry | null {
  if (filter === 'all') return entry;

  if (filter === 'steps_only') {
    const filteredChanges = entry.changes.filter(c => STEP_FIELDS.has(c.field));
    const filteredEvents = entry.events.filter(e =>
      e === 'steps_changed' || e === 'preconditions_changed' || e === 'postconditions_changed'
    );
    if (filteredChanges.length === 0 && filteredEvents.length === 0) return null;
    return { ...entry, changes: filteredChanges, events: filteredEvents };
  }

  // events_only
  if (entry.events.length === 0) return null;
  return entry;
}

// ---------------------------------------------------------------------------
// Build user map from test case objects for best-effort author resolution
// ---------------------------------------------------------------------------

function buildUserMap(cases: any[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const tc of cases) {
    if (tc.createdBy?.id && tc.createdBy?.username) {
      map.set(tc.createdBy.id, tc.createdBy.username);
    }
    if (tc.lastModifiedBy?.id && tc.lastModifiedBy?.username) {
      map.set(tc.lastModifiedBy.id, tc.lastModifiedBy.username);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Fetch + parse for a single test case
// ---------------------------------------------------------------------------

async function fetchAndParseHistory(
  reportingClient: any,
  caseId: number,
  projectId: number,
  filter: HistoryFilter,
  maxResults: number,
  statesMap: AutomationStatesMap,
  userMap: Map<number, string>
): Promise<HistoryEntry[]> {
  const raw = await reportingClient.getTestCaseChanges(caseId, projectId, maxResults);
  const items: RawChangeEntry[] = raw?.items ?? raw ?? [];

  const entries: HistoryEntry[] = [];
  for (const rawEntry of items) {
    if (rawEntry.type === 'LAYOUT_UPDATE') continue;

    const parsed = parseChangeEntry(rawEntry, statesMap, userMap);
    const filtered = filterEntry(parsed, filter);
    if (filtered) entries.push(filtered);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Public API: enrich test cases with history
// ---------------------------------------------------------------------------

const CONCURRENCY = 5;
const BULK_WARNING_THRESHOLD = 20;

export async function enrichTestCasesWithHistory(
  cases: any[],
  reportingClient: any,
  projectId: number,
  automationStatesMap: AutomationStatesMap,
  opts: HistoryOptions
): Promise<HistoryEntry[][]> {
  const userMap = buildUserMap(cases);
  const limit = pLimit(CONCURRENCY);

  const results = await Promise.all(
    cases.map(tc =>
      limit(async () => {
        if (!tc.id) return [];
        try {
          return await fetchAndParseHistory(
            reportingClient,
            tc.id,
            projectId,
            opts.filter,
            opts.maxResults,
            automationStatesMap,
            userMap
          );
        } catch (err: any) {
          console.error(
            `[history] Failed to fetch history for test case ${tc.id} ` +
            `(project ${projectId}): ${err?.message ?? err}`
          );
          return [];
        }
      })
    )
  );

  return results;
}

export function getHistoryBulkWarning(caseCount: number): string | undefined {
  if (caseCount > BULK_WARNING_THRESHOLD) {
    return `Fetched history for ${caseCount} cases — consider using history_limit to reduce response size.`;
  }
  return undefined;
}
