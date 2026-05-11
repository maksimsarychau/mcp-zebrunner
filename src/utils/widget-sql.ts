/**
 * Shared SQL widget caller and parameter builder.
 *
 * Extracted from server.ts so that both tool handlers and the
 * dashboard handler can call Zebrunner reporting widget SQL endpoints.
 */

import { getConfig } from "./config-loader.js";

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
  extra?: Partial<Record<string, any>>;
}) {
  const { period, platform, browser = [], milestone = [], dashboardName, extra = {} } = opts;
  const normalized = ALL_PERIODS.find(p => p.toLowerCase() === period.toLowerCase());
  if (!normalized) {
    throw new Error(`Invalid period: ${period}. Allowed: ${ALL_PERIODS.join(", ")}`);
  }

  const cfg = getConfig();
  const pMap = cfg.platformMap;
  const resolvedPlatform: string[] =
    Array.isArray(platform)
      ? platform
      : platform
      ? (pMap[platform] ?? [])
      : [];

  return {
    BROWSER: browser,
    DEFECT: [], APPLICATION: [], BUILD: [], PRIORITY: [],
    RUN: [], USER: [], ENV: [], MILESTONE: milestone,
    PLATFORM: resolvedPlatform,
    STATUS: [], LOCALE: [],
    PERIOD: normalized,
    dashboardName: dashboardName ?? cfg.dashboardNames.weeklyResults,
    isReact: true,
    ...extra
  };
}

export type WidgetSqlCaller = (
  projectId: number,
  templateId: number,
  paramsConfig: any
) => Promise<any>;

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
