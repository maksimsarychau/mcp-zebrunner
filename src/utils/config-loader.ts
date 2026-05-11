/**
 * Configuration loader for instance-specific Zebrunner settings.
 *
 * Reads zebrunner-config.json from the project root (or CWD) at startup.
 * Falls back to built-in defaults when the file is missing or invalid.
 * Individual keys that are missing or malformed fall back independently.
 */

import { readFileSync } from "fs";
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

function loadFromDisk(): ZebrunnerConfig | null {
  const candidates = [
    resolve(process.cwd(), "zebrunner-config.json"),
    resolve(import.meta.dirname ?? process.cwd(), "../../zebrunner-config.json"),
  ];

  for (const filePath of candidates) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const json = JSON.parse(raw);
      const parsed = ZebrunnerConfigSchema.safeParse(json);
      if (parsed.success) {
        console.error(`[config] Loaded zebrunner-config.json from ${filePath}`);
        return parsed.data;
      }
      console.error(
        `[config] zebrunner-config.json at ${filePath} has validation errors — using defaults for invalid fields:`,
        parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
      // Even if validation fails, try to use the raw JSON for valid fields
      const partial: Record<string, unknown> = {};
      for (const key of Object.keys(DEFAULTS)) {
        if (key in json && json[key] !== undefined) {
          partial[key] = json[key];
        }
      }
      return partial as ZebrunnerConfig;
    } catch {
      // File doesn't exist or isn't valid JSON at this path — try next
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
