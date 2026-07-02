import type { ResolvedConfig } from "./config-loader.js";

/** Default locale for full feature coverage in MFP automation. */
export const DEFAULT_EN_US_LOCALE = "en_US";

export type LocaleTestRunRulesSettings = ResolvedConfig["localeTestRunRules"];

export const LOCALE_TEST_RUN_RULES_TOOL_NOTE =
  "When localeTestRunRules is enabled in zebrunner-config.json for the target project, " +
  "non-en_US locale previews warn and may auto-merge NOT_TAGS exclusions for configured en_US-only feature suites.";

export function normalizeLocale(locale: string): string {
  return locale.trim().replace(/-/g, "_");
}

export function isNonEnUsLocale(locale: string | null | undefined): boolean {
  if (!locale) return false;
  return normalizeLocale(locale).toLowerCase() !== "en_us";
}

export function isLocaleTestRunRulesProject(
  projectKey: string,
  settings: LocaleTestRunRulesSettings,
): boolean {
  if (!settings.enabled) return false;
  const keyUpper = projectKey.trim().toUpperCase();
  return settings.projectKeys.some((k) => k.trim().toUpperCase() === keyUpper);
}

function suiteNameMatches(
  labelLower: string,
  featureLower: string,
  matchMode: LocaleTestRunRulesSettings["suiteNameMatch"],
): boolean {
  if (matchMode === "exact") {
    return labelLower === featureLower;
  }
  return labelLower === featureLower || labelLower.includes(featureLower);
}

export function findFeatureSuiteIdsByNames(
  suites: Array<{ id: number; name?: string; title?: string }>,
  featureNames: readonly string[],
  matchMode: LocaleTestRunRulesSettings["suiteNameMatch"] = "includes",
): number[] {
  const ids = new Set<number>();
  for (const suite of suites) {
    const label = (suite.name || suite.title || "").trim();
    if (!label) continue;
    const labelLower = label.toLowerCase();
    for (const featureName of featureNames) {
      const featureLower = featureName.toLowerCase();
      if (suiteNameMatches(labelLower, featureLower, matchMode)) {
        ids.add(suite.id);
        break;
      }
    }
  }
  return [...ids].sort((a, b) => a - b);
}

export function buildNotTagsExclusionRule(featureSuiteIds: number[]): string {
  if (featureSuiteIds.length === 0) return "";
  const tags = featureSuiteIds.map((id) => `featureSuiteId=${id}`).join("||");
  return `NOT_TAGS=>${tags};;`;
}

export function parseNotTagsFeatureSuiteIds(testRunRules: string): Set<number> {
  const ids = new Set<number>();
  const regex = /NOT_TAGS=>([^;]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(testRunRules)) !== null) {
    for (const part of match[1].split("||")) {
      const idMatch = part.trim().match(/^featureSuiteId=(\d+)$/i);
      if (idMatch) ids.add(parseInt(idMatch[1], 10));
    }
  }
  return ids;
}

export function missingEnUsOnlyExclusions(testRunRules: string, requiredIds: number[]): number[] {
  if (requiredIds.length === 0) return [];
  const excluded = parseNotTagsFeatureSuiteIds(testRunRules);
  return requiredIds.filter((id) => !excluded.has(id));
}

export function appendTestRunRulesExclusion(existingRules: string, exclusionRule: string): string {
  if (!exclusionRule) return existingRules;
  const trimmed = (existingRules ?? "").trim();
  if (!trimmed) return exclusionRule;
  if (trimmed.endsWith(";;")) return trimmed + exclusionRule;
  return `${trimmed};;${exclusionRule}`;
}

export interface EnUsLocaleRulesResult {
  effectiveRules: string;
  featureSuiteIds: number[];
  autoApplied: boolean;
  warningLines: string[];
}

export function applyEnUsOnlyExclusionsToTestRunRules(
  locale: string | null | undefined,
  testRunRules: string,
  discoveredFeatureSuiteIds: number[],
  settings: LocaleTestRunRulesSettings,
): EnUsLocaleRulesResult {
  const warningLines: string[] = [];
  if (!isNonEnUsLocale(locale)) {
    return { effectiveRules: testRunRules, featureSuiteIds: [], autoApplied: false, warningLines };
  }

  const suiteList = settings.enUsOnlyFeatureSuites.join(", ");
  warningLines.push(
    `⚠️ Locale ${locale} is not en_US — configured en_US-only suites (${suiteList}) should be excluded via NOT_TAGS.`,
    "   Extend test_run_rules to filter them out for non-en_US runs.",
  );

  if (discoveredFeatureSuiteIds.length === 0) {
    warningLines.push(
      "   No matching feature suites found in TCM by name — use adv_aggregate_test_cases_by_feature to discover IDs.",
    );
    return { effectiveRules: testRunRules, featureSuiteIds: [], autoApplied: false, warningLines };
  }

  const missing = missingEnUsOnlyExclusions(testRunRules, discoveredFeatureSuiteIds);
  if (missing.length === 0) {
    warningLines.push("   test_run_rules already excludes all discovered en_US-only feature suites.");
    return {
      effectiveRules: testRunRules,
      featureSuiteIds: discoveredFeatureSuiteIds,
      autoApplied: false,
      warningLines,
    };
  }

  const exclusionRule = buildNotTagsExclusionRule(missing);
  const effectiveRules = appendTestRunRulesExclusion(testRunRules, exclusionRule);
  warningLines.push(
    `   Auto-applied NOT_TAGS exclusion: ${exclusionRule}`,
    `   Excluded featureSuiteIds: ${missing.join(", ")}`,
  );
  return {
    effectiveRules,
    featureSuiteIds: discoveredFeatureSuiteIds,
    autoApplied: true,
    warningLines,
  };
}
