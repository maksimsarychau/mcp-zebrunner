import type { JiraAutomationPlanConfig } from "./config-loader.js";
import {
  resolveAnalyticsComponent,
  resolveAutoComponent,
} from "./jira-automation-platform.js";
import { isAutomated } from "./test-impact-scorer.js";
import type { ProcessedSuiteRow } from "./suite-scope-filter.js";
import { findAllDescendantSuiteIds } from "./suite-scope-filter.js";

export type SuiteGroupReason = "leaf_suite" | "top_level_sub_suite";

export interface SuiteGroup {
  suiteId: number;
  suiteName: string;
  reason: SuiteGroupReason;
}

export interface PlanSubtask {
  summary: string;
  description: string;
  testCaseKey: string;
  testCaseId: number;
  automationState: string;
}

export interface PlanParentTask {
  project: string;
  summary: string;
  component: string;
  sourceGroup: {
    suiteId: number;
    suiteName: string;
    reason: SuiteGroupReason;
  };
  subtasks: PlanSubtask[];
}

export interface SkippedGroup {
  suiteId: number;
  suiteName: string;
  reason: string;
}

export interface PlanWarning {
  reason: string;
  testCaseKey?: string;
  automationState?: string;
  message?: string;
}

export interface JiraAutomationPlan {
  sourceSuite: { projectKey: string; suiteId: number; suiteName: string };
  platform: string;
  parentTasks: PlanParentTask[];
  skippedGroups: SkippedGroup[];
  warnings: PlanWarning[];
  /** Resolved intake states for this project (ids from adv_get_automation_states catalog). */
  intakeAutomationStates?: { id: number; name: string }[];
}

export interface SuiteLike {
  id: number;
  parentSuiteId?: number | null;
  title?: string;
  name?: string;
}

export interface CaseLike {
  id?: number;
  key?: string;
  title?: string;
  automationState?: { id?: number; name?: string };
}

export interface AutomationStateLike {
  id: number;
  name: string;
}

const DEFAULT_INTAKE_STATE_NAMES = ["not automated", "to be automated"];

export function suiteDisplayName(suite: SuiteLike): string {
  return (suite.title || suite.name || `Suite ${suite.id}`).trim();
}

export function normalizeAutomationStateName(name: string | undefined): string {
  return (name ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function isManualOnlyAutomationState(stateName: string | undefined): boolean {
  return normalizeAutomationStateName(stateName) === "manual only";
}

export function isDeniedAutomationState(
  stateName: string | undefined,
  includeAutomatedOrManualOnly: boolean,
): boolean {
  if (includeAutomatedOrManualOnly) return false;
  if (isAutomated(stateName)) return true;
  if (isManualOnlyAutomationState(stateName)) return true;
  return false;
}

export function resolveCaseAutomationStateName(tc: CaseLike): string {
  return tc.automationState?.name ?? "Unknown";
}

export function resolveDefaultIntakeStateNames(
  catalog: AutomationStateLike[],
): string[] {
  const names: string[] = [];
  for (const state of catalog) {
    const norm = normalizeAutomationStateName(state.name);
    if (DEFAULT_INTAKE_STATE_NAMES.includes(norm)) {
      names.push(state.name);
    }
  }
  return names;
}

export type AutomationStatesForPlan = {
  allowedStateIds: Set<number>;
  /** Names from an explicit `automation_states` arg that did not match the project catalog. */
  unmatchedExplicitNames: string[];
};

export function resolveAutomationStatesForPlan(
  catalog: AutomationStateLike[],
  requestedNames: string[] | undefined,
): AutomationStatesForPlan {
  const nameToId = new Map(
    catalog.map((s) => [normalizeAutomationStateName(s.name), s.id]),
  );
  const explicit = Boolean(requestedNames && requestedNames.length > 0);
  const names = explicit ? requestedNames! : resolveDefaultIntakeStateNames(catalog);

  const allowedStateIds = new Set<number>();
  const unmatchedExplicitNames: string[] = [];
  for (const name of names) {
    const id = nameToId.get(normalizeAutomationStateName(name));
    if (id !== undefined) {
      allowedStateIds.add(id);
    } else if (explicit) {
      unmatchedExplicitNames.push(name);
    }
  }
  return { allowedStateIds, unmatchedExplicitNames };
}

export function resolveAllowedAutomationStateIds(
  catalog: AutomationStateLike[],
  requestedNames: string[] | undefined,
): Set<number> {
  return resolveAutomationStatesForPlan(catalog, requestedNames).allowedStateIds;
}

/** Cases passed into buildParentTasksForGroups must have numeric ids (caseId URLs). */
export function requireCaseNumericId(tc: CaseLike): number {
  const id = tc.id;
  if (id == null || !Number.isFinite(id) || id <= 0) {
    throw new Error(
      `Test case ${tc.key ?? "(unknown)"} is missing a numeric id — cannot build caseId links.`,
    );
  }
  return id;
}

export function buildAutomationCatalogNormToId(
  catalog: AutomationStateLike[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const state of catalog) {
    map.set(normalizeAutomationStateName(state.name), state.id);
  }
  return map;
}

/** Fill missing automation state id/name on list payloads using the project catalog. */
export function enrichCasesWithAutomationCatalog(
  cases: CaseLike[],
  catalog: AutomationStateLike[],
): CaseLike[] {
  const normToId = buildAutomationCatalogNormToId(catalog);
  const idToName = new Map(catalog.map((s) => [s.id, s.name]));

  return cases.map((tc) => {
    const raw = tc.automationState;
    if (!raw) return tc;

    let id = raw.id;
    let name = raw.name?.trim();

    if (id != null && !name) {
      name = idToName.get(id);
    }
    if ((id == null || !Number.isFinite(id)) && name) {
      id = normToId.get(normalizeAutomationStateName(name));
    }

    if (id == null && !name) return tc;
    return {
      ...tc,
      automationState: {
        id: id ?? raw.id,
        name: name ?? raw.name,
      },
    };
  });
}

export function filterCasesForJiraPlan(
  cases: CaseLike[],
  allowedStateIds: Set<number>,
  allowedStateNamesNormalized: Set<string>,
  includeAutomatedOrManualOnly: boolean,
  warnings: PlanWarning[],
  catalogNormToId?: Map<string, number>,
): CaseLike[] {
  const kept: CaseLike[] = [];

  for (const tc of cases) {
    const stateName = resolveCaseAutomationStateName(tc);
    const stateId = tc.automationState?.id;

    if (isDeniedAutomationState(stateName, includeAutomatedOrManualOnly)) {
      if (tc.key) {
        warnings.push({
          reason: "excluded_automation_state",
          testCaseKey: tc.key,
          automationState: stateName,
        });
      }
      continue;
    }

    const normName = normalizeAutomationStateName(stateName);
    const resolvedId =
      stateId != null && Number.isFinite(stateId)
        ? stateId
        : normName !== "unknown"
          ? catalogNormToId?.get(normName)
          : undefined;
    const idAllowed = resolvedId != null && allowedStateIds.has(resolvedId);
    const nameAllowed = allowedStateNamesNormalized.has(normName);
    if (!idAllowed && !nameAllowed) {
      if (tc.key) {
        warnings.push({
          reason: "excluded_not_in_plan_automation_states",
          testCaseKey: tc.key,
          automationState: stateName,
        });
      }
      continue;
    }

    kept.push(tc);
  }

  return kept;
}

export function buildAllowedStateNameSet(
  catalog: AutomationStateLike[],
  allowedStateIds: Set<number>,
): Set<string> {
  const names = new Set<string>();
  for (const state of catalog) {
    if (allowedStateIds.has(state.id)) {
      names.add(normalizeAutomationStateName(state.name));
    }
  }
  return names;
}

export function resolveSuiteGroups(
  targetSuiteId: number,
  targetSuiteName: string,
  processedSuites: ProcessedSuiteRow[],
  allSuites: SuiteLike[],
): SuiteGroup[] {
  const directChildren = processedSuites.filter(
    (s) => s.parentSuiteId === targetSuiteId && s.id !== targetSuiteId,
  );

  if (directChildren.length === 0) {
    return [
      {
        suiteId: targetSuiteId,
        suiteName: targetSuiteName,
        reason: "leaf_suite",
      },
    ];
  }

  const byId = new Map(allSuites.map((s) => [s.id, s]));
  return directChildren.map((child) => {
    const row = byId.get(child.id);
    return {
      suiteId: child.id,
      suiteName: row ? suiteDisplayName(row) : `Suite ${child.id}`,
      reason: "top_level_sub_suite" as const,
    };
  });
}

export function resolveRootModuleName(
  targetSuiteId: number,
  processedSuites: ProcessedSuiteRow[],
  allSuites: SuiteLike[],
): string {
  const byId = new Map(allSuites.map((s) => [s.id, s]));
  let currentId: number | undefined = targetSuiteId;
  const visited = new Set<number>();
  let topId = targetSuiteId;

  while (currentId != null && !visited.has(currentId)) {
    visited.add(currentId);
    topId = currentId;
    const row = processedSuites.find((s) => s.id === currentId);
    const parentId = row?.parentSuiteId;
    if (parentId == null || parentId === currentId || !processedSuites.some((s) => s.id === parentId)) {
      break;
    }
    currentId = parentId;
  }

  const topSuite = byId.get(topId);
  const label = topSuite ? suiteDisplayName(topSuite) : `Suite ${topId}`;
  return label.toUpperCase();
}

export function collectGroupSubtreeSuiteIds(
  groupSuiteId: number,
  processedSuites: ProcessedSuiteRow[],
): number[] {
  const descendants = findAllDescendantSuiteIds(groupSuiteId, processedSuites);
  return [groupSuiteId, ...descendants];
}

export function matchesAnalyticsTag(text: string, tag: string): boolean {
  if (!tag) return false;
  return text.toLowerCase().includes(tag.toLowerCase());
}

export function buildParentSummary(
  platform: string,
  rootModuleName: string,
  sharedSuiteName: string,
  group: SuiteGroup,
  analyticsSuffix: boolean,
): string {
  let title = `[${platform} - ${rootModuleName}] Automate ${sharedSuiteName}`;
  if (group.reason === "top_level_sub_suite") {
    title += ` : ${group.suiteName}`;
  }
  if (analyticsSuffix) {
    title += " : Analytics";
  }
  return title;
}

export interface BuildParentTasksInput {
  platform: string;
  targetProject: string;
  sharedSuiteName: string;
  rootModuleName: string;
  planConfig: JiraAutomationPlanConfig;
  analyticsTagMatch: string;
  groups: SuiteGroup[];
  casesByGroupId: Map<number, CaseLike[]>;
  buildCaseUrl: (caseId: number) => string;
}

export function buildParentTasksForGroups(input: BuildParentTasksInput): {
  parentTasks: PlanParentTask[];
  skippedGroups: SkippedGroup[];
} {
  const parentTasks: PlanParentTask[] = [];
  const skippedGroups: SkippedGroup[] = [];

  for (const group of input.groups) {
    const cases = input.casesByGroupId.get(group.suiteId) ?? [];
    if (cases.length === 0) {
      skippedGroups.push({
        suiteId: group.suiteId,
        suiteName: group.suiteName,
        reason: "zero_in_scope_cases_after_filtering",
      });
      continue;
    }

    const suiteIsAnalytics = matchesAnalyticsTag(group.suiteName, input.analyticsTagMatch);
    const autoComponent = resolveAutoComponent(input.platform, input.planConfig);
    const analyticsComponent = resolveAnalyticsComponent(input.platform, input.planConfig);

    const toSubtasks = (list: CaseLike[]): PlanSubtask[] =>
      list.map((tc) => {
        const id = requireCaseNumericId(tc);
        const key = tc.key ?? String(id);
        return {
          summary: key,
          description: input.buildCaseUrl(id),
          testCaseKey: key,
          testCaseId: id,
          automationState: resolveCaseAutomationStateName(tc),
        };
      });

    if (suiteIsAnalytics) {
      parentTasks.push({
        project: input.targetProject,
        summary: buildParentSummary(
          input.platform,
          input.rootModuleName,
          input.sharedSuiteName,
          group,
          false,
        ),
        component: analyticsComponent,
        sourceGroup: {
          suiteId: group.suiteId,
          suiteName: group.suiteName,
          reason: group.reason,
        },
        subtasks: toSubtasks(cases),
      });
      continue;
    }

    const analyticsCases: CaseLike[] = [];
    const regularCases: CaseLike[] = [];
    for (const tc of cases) {
      const title = tc.title ?? "";
      if (matchesAnalyticsTag(title, input.analyticsTagMatch)) {
        analyticsCases.push(tc);
      } else {
        regularCases.push(tc);
      }
    }

    if (regularCases.length > 0) {
      parentTasks.push({
        project: input.targetProject,
        summary: buildParentSummary(
          input.platform,
          input.rootModuleName,
          input.sharedSuiteName,
          group,
          false,
        ),
        component: autoComponent,
        sourceGroup: {
          suiteId: group.suiteId,
          suiteName: group.suiteName,
          reason: group.reason,
        },
        subtasks: toSubtasks(regularCases),
      });
    }

    if (analyticsCases.length > 0) {
      parentTasks.push({
        project: input.targetProject,
        summary: buildParentSummary(
          input.platform,
          input.rootModuleName,
          input.sharedSuiteName,
          group,
          true,
        ),
        component: analyticsComponent,
        sourceGroup: {
          suiteId: group.suiteId,
          suiteName: group.suiteName,
          reason: group.reason,
        },
        subtasks: toSubtasks(analyticsCases),
      });
    }
  }

  return { parentTasks, skippedGroups };
}

export function renderJiraAutomationPlanMarkdown(plan: JiraAutomationPlan): string {
  const lines: string[] = [
    `# Jira automation plan`,
    ``,
    `**Source:** ${plan.sourceSuite.suiteName} (\`${plan.sourceSuite.projectKey}\` suite ${plan.sourceSuite.suiteId})`,
    `**Platform:** ${plan.platform}`,
    ``,
  ];

  if (plan.parentTasks.length === 0) {
    lines.push(`_No parent tasks — all groups skipped or empty._`, ``);
  }

  for (const parent of plan.parentTasks) {
    lines.push(`## ${parent.summary}`, ``);
    lines.push(`- **Jira project:** ${parent.project}`);
    lines.push(`- **Component:** ${parent.component}`);
    lines.push(`- **Subtasks:** ${parent.subtasks.length}`, ``);
    if (parent.subtasks.length > 0) {
      lines.push(`| Summary | Automation state | Link |`);
      lines.push(`| --- | --- | --- |`);
      for (const st of parent.subtasks) {
        lines.push(`| ${st.summary} | ${st.automationState} | ${st.description} |`);
      }
      lines.push(``);
    }
  }

  if (plan.skippedGroups.length > 0) {
    lines.push(`## Skipped groups`, ``);
    for (const sk of plan.skippedGroups) {
      lines.push(`- **${sk.suiteName}** (${sk.suiteId}): ${sk.reason}`);
    }
    lines.push(``);
  }

  if (plan.warnings.length > 0) {
    lines.push(`## Warnings`, ``);
    for (const w of plan.warnings) {
      lines.push(
        `- ${w.reason}${w.testCaseKey ? ` (${w.testCaseKey})` : ""}${w.automationState ? `: ${w.automationState}` : ""}`,
      );
    }
  }

  return lines.join("\n");
}

export function renderJiraAutomationPlanString(plan: JiraAutomationPlan): string {
  const subtaskCount = plan.parentTasks.reduce((n, p) => n + p.subtasks.length, 0);
  const lines: string[] = [
    `Jira automation plan for ${plan.sourceSuite.suiteName} (${plan.sourceSuite.projectKey}, suite ${plan.sourceSuite.suiteId})`,
    `Platform: ${plan.platform}`,
    `Parent tasks: ${plan.parentTasks.length}, subtasks: ${subtaskCount}`,
    `Skipped groups: ${plan.skippedGroups.length}`,
    `Warnings: ${plan.warnings.length}`,
  ];
  for (const parent of plan.parentTasks) {
    lines.push(`  - ${parent.summary} (${parent.subtasks.length} subtasks, ${parent.component})`);
  }
  return lines.join("\n");
}
