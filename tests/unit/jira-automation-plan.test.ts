import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildParentTasksForGroups,
  buildParentSummary,
  enrichCasesWithAutomationCatalog,
  filterCasesForJiraPlan,
  matchesAnalyticsTag,
  requireCaseNumericId,
  buildAllowedStateNameSet,
  resolveAutomationStatesForPlan,
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

  it("keeps To Be Automated (catalog spelling) via case-insensitive match", () => {
    const catalog = [
      { id: 1, name: "Not Automated" },
      { id: 14, name: "To Be Automated" },
    ];
    const { allowedStateIds } = resolveAutomationStatesForPlan(catalog, undefined);
    const allowedNames = buildAllowedStateNameSet(catalog, allowedStateIds);
    const cases = [
      {
        id: 3300,
        key: "PROJ1-945",
        automationState: { id: 14, name: "To Be Automated" },
      },
    ];
    const w: PlanWarning[] = [];
    const kept = filterCasesForJiraPlan(
      cases,
      allowedStateIds,
      allowedNames,
      false,
      w,
    );
    assert.equal(kept.length, 1);
    assert.equal(kept[0].key, "PROJ1-945");
  });

  it("warns when case is outside plan automation states", () => {
    const w: PlanWarning[] = [];
    const kept = filterCasesForJiraPlan(
      [{ id: 9, key: "PROJ-9", automationState: { id: 99, name: "Semi-Automated" } }],
      allowedIds,
      allowedNames,
      false,
      w,
    );
    assert.equal(kept.length, 0);
    assert.equal(w[0]?.reason, "excluded_not_in_plan_automation_states");
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

describe("resolveAutomationStatesForPlan", () => {
  const catalog = [
    { id: 1, name: "Not Automated" },
    { id: 2, name: "To be automated" },
    { id: 3, name: "Automated" },
  ];

  it("reports unmatched names when automation_states is explicit", () => {
    const { allowedStateIds, unmatchedExplicitNames } = resolveAutomationStatesForPlan(
      catalog,
      ["Not Automatd"],
    );
    assert.equal(allowedStateIds.size, 0);
    assert.deepEqual(unmatchedExplicitNames, ["Not Automatd"]);
  });

  it("resolves explicit valid names", () => {
    const { allowedStateIds, unmatchedExplicitNames } = resolveAutomationStatesForPlan(
      catalog,
      ["Automated"],
    );
    assert.deepEqual([...allowedStateIds], [3]);
    assert.equal(unmatchedExplicitNames.length, 0);
  });

  it("uses defaults when automation_states omitted", () => {
    const { allowedStateIds, unmatchedExplicitNames } = resolveAutomationStatesForPlan(
      catalog,
      undefined,
    );
    assert.deepEqual([...allowedStateIds].sort(), [1, 2]);
    assert.equal(unmatchedExplicitNames.length, 0);
  });
});

describe("enrichCasesWithAutomationCatalog", () => {
  const TO_BE_AUTOMATED_ID = 502;
  const catalog = [
    { id: TO_BE_AUTOMATED_ID, name: "To Be Automated" },
    { id: 501, name: "Not Automated" },
  ];

  it("fills name from id when list payload is id-only", () => {
    const [out] = enrichCasesWithAutomationCatalog(
      [{ id: 3300, key: "PROJ1-945", automationState: { id: TO_BE_AUTOMATED_ID } }],
      catalog,
    );
    assert.equal(out.automationState?.name, "To Be Automated");
  });

  it("fills id from name when list payload is name-only", () => {
    const [out] = enrichCasesWithAutomationCatalog(
      [{ id: 3300, key: "PROJ1-945", automationState: { name: "To Be Automated" } }],
      catalog,
    );
    assert.equal(out.automationState?.id, TO_BE_AUTOMATED_ID);
  });
});

describe("requireCaseNumericId", () => {
  it("throws when id missing", () => {
    assert.throws(() => requireCaseNumericId({ key: "PROJ-1" }), /missing a numeric id/);
  });

  it("returns id when present", () => {
    assert.equal(requireCaseNumericId({ id: 42, key: "PROJ-1" }), 42);
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
