import type { ZebrunnerReportingClient } from "../api/reporting-client.js";
import type { LaunchJobParameter, LaunchJobParametersResponse } from "../types/reporting.js";

/** Shown in tool docs and preview — Build Now is Jenkins-only, not Launch Launchers. */
export const START_LAUNCH_JENKINS_ONLY_NOTE =
  "Jenkins integration only (Zebrunner Build Now). Does NOT work with Launch Launchers.";

export interface JobSummary {
  suitePath: string | null;
  buildDefault: string | null;
  localeDefault: string | null;
  testRunRulesDefault: string | null;
  visibleParameters: { name: string; parameterClass: string; value: string | boolean | null | undefined }[];
}

export interface ResolvedTemplateLaunch {
  launchId: number;
  launchName: string;
  suitePath: string | null;
  jobParameters: LaunchJobParametersResponse;
}

export interface TemplateResolveOptions {
  launchId?: number;
  templateQuery?: string;
  launchName?: string;
  suitePath?: string;
  maxTemplateSearch?: number;
}

function paramValue(items: LaunchJobParameter[], name: string): string | null {
  const p = items.find((i) => i.name === name);
  if (p?.value == null) return null;
  return String(p.value);
}

export function extractJobSummary(items: LaunchJobParameter[]): JobSummary {
  const visibleParameters = items
    .filter((p) => p.parameterClass !== "HIDDEN")
    .map((p) => ({ name: p.name, parameterClass: p.parameterClass, value: p.value }));

  return {
    suitePath: paramValue(items, "suite"),
    buildDefault: paramValue(items, "build"),
    localeDefault: paramValue(items, "locale"),
    testRunRulesDefault: paramValue(items, "test_run_rules"),
    visibleParameters,
  };
}

export function mergeJobParameters(
  paramDefs: LaunchJobParameter[],
  overrides: Record<string, string | boolean | number | undefined>
): Record<string, string | boolean> {
  const validNames = new Set(paramDefs.map((p) => p.name));
  const unknownKeys = Object.keys(overrides).filter((k) => overrides[k] !== undefined && !validNames.has(k));
  if (unknownKeys.length > 0) {
    const available = [...validNames].sort().join(", ");
    throw new Error(
      `Unknown job parameter(s): ${unknownKeys.join(", ")}. Available parameters: ${available}`
    );
  }

  const payload: Record<string, string | boolean> = {};
  for (const param of paramDefs) {
    const override = overrides[param.name];
    let raw = override !== undefined ? override : param.value;

    if (param.parameterClass === "BOOLEAN") {
      if (raw === true || raw === "true" || raw === "1") {
        payload[param.name] = true;
      } else if (raw === false || raw === "false" || raw === "0") {
        payload[param.name] = false;
      } else {
        payload[param.name] = false;
      }
    } else {
      payload[param.name] = raw == null ? "" : String(raw);
    }
  }
  return payload;
}

export function buildParameterOverrides(
  args: {
    build?: string;
    locale?: string;
    test_run_rules?: string;
    parameters?: Record<string, string | boolean>;
  }
): Record<string, string | boolean | undefined> {
  const overrides: Record<string, string | boolean | undefined> = { ...(args.parameters ?? {}) };
  if (args.build !== undefined) overrides.build = args.build;
  if (args.locale !== undefined) overrides.locale = args.locale;
  if (args.test_run_rules !== undefined) overrides.test_run_rules = args.test_run_rules;
  return overrides;
}

function matchesTemplateQuery(launchName: string, query: string): boolean {
  return launchName.toLowerCase().includes(query.toLowerCase());
}

function getSuitePathFromParams(params: LaunchJobParametersResponse): string | null {
  return paramValue(params.items, "suite");
}

async function tryLaunchAsTemplate(
  client: ZebrunnerReportingClient,
  launchId: number,
  launchName: string,
  projectId: number,
  options: TemplateResolveOptions
): Promise<ResolvedTemplateLaunch | null> {
  try {
    const jobParameters = await client.getLaunchJobParameters(launchId, projectId);
    const suitePath = getSuitePathFromParams(jobParameters);

    const query = options.templateQuery ?? options.launchName;
    if (query && !matchesTemplateQuery(launchName, query)) {
      return null;
    }
    if (options.suitePath && suitePath !== options.suitePath) {
      return null;
    }

    return { launchId, launchName, suitePath, jobParameters };
  } catch {
    return null;
  }
}

export async function resolveTemplateLaunch(
  client: ZebrunnerReportingClient,
  projectId: number,
  options: TemplateResolveOptions
): Promise<ResolvedTemplateLaunch> {
  const maxSearch = options.maxTemplateSearch ?? 20;

  if (options.launchId != null) {
    const launch = await client.getLaunch(options.launchId, projectId);
    const jobParameters = await client.getLaunchJobParameters(options.launchId, projectId);
    const suitePath = getSuitePathFromParams(jobParameters);
    return {
      launchId: options.launchId,
      launchName: launch.name,
      suitePath,
      jobParameters,
    };
  }

  const query = options.templateQuery ?? options.launchName;
  const candidates: { id: number; name: string; startedAt?: number; isLaunchAgainPossible?: boolean }[] = [];
  let page = 1;
  const pageSize = 100;

  while (candidates.length < maxSearch * 3) {
    const data = await client.getLaunches(projectId, {
      page,
      pageSize,
      query: query || undefined,
    });

    for (const launch of data.items) {
      if (launch.isLaunchAgainPossible === false) continue;
      candidates.push({
        id: launch.id,
        name: launch.name,
        startedAt: launch.startedAt,
        isLaunchAgainPossible: launch.isLaunchAgainPossible,
      });
    }

    if (page >= data._meta.totalPages || data.items.length === 0) break;
    page++;
  }

  candidates.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  let checked = 0;
  for (const candidate of candidates) {
    if (checked >= maxSearch) break;
    checked++;
    const resolved = await tryLaunchAsTemplate(
      client,
      candidate.id,
      candidate.name,
      projectId,
      options
    );
    if (resolved) return resolved;
  }

  const parts: string[] = [];
  if (query) parts.push(`query="${query}"`);
  if (options.suitePath) parts.push(`suite_path="${options.suitePath}"`);
  throw new Error(
    `No template launch found${parts.length ? ` for ${parts.join(", ")}` : ""}. ` +
    `Provide launch_id explicitly or broaden template_query / suite_path.`
  );
}

export function formatParameterDiff(
  paramDefs: LaunchJobParameter[],
  merged: Record<string, string | boolean>,
  keys: string[] = ["build", "locale", "test_run_rules"]
): string[] {
  const lines: string[] = [];
  for (const key of keys) {
    const def = paramDefs.find((p) => p.name === key);
    if (!def) continue;
    const defaultVal = def.value == null ? "" : String(def.value);
    const mergedVal = String(merged[key] ?? "");
    const changed = defaultVal !== mergedVal;
    lines.push(`  ${key}: ${mergedVal}${changed ? ` (default: ${defaultVal})` : " (unchanged)"}`);
  }
  return lines;
}
