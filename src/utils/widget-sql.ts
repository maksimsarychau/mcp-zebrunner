/**
 * Shared SQL widget caller and parameter builder.
 *
 * Extracted from server.ts so that both tool handlers and the
 * dashboard handler can call Zebrunner reporting widget SQL endpoints.
 */

import { getConfig } from "./config-loader.js";
import {
  resolveWidgetPeriodParams,
  type WidgetPeriodInput,
} from "./widget-period.js";

export { extractResolvedPeriodLabel } from "./widget-period.js";
export type { WidgetPeriodInput } from "./widget-period.js";

export const ALL_PERIODS = [
  "Today",
  "Last 24 Hours",
  "Week",
  "Last 7 Days",
  "Last 14 Days",
  "Month",
  "Last 30 Days",
  "Quarter",
  "Last 90 Days",
  "Year",
  "Last 365 Days",
  "Total"
] as const;

export type Period = (typeof ALL_PERIODS)[number];

export function getPlatformMap(): Record<string, string[]> {
  return getConfig().platformMap;
}

export function getTemplate() {
  return getConfig().widgetTemplates;
}

/** @deprecated Use getPlatformMap() for dynamic config. Kept for backward compat. */
export const PLATFORM_MAP: Record<string, string[]> = {
  web: [],
  api: ["api"],
  android: [],
  ios: ["ios"]
};

/** @deprecated Use getTemplate() for dynamic config. Kept for backward compat. */
export const TEMPLATE = {
  RESULTS_BY_PLATFORM: 8,
  TOP_BUGS: 4,
  BUG_REVIEW: 9,
  FAILURE_INFO: 6,
  FAILURE_DETAILS: 10
} as const;

export function buildParamsConfig(opts: {
  period: string;
  platform?: string | string[];
  browser?: string[];
  milestone?: string[];
  dashboardName?: string;
  periodInput?: WidgetPeriodInput;
  extra?: Partial<Record<string, any>>;
}) {
  const { period, platform, browser = [], milestone = [], dashboardName, periodInput, extra = {} } = opts;

  const periodParams = periodInput
    ? resolveWidgetPeriodParams({ ...periodInput, period: periodInput.period ?? period }, period)
    : resolveWidgetPeriodParams({ period }, period);

  const cfg = getConfig();
  const pMap = cfg.platformMap;
  const resolvedPlatform: string[] =
    Array.isArray(platform)
      ? platform
      : platform
      ? (pMap[platform] ?? [])
      : [];

  const base: Record<string, unknown> = {
    BROWSER: browser,
    DEFECT: [], APPLICATION: [], BUILD: [], PRIORITY: [],
    RUN: [], USER: [], ENV: [], MILESTONE: milestone,
    PLATFORM: resolvedPlatform,
    STATUS: [], LOCALE: [],
    PERIOD: periodParams.PERIOD,
    dashboardName: dashboardName ?? cfg.dashboardNames.weeklyResults,
    isReact: true,
    ...extra,
  };

  if (periodParams.PERIOD === 'ABSOLUTE' || periodParams.PERIOD === 'DYNAMIC') {
    base.periodStartDate = periodParams.periodStartDate;
    base.periodEndDate = periodParams.periodEndDate;
    base.periodStartExpression = periodParams.periodStartExpression;
    base.periodEndExpression = periodParams.periodEndExpression;
  }

  return base;
}

/** Params for BUG_REVIEW widget (template 9). */
export function buildBugReviewParamsConfig(opts: {
  period: string;
  periodInput?: WidgetPeriodInput;
  dashboardName?: string;
}) {
  const periodParams = resolveWidgetPeriodParams(
    { ...opts.periodInput, period: opts.periodInput?.period ?? opts.period },
    opts.period,
  );

  const base: Record<string, unknown> = {
    BROWSER: [],
    DEFECT: [],
    APPLICATION: [],
    BUILD: [],
    PRIORITY: [],
    RUN: [],
    USER: [],
    ENV: [],
    MILESTONE: [],
    PLATFORM: [],
    STATUS: [],
    LOCALE: [],
    PERIOD: periodParams.PERIOD,
    ERROR_COUNT: "0",
    dashboardName: opts.dashboardName ?? "Bug review",
    isReact: true,
  };

  if (periodParams.PERIOD === 'ABSOLUTE' || periodParams.PERIOD === 'DYNAMIC') {
    base.periodStartDate = periodParams.periodStartDate;
    base.periodEndDate = periodParams.periodEndDate;
    base.periodStartExpression = periodParams.periodStartExpression;
    base.periodEndExpression = periodParams.periodEndExpression;
  }

  return base;
}

/** Params for FAILURE_INFO / FAILURE_DETAILS widgets (templates 6 & 10). */
export function buildFailureWidgetParamsConfig(opts: {
  period: string;
  periodInput?: WidgetPeriodInput;
  hashcode: string;
  dashboardName?: string;
}) {
  const periodParams = resolveWidgetPeriodParams(
    { ...opts.periodInput, period: opts.periodInput?.period ?? opts.period },
    opts.period,
  );

  const base: Record<string, unknown> = {
    PERIOD: periodParams.PERIOD,
    dashboardName: opts.dashboardName ?? "Failures analysis",
    hashcode: opts.hashcode,
    isReact: true,
  };

  if (periodParams.PERIOD === 'ABSOLUTE' || periodParams.PERIOD === 'DYNAMIC') {
    base.periodStartDate = periodParams.periodStartDate;
    base.periodEndDate = periodParams.periodEndDate;
    base.periodStartExpression = periodParams.periodStartExpression;
    base.periodEndExpression = periodParams.periodEndExpression;
  }

  return base;
}

export type WidgetSqlCaller = (
  projectId: number,
  templateId: number,
  paramsConfig: any
) => Promise<any>;

export interface WidgetStatusCounts {
  passed: number;
  failed: number;
  skipped: number;
  knownIssue: number;
  aborted: number;
}

const EMPTY_STATUS_COUNTS: WidgetStatusCounts = {
  passed: 0,
  failed: 0,
  skipped: 0,
  knownIssue: 0,
  aborted: 0,
};

function findRowKey(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const hit = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

function classifyWidgetStatusLabel(label: string): keyof WidgetStatusCounts | null {
  const norm = label.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!norm || /^\d{4}-\d{2}-\d{2}/.test(norm)) return null;

  const exact: Record<string, keyof WidgetStatusCounts> = {
    passed: 'passed',
    failed: 'failed',
    skipped: 'skipped',
    aborted: 'aborted',
    'known issue': 'knownIssue',
    blocked: 'skipped',
    'in progress': 'knownIssue',
    queued: 'skipped',
  };
  if (exact[norm]) return exact[norm];

  if (norm.includes('known') || norm.includes('issue')) return 'knownIssue';
  if (norm.includes('pass')) return 'passed';
  if (norm.includes('fail')) return 'failed';
  if (norm.includes('skip')) return 'skipped';
  if (norm.includes('abort')) return 'aborted';
  if (norm.includes('block')) return 'skipped';
  return null;
}

/**
 * Parse RESULTS_BY_PLATFORM widget rows.
 * Zebrunner returns either:
 * - label/value pairs: [{ label: "PASSED", value: 1087 }, ...] (common with milestone filter)
 * - column-oriented rows: [{ PLATFORM: "Android", PASSED: 80, FAILED: 10 }, ...]
 * - GROUP_FIELD rows (template 3 priority breakdown): prefer GROUP_FIELD null totals row
 */
export function parseWidgetStatusCounts(rows: any[]): WidgetStatusCounts | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const first = rows[0];
  if (!first || typeof first !== 'object') return null;

  const groupFieldKey = findRowKey(first as Record<string, unknown>, ['GROUP_FIELD', 'group_field']);
  if (groupFieldKey) {
    const totalsRow = rows.find((row) => {
      if (!row || typeof row !== 'object') return false;
      const gf = (row as Record<string, unknown>)[groupFieldKey];
      return gf === null || gf === undefined || gf === '';
    });
    const sourceRows = totalsRow ? [totalsRow] : rows;
    return parseWidgetStatusCountsFromColumns(sourceRows);
  }

  const labelKey = findRowKey(first as Record<string, unknown>, ['label']);
  const valueKey = findRowKey(first as Record<string, unknown>, ['value']);

  if (labelKey && valueKey) {
    const counts = { ...EMPTY_STATUS_COUNTS };
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const label = String((row as Record<string, unknown>)[labelKey] ?? '').trim();
      const cat = classifyWidgetStatusLabel(label);
      if (!cat) continue;
      const raw = (row as Record<string, unknown>)[valueKey];
      const val = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10) || 0;
      counts[cat] += Math.max(0, val);
    }
    return counts;
  }

  return parseWidgetStatusCountsFromColumns(rows);
}

function parseWidgetStatusCountsFromColumns(rows: any[]): WidgetStatusCounts | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const first = rows[0];
  if (!first || typeof first !== 'object') return null;

  const counts = { ...EMPTY_STATUS_COUNTS };
  const allKeys = Object.keys(first);
  const columnMap = new Map<string, keyof WidgetStatusCounts>();

  for (const k of allKeys) {
    const cat = classifyWidgetStatusLabel(k);
    if (cat) columnMap.set(k, cat);
  }

  if (columnMap.size === 0) return null;

  for (const row of rows) {
    for (const [k, cat] of columnMap) {
      const raw = row[k];
      const val = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10) || 0;
      counts[cat] += Math.max(0, val);
    }
  }

  return counts;
}

/**
 * Unwrap common API response envelopes so callers always get the payload array.
 * Handles `{ results: [...] }`, `{ data: [...] }`, `{ items: [...] }`, and
 * `{ data: { results: [...] } }` shapes, returning the inner array.
 * If the response is already an array, it is returned as-is.
 */
function unwrapResponseEnvelope(raw: any): any {
  if (Array.isArray(raw)) return raw;

  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.results)) return raw.results;
    if (Array.isArray(raw.data)) return raw.data;
    if (Array.isArray(raw.items)) return raw.items;
    if (raw.data && typeof raw.data === 'object') {
      if (Array.isArray(raw.data.results)) return raw.data.results;
      if (Array.isArray(raw.data.items)) return raw.data.items;
    }
  }

  return raw;
}

/**
 * Create a callWidgetSql function bound to a specific base URL and auth provider.
 */
export function createWidgetSqlCaller(
  baseUrl: string,
  authenticate: () => Promise<string>
): WidgetSqlCaller {
  return async (projectId: number, templateId: number, paramsConfig: any): Promise<any> => {
    const bearerToken = await authenticate();
    const url = `${baseUrl}/api/reporting/v1/widget-templates/sql?projectId=${projectId}`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ templateId, paramsConfig })
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Widget SQL failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`);
    }

    const json = await res.json();
    const unwrapped = unwrapResponseEnvelope(json);

    if (!Array.isArray(unwrapped)) {
      console.error(
        `⚠️ [WidgetSQL] Unexpected response shape from templateId=${templateId}, projectId=${projectId}:`,
        `type=${typeof json}, keys=${json && typeof json === 'object' ? Object.keys(json).join(',') : 'N/A'}`
      );
    }

    return unwrapped;
  };
}
