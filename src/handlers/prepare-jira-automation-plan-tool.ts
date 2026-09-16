import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import { HierarchyProcessor } from "../utils/hierarchy.js";
import { getConfig } from "../utils/config-loader.js";
import { resolveJiraAutomationPlatform } from "../utils/jira-automation-platform.js";
import {
  buildAllowedStateNameSet,
  buildAutomationCatalogNormToId,
  buildParentTasksForGroups,
  collectGroupSubtreeSuiteIds,
  enrichCasesWithAutomationCatalog,
  filterCasesForJiraPlan,
  type JiraAutomationPlan,
  type PlanWarning,
  renderJiraAutomationPlanMarkdown,
  renderJiraAutomationPlanString,
  resolveAutomationStatesForPlan,
  resolveRootModuleName,
  resolveSuiteGroups,
  suiteDisplayName,
  type CaseLike,
} from "../utils/jira-automation-plan.js";
import { parseZebrunnerSuiteUrl } from "../utils/zebrunner-suite-url.js";
import { buildTestCaseWebUrl } from "../utils/zebrunner-test-case-ref.js";
import { FormatProcessor } from "../utils/formatter.js";
import type { OutputFormat } from "../types/api.js";
import {
  buildTestSuiteIdInRql,
  fetchTestCasesForSuiteIdsBatched,
  shouldBatchSuiteInFilter,
} from "../utils/suite-scope-filter.js";
import type { ZebrunnerTestCase } from "../types/core.js";

export interface PrepareJiraAutomationPlanDeps {
  client: EnhancedZebrunnerClient;
  webBaseUrl: string;
  debugLog: (message: string, data?: unknown) => void;
  resolveProjectKey?: (project: string) => string;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function resolveProjectInput(
  projectKey: string | undefined,
  resolveProjectKey?: (project: string) => string,
): string {
  const raw = (projectKey ?? "").trim();
  if (!raw) return raw;
  if (!resolveProjectKey) return raw;
  const cfg = getConfig();
  const alias = cfg.projectAliases[raw.toLowerCase()] ?? cfg.projectAliases[raw];
  return alias ?? resolveProjectKey(raw);
}

async function fetchCasesForSubtree(
  client: EnhancedZebrunnerClient,
  projectKey: string,
  suiteIds: number[],
): Promise<ZebrunnerTestCase[]> {
  if (suiteIds.length === 0) return [];

  if (shouldBatchSuiteInFilter(suiteIds)) {
    return fetchTestCasesForSuiteIdsBatched(suiteIds, {
      fetchWithFilter: async (filter) =>
        client.getAllTestCases(projectKey, { filter }),
    });
  }

  const filter = buildTestSuiteIdInRql(suiteIds);
  return client.getAllTestCases(projectKey, { filter });
}

export async function runPrepareJiraAutomationPlan(
  deps: PrepareJiraAutomationPlanDeps,
  args: {
    suite_url?: string;
    project_key?: string;
    suite_id?: number;
    format?: OutputFormat;
    automation_states?: string[];
    include_automated_or_manual_only?: boolean;
    analytics_tag_match?: string;
  },
): Promise<JiraAutomationPlan | { error: string }> {
  let projectKey = args.project_key?.trim();
  let suiteId = args.suite_id;

  if (args.suite_url?.trim()) {
    const parsed = parseZebrunnerSuiteUrl(args.suite_url);
    if (!parsed) {
      return {
        error:
          "Invalid suite URL. Expected .../projects/<PROJECT>/test-cases?suiteId=<numeric_id>",
      };
    }
    projectKey = parsed.projectKey;
    suiteId = parsed.suiteId;
  }

  if (!projectKey || suiteId == null || !Number.isFinite(suiteId) || suiteId <= 0) {
    return { error: "Provide suite_url or both project_key and suite_id." };
  }

  projectKey = resolveProjectInput(projectKey, deps.resolveProjectKey);

  const cfg = getConfig();
  const platformResult = resolveJiraAutomationPlatform(projectKey, cfg);
  if (typeof platformResult !== "string") {
    return { error: platformResult.error };
  }
  const platform = platformResult;

  const allSuites = await deps.client.getAllTestSuites(projectKey);
  const targetSuite = allSuites.find((s) => s.id === suiteId);
  if (!targetSuite) {
    return { error: `Suite ${suiteId} not found in project ${projectKey}` };
  }

  const processedSuites = HierarchyProcessor.setRootParentsToSuites(allSuites);
  const targetName = suiteDisplayName(targetSuite);
  const sharedSuiteName = targetName;
  const rootModuleName = resolveRootModuleName(suiteId, processedSuites, allSuites);
  const groups = resolveSuiteGroups(suiteId, targetName, processedSuites, allSuites);

  const catalog = await deps.client.getAutomationStatesForProject(projectKey);
  const { allowedStateIds, unmatchedExplicitNames } = resolveAutomationStatesForPlan(
    catalog,
    args.automation_states,
  );
  if (unmatchedExplicitNames.length > 0) {
    return {
      error:
        `No automation states matched: ${unmatchedExplicitNames.map((n) => `"${n}"`).join(", ")}. ` +
        `Check names with adv_get_automation_states for project ${projectKey}.`,
    };
  }
  const allowedStateNames = buildAllowedStateNameSet(catalog, allowedStateIds);
  const catalogNormToId = buildAutomationCatalogNormToId(catalog);
  const intakeAutomationStates = catalog
    .filter((s) => allowedStateIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));
  if (allowedStateIds.size === 0) {
    return {
      error:
        `No automation states matched default intake names (Not Automated / To be automated) for project ${projectKey}. ` +
        `Pass automation_states explicitly or check adv_get_automation_states.`,
    };
  }

  const analyticsTag =
    args.analytics_tag_match?.trim() || cfg.jiraAutomationPlan.analyticsTagMatch;
  const includeExcluded = args.include_automated_or_manual_only === true;
  const warnings: PlanWarning[] = [];
  const casesByGroupId = new Map<number, CaseLike[]>();

  // One fetch per top-level suite group (serial) to avoid burst rate limits; each call may batch suite IN internally.
  for (const group of groups) {
    const subtreeIds = collectGroupSubtreeSuiteIds(group.suiteId, processedSuites);
    const rawCases = await fetchCasesForSubtree(deps.client, projectKey, subtreeIds);

    const withIds: CaseLike[] = [];
    for (const tc of rawCases) {
      if (tc.id == null) {
        return {
          error: `Test case ${tc.key ?? "(unknown)"} is missing numeric id — cannot build caseId links.`,
        };
      }
      withIds.push(tc);
    }

    const enriched = enrichCasesWithAutomationCatalog(withIds, catalog);
    const filtered = filterCasesForJiraPlan(
      enriched,
      allowedStateIds,
      allowedStateNames,
      includeExcluded,
      warnings,
      catalogNormToId,
    );
    casesByGroupId.set(group.suiteId, filtered);
  }

  const { parentTasks, skippedGroups } = buildParentTasksForGroups({
    platform,
    targetProject: cfg.jiraAutomationPlan.targetProject,
    sharedSuiteName,
    rootModuleName,
    planConfig: cfg.jiraAutomationPlan,
    analyticsTagMatch: analyticsTag,
    groups,
    casesByGroupId,
    buildCaseUrl: (caseId) =>
      buildTestCaseWebUrl(deps.webBaseUrl, projectKey!, { id: caseId }),
  });

  return {
    sourceSuite: { projectKey, suiteId, suiteName: targetName },
    platform,
    parentTasks,
    skippedGroups,
    warnings,
    intakeAutomationStates,
  };
}

export function registerPrepareJiraAutomationPlanTool(
  server: McpServer,
  deps: PrepareJiraAutomationPlanDeps,
): void {
  const toolConfig = {
    description:
      "📋 Prepare a structured Jira automation task plan from a Zebrunner test suite URL or suite id — " +
      "suite grouping, automation-state filtering, Analytics split, and caseId-based links. " +
      "Plan only: does not read or write Jira. Resolves automation states per project (same catalog as adv_get_automation_states; " +
      "IDs are not portable across projects). Default intake by name: Not Automated + To be automated " +
      "(case-insensitive; Zebrunner often labels this \"To Be Automated\"); " +
      "excludes Automated and Manual Only unless include_automated_or_manual_only is true.",
    inputSchema: {
      suite_url: z
        .string()
        .optional()
        .describe("Zebrunner suite URL: .../projects/<KEY>/test-cases?suiteId=<id>"),
      project_key: z.string().optional().describe("Zebrunner project key (with suite_id if no suite_url)"),
      suite_id: z.number().int().positive().optional().describe("Suite id (with project_key if no suite_url)"),
      format: z
        .enum(["dto", "json", "compact", "string", "markdown"])
        .default("json")
        .describe("Output format (default json for orchestration)"),
      automation_states: z
        .array(z.string())
        .optional()
        .describe(
          'Automation state names to include (default: "Not Automated" and "To be automated" for the project; ' +
            "use adv_get_automation_states to list valid names and per-project IDs)",
        ),
      include_automated_or_manual_only: z
        .boolean()
        .default(false)
        .describe(
          "When true, allow Automated and Manual Only cases in the plan. Default false excludes them even if listed in automation_states.",
        ),
      analytics_tag_match: z
        .string()
        .optional()
        .describe("Case-insensitive substring for Analytics suite/title detection (default from zebrunner-config.json)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };

  server.registerTool(
    "prepare_jira_automation_plan",
    toolConfig,
    async (args) => {
      try {
        deps.debugLog("adv_prepare_jira_automation_plan", args);
        const result = await runPrepareJiraAutomationPlan(deps, args);
        if ("error" in result) {
          return textResult(`❌ ${result.error}`);
        }

        const format = (args.format ?? "json") as OutputFormat;
        if (format === "markdown") {
          return textResult(renderJiraAutomationPlanMarkdown(result));
        }
        if (format === "string") {
          return textResult(renderJiraAutomationPlanString(result));
        }

        const formatted = FormatProcessor.format(result, format);
        const text =
          typeof formatted === "string" ? formatted : JSON.stringify(formatted, null, 2);
        return textResult(text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.debugLog("Error in adv_prepare_jira_automation_plan", { error: msg });
        return textResult(`❌ Error in adv_prepare_jira_automation_plan: ${msg}`);
      }
    },
  );
}
