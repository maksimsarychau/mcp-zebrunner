/**
 * Shared SQL widget caller and parameter builder.
 *
 * Extracted from server.ts so that both tool handlers and the
 * dashboard handler can call Zebrunner reporting widget SQL endpoints.
 */

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

export const PLATFORM_MAP: Record<string, string[]> = {
  web: [],
  api: ["api"],
  android: [],
  ios: ["ios"]
};

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

  const resolvedPlatform: string[] =
    Array.isArray(platform)
      ? platform
      : platform
      ? (PLATFORM_MAP[platform] ?? [])
      : [];

  return {
    BROWSER: browser,
    DEFECT: [], APPLICATION: [], BUILD: [], PRIORITY: [],
    RUN: [], USER: [], ENV: [], MILESTONE: milestone,
    PLATFORM: resolvedPlatform,
    STATUS: [], LOCALE: [],
    PERIOD: normalized,
    dashboardName: dashboardName ?? "Weekly results",
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
    return res.json();
  };
}
