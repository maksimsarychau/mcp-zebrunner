import type { ResolvedConfig } from "./config-loader.js";

export type RelaunchFailuresSettings = ResolvedConfig["relaunchFailures"];

export function launchNameMatchesExcludePattern(name: string, patterns: readonly string[]): boolean {
  if (!name || patterns.length === 0) return false;
  const nameLower = name.toLowerCase();
  return patterns.some((pattern) => nameLower.includes(pattern.toLowerCase()));
}

export function formatLaunchExcludePatternsList(patterns: readonly string[]): string {
  if (patterns.length === 0) return "(none configured)";
  return patterns.map((p) => `"${p}"`).join(", ");
}

export function formatLaunchExcludeCheckDescription(patterns: readonly string[]): string {
  if (patterns.length === 0) {
    return "no launch name exclusions are configured in zebrunner-config.json";
  }
  if (patterns.length === 1) {
    return `launch.name contains ${formatLaunchExcludePatternsList(patterns)} (case-insensitive)`;
  }
  return `launch.name contains any of: ${formatLaunchExcludePatternsList(patterns)} (case-insensitive)`;
}

export function formatLaunchExcludeRegexHint(patterns: readonly string[]): string {
  if (patterns.length === 0) return "(no exclusion patterns)";
  if (patterns.length === 1) {
    const escaped = patterns[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `/${escaped}/i`;
  }
  return patterns.map((p) => `"${p}"`).join(" OR ");
}

export function formatSkippedLaunchesTableLabel(patterns: readonly string[]): string {
  if (patterns.length === 0) return "Skipped (excluded launches)";
  if (patterns.length === 1) return `Skipped (${patterns[0]} launches)`;
  return `Skipped (excluded: ${patterns.join(", ")})`;
}
