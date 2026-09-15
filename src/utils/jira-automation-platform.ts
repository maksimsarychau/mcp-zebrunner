import type { JiraAutomationPlanConfig, ResolvedConfig } from "./config-loader.js";

const ALIAS_TO_PLATFORM: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  web: "Web",
  api: "API",
};

function capitalizePlatformFromAlias(aliasKey: string): string {
  const normalized = aliasKey.trim().toLowerCase();
  if (ALIAS_TO_PLATFORM[normalized]) {
    return ALIAS_TO_PLATFORM[normalized];
  }
  if (!normalized) return aliasKey;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/**
 * Resolve display platform for Jira plan titles/components.
 * Order: jiraAutomationPlan.platformByProjectKey → reverse projectAliases → error.
 */
export function resolveJiraAutomationPlatform(
  projectKey: string,
  config: Pick<ResolvedConfig, "projectAliases" | "jiraAutomationPlan">,
): string | { error: string } {
  const key = projectKey.trim();
  const upper = key.toUpperCase();

  const fromMap =
    config.jiraAutomationPlan.platformByProjectKey[key] ??
    config.jiraAutomationPlan.platformByProjectKey[upper];
  if (fromMap) return fromMap;

  for (const [alias, mappedKey] of Object.entries(config.projectAliases)) {
    if (mappedKey === key || mappedKey.toUpperCase() === upper) {
      const platform = capitalizePlatformFromAlias(alias);
      if (config.jiraAutomationPlan.componentByPlatform[platform]) {
        return platform;
      }
      return platform;
    }
  }

  return {
    error:
      `Cannot resolve Jira automation platform for Zebrunner project "${key}". ` +
      `Add jiraAutomationPlan.platformByProjectKey["${key}"] in zebrunner-config.json ` +
      `or ensure projectAliases maps an alias (e.g. ios/android) to this project key.`,
  };
}

export function resolveAutoComponent(
  platform: string,
  planConfig: JiraAutomationPlanConfig,
): string {
  return planConfig.componentByPlatform[platform] ?? `Auto-${platform}`;
}

export function resolveAnalyticsComponent(
  platform: string,
  planConfig: JiraAutomationPlanConfig,
): string {
  return planConfig.analyticsComponentByPlatform[platform] ?? `Analytics ${platform}`;
}
