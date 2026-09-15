import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildParentTasksForGroups,
  buildParentSummary,
  filterCasesForJiraPlan,
  matchesAnalyticsTag,
  resolveDefaultIntakeStateNames,
  resolveSuiteGroups,
  renderJiraAutomationPlanMarkdown,
  renderJiraAutomationPlanString,
  type PlanWarning,
} from "../../src/utils/jira-automation-plan.js";
const PLAN_CONFIG = {
  targetProject: "QAS",
  platformByProjectKey: {},
  componentByPlatform: { iOS: "Auto-iOS", Android: "Auto-Android" },
  analyticsComponentByPlatform: { iOS: "Analytics iOS", Android: "Analytics Android" },
  analyticsTagMatch: "analytics",
};

describe("resolveSuiteGroups", () => {
  const suites = [
    { id: 1, parentSuiteId: null, title: "Root" },
    { id: 10, parentSuiteId: 1, title: "Feature" },
    { id: 11, parentSuiteId: 10, title: "Child A" },
    { id: 12, parentSuiteId: 10, title: "Child B" },
  ];
  const processed = suites.map((s) => ({
    id: s.id,
    parentSuiteId: s.parentSuiteId ?? undefined,
  }));

  it("uses leaf group when no direct children", () => {
    const groups = resolveSuiteGroups(11, "Child A", processed, suites);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].reason, "leaf_suite");
  });

  it("splits by top-level sub-suites", () => {
    const groups = resolveSuiteGroups(10, "Feature", processed, suites);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].reason, "top_level_sub_suite");
    assert.deepEqual(groups.map((g) => g.suiteId), [11, 12]);
  });
});

describe("buildParentSummary", () => {
  it("formats nested and analytics titles", () => {
    const group = { suiteId: 11, suiteName: "Bucket", reason: "top_level_sub_suite" as const };
    assert.equal(
      buildParentSummary("iOS", "LOGGING", "Share Sheet", group, false),
      "[iOS - LOGGING] Automate Share Sheet : Bucket",
    );
    assert.equal(
      buildParentSummary("iOS", "LOGGING", "Share Sheet", group, true),
      "[iOS - LOGGING] Automate Share Sheet : Bucket : Analytics",
    );
  });
});

describe("filterCasesForJiraPlan", () => {
  const allowedIds = new Set([1, 2]);
  const allowedNames = new Set(["not automated", "to be automated"]);
  const warnings: PlanWarning[] = [];

  it("excludes Automated and Manual Only by default", () => {
    const cases = [
      { id: 1, key: "PROJ-1", automationState: { id: 1, name: "Not Automated" } },
      { id: 2, key: "PROJ-2", automationState: { id: 3, name: "Automated" } },
      { id: 3, key: "PROJ-3", automationState: { id: 4, name: "Manual Only" } },
    ];
    const kept = filterCasesForJiraPlan(cases, allowedIds, allowedNames, false, warnings);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].key, "PROJ-1");
    assert.equal(warnings.length, 2);
  });

  it("allows Automated when include flag set", () => {
    const cases = [
      { id: 2, key: "PROJ-2", automationState: { id: 3, name: "Automated" } },
    ];
    const w: PlanWarning[] = [];
    const kept = filterCasesForJiraPlan(
      cases,
      new Set([3]),
      new Set(["automated"]),
      true,
      w,
    );
    assert.equal(kept.length, 1);
  });
});

describe("analytics split", () => {
  it("creates separate analytics parent when title matches", () => {
    const planConfig = PLAN_CONFIG;
    const group = { suiteId: 10, suiteName: "Feature", reason: "leaf_suite" as const };
    const cases = [
      { id: 1, key: "PROJ-1", title: "Login flow", automationState: { id: 1, name: "Not Automated" } },
      { id: 2, key: "PROJ-2", title: "Analytics event X", automationState: { id: 1, name: "Not Automated" } },
    ];
    const { parentTasks } = buildParentTasksForGroups({
      platform: "iOS",
      targetProject: "QAS",
      sharedSuiteName: "Feature",
      rootModuleName: "ROOT",
      planConfig,
      analyticsTagMatch: "analytics",
      groups: [group],
      casesByGroupId: new Map([[10, cases]]),
      buildCaseUrl: (id) => `https://example.zebrunner.com/projects/PROJ/test-cases?caseId=${id}`,
    });
    assert.equal(parentTasks.length, 2);
    assert.ok(parentTasks.some((p) => p.summary.endsWith(": Analytics")));
    assert.ok(parentTasks.some((p) => p.component === "Analytics iOS"));
  });
});

describe("renderers", () => {
  it("string and markdown include parent counts", () => {
    const plan = {
      sourceSuite: { projectKey: "PROJ", suiteId: 10, suiteName: "Feature" },
      platform: "iOS",
      parentTasks: [
        {
          project: "QAS",
          summary: "[iOS - ROOT] Automate Feature",
          component: "Auto-iOS",
          sourceGroup: { suiteId: 10, suiteName: "Feature", reason: "leaf_suite" as const },
          subtasks: [
            {
              summary: "PROJ-1",
              description: "https://example.zebrunner.com/projects/PROJ/test-cases?caseId=1",
              testCaseKey: "PROJ-1",
              testCaseId: 1,
              automationState: "Not Automated",
            },
          ],
        },
      ],
      skippedGroups: [],
      warnings: [],
    };
    assert.match(renderJiraAutomationPlanString(plan), /Parent tasks: 1/);
    assert.match(renderJiraAutomationPlanMarkdown(plan), /## \[iOS - ROOT\]/);
  });
});

describe("resolveDefaultIntakeStateNames", () => {
  it("matches not automated and to be automated", () => {
    const names = resolveDefaultIntakeStateNames([
      { id: 1, name: "Not Automated" },
      { id: 2, name: "Automated" },
      { id: 3, name: "To be automated" },
    ]);
    assert.deepEqual(names.sort(), ["Not Automated", "To be automated"].sort());
  });
});

describe("matchesAnalyticsTag", () => {
  it("is case insensitive", () => {
    assert.equal(matchesAnalyticsTag("Foo ANALYTICS bar", "analytics"), true);
  });
});
