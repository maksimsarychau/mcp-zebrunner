/**
 * Configuration loader for instance-specific Zebrunner settings.
 *
 * Resolution priority (highest wins):
 *   1. ZEBRUNNER_CONFIG_JSON env var  (inline JSON string)
 *   2. /config/zebrunner-config.json  (Docker volume mount)
 *   3. ZEBRUNNER_CONFIG_PATH env var  (custom absolute path)
 *   4. CWD/zebrunner-config.json      (local dev / repo root)
 *   5. Built-in DEFAULTS              (fallback)
 *
 * Falls back to built-in defaults when all sources are missing or invalid.
 * Individual keys that are missing or malformed fall back independently.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ZebrunnerConfigSchema = z.object({
  projectAliases: z.record(z.string(), z.string()).optional(),
  testConnectionProjectKey: z.string().optional(),
  widgetTemplates: z.object({
    RESULTS_BY_PLATFORM: z.number().int().positive(),
    TOP_BUGS: z.number().int().positive(),
    BUG_REVIEW: z.number().int().positive(),
    FAILURE_INFO: z.number().int().positive(),
    FAILURE_DETAILS: z.number().int().positive(),
  }).partial().optional(),
  dashboardNames: z.object({
    weeklyResults: z.string(),
    bugsReproRate: z.string(),
  }).partial().optional(),
  platformMap: z.record(z.string(), z.array(z.string())).optional(),
  featureAreaKeywords: z.record(z.string(), z.string()).optional(),
}).strict().partial();

export type ZebrunnerConfig = z.infer<typeof ZebrunnerConfigSchema>;

// ---------------------------------------------------------------------------
// Built-in defaults (shipped with the MCP server)
// ---------------------------------------------------------------------------

const DEFAULTS: Required<{
  projectAliases: Record<string, string>;
  testConnectionProjectKey: string;
  widgetTemplates: { RESULTS_BY_PLATFORM: number; TOP_BUGS: number; BUG_REVIEW: number; FAILURE_INFO: number; FAILURE_DETAILS: number };
  dashboardNames: { weeklyResults: string; bugsReproRate: string };
  platformMap: Record<string, string[]>;
  featureAreaKeywords: Record<string, string>;
}> = {
  projectAliases: {
    web: "MFPWEB",
    android: "MFPAND",
    ios: "MFPIOS",
    api: "MFPWEB",
  },
  testConnectionProjectKey: "MCP",
  widgetTemplates: {
    RESULTS_BY_PLATFORM: 8,
    TOP_BUGS: 4,
    BUG_REVIEW: 9,
    FAILURE_INFO: 6,
    FAILURE_DETAILS: 10,
  },
  dashboardNames: {
    weeklyResults: "Weekly results",
    bugsReproRate: "Bugs repro rate",
  },
  platformMap: {
    web: [],
    api: ["api"],
    android: [],
    ios: ["ios"],
  },
  featureAreaKeywords: {
    quicklog: "Search & Quick Log",
    search: "Search & Quick Log",
    notification: "Notifications",
    meal: "Meal Management",
    message: "Messages",
    goal: "Goals",
    dashboard: "Dashboard",
    premium: "Premium Features",
    export: "Export",
  },
};

// ---------------------------------------------------------------------------
// Resolved config type (all fields guaranteed present)
// ---------------------------------------------------------------------------

export interface ResolvedConfig {
  projectAliases: Record<string, string>;
  testConnectionProjectKey: string;
  widgetTemplates: {
    RESULTS_BY_PLATFORM: number;
    TOP_BUGS: number;
    BUG_REVIEW: number;
    FAILURE_INFO: number;
    FAILURE_DETAILS: number;
  };
  dashboardNames: {
    weeklyResults: string;
    bugsReproRate: string;
  };
  platformMap: Record<string, string[]>;
  featureAreaKeywords: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

let _cached: ResolvedConfig | null = null;

const DOCKER_CONFIG_PATH = "/config/zebrunner-config.json";

function parseAndValidate(json: unknown, source: string): ZebrunnerConfig | null {
  const parsed = ZebrunnerConfigSchema.safeParse(json);
  if (parsed.success) {
    console.error(`[config] Loaded zebrunner-config.json from ${source}`);
    return parsed.data;
  }
  console.error(
    `[config] zebrunner-config.json from ${source} has validation errors — using defaults for invalid fields:`,
    parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
  );
  const partial: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (typeof json === 'object' && json !== null && key in json && (json as any)[key] !== undefined) {
      partial[key] = (json as any)[key];
    }
  }
  return partial as ZebrunnerConfig;
}

function loadFromDisk(): ZebrunnerConfig | null {
  // Priority 1: ZEBRUNNER_CONFIG_JSON env var (inline JSON, no file I/O)
  const envJson = process.env.ZEBRUNNER_CONFIG_JSON;
  if (envJson) {
    try {
      const json = JSON.parse(envJson);
      return parseAndValidate(json, "ZEBRUNNER_CONFIG_JSON env var");
    } catch (err: any) {
      console.error(`[config] ZEBRUNNER_CONFIG_JSON env var contains invalid JSON: ${err?.message}`);
    }
  }

  // Priority 2+: File-based resolution
  const candidates: string[] = [];

  // Priority 2: Docker volume mount path
  candidates.push(DOCKER_CONFIG_PATH);

  // Priority 3: ZEBRUNNER_CONFIG_PATH env var (custom absolute path)
  const envPath = process.env.ZEBRUNNER_CONFIG_PATH;
  if (envPath) {
    candidates.unshift(resolve(envPath));
  }

  // Priority 4: CWD-based paths (existing behavior)
  candidates.push(
    resolve(process.cwd(), "zebrunner-config.json"),
    resolve(import.meta.dirname ?? process.cwd(), "../../zebrunner-config.json"),
  );

  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue;
      const raw = readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      return parseAndValidate(json, filePath);
    } catch {
      // File isn't valid JSON or unreadable — try next
    }
  }

  return null;
}

function mergeConfig(overrides: ZebrunnerConfig | null): ResolvedConfig {
  if (!overrides) return { ...DEFAULTS };

  return {
    projectAliases: overrides.projectAliases
      ? { ...DEFAULTS.projectAliases, ...overrides.projectAliases }
      : { ...DEFAULTS.projectAliases },
    testConnectionProjectKey: overrides.testConnectionProjectKey ?? DEFAULTS.testConnectionProjectKey,
    widgetTemplates: {
      ...DEFAULTS.widgetTemplates,
      ...(overrides.widgetTemplates ?? {}),
    },
    dashboardNames: {
      ...DEFAULTS.dashboardNames,
      ...(overrides.dashboardNames ?? {}),
    },
    platformMap: overrides.platformMap
      ? { ...DEFAULTS.platformMap, ...overrides.platformMap }
      : { ...DEFAULTS.platformMap },
    featureAreaKeywords: overrides.featureAreaKeywords
      ? { ...DEFAULTS.featureAreaKeywords, ...overrides.featureAreaKeywords }
      : { ...DEFAULTS.featureAreaKeywords },
  };
}

/**
 * Returns the resolved configuration, loading from disk on first call.
 * Subsequent calls return the cached result.
 */
export function getConfig(): ResolvedConfig {
  if (!_cached) {
    const overrides = loadFromDisk();
    _cached = mergeConfig(overrides);
  }
  return _cached;
}

/**
 * Force-reload configuration from disk (useful for tests).
 */
export function reloadConfig(): ResolvedConfig {
  _cached = null;
  return getConfig();
}
