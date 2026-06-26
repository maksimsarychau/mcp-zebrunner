import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  buildPassRatePrompt,
  buildRuntimeEfficiencyPrompt,
  buildAutomationCoveragePrompt,
  buildExecutiveDashboardPrompt,
  buildReleaseReadinessPrompt,
  buildSuiteCoveragePrompt,
  buildReviewTestCasePrompt,
  buildLaunchTriagePrompt,
  buildRelaunchRegressionFailuresPrompt,
  buildFeatureScopedLaunchPrompt,
  buildFlakyReviewPrompt,
  buildFindDuplicatesPrompt,
  buildDailyQaStandupPrompt,
  buildAutomationGapsPrompt,
  buildProjectOverviewPrompt,
  getPromptsCatalog,
  type PromptMeta,
} from "../../src/prompts.js";

function getProjectRoot() {
  return path.resolve(process.cwd());
}

// ── Registration coverage ────────────────────────────────────────────────────

function extractPromptRegistrations(source: string): string[] {
  const regex = /server\.registerPrompt\(\s*"([^"]+)"/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

describe("Prompt Registry Coverage", () => {
  const root = getProjectRoot();
  const promptSource = fs.readFileSync(path.join(root, "src", "prompts.ts"), "utf-8");
  const registeredPrompts = extractPromptRegistrations(promptSource);

  it("registers the expected number of prompts", () => {
    assert.equal(registeredPrompts.length, 17, `Expected 17 prompts, got ${registeredPrompts.length}: ${registeredPrompts.join(", ")}`);
  });

  it("has unique prompt names", () => {
    assert.equal(new Set(registeredPrompts).size, registeredPrompts.length, "all prompt names should be unique");
  });

  it("includes all expected prompt names", () => {
    const expected = [
      "pass-rate",
      "runtime-efficiency",
      "automation-coverage",
      "executive-dashboard",
      "release-readiness",
      "suite-coverage",
      "review-test-case",
      "launch-triage",
      "relaunch-regression-failures",
      "feature-scoped-launch",
      "flaky-review",
      "find-duplicates",
      "daily-qa-standup",
      "automation-gaps",
      "project-overview",
    ];
    for (const name of expected) {
      assert.ok(registeredPrompts.includes(name), `Missing prompt: ${name}`);
    }
  });
});

// ── E2E prompt content validation ────────────────────────────────────────────

describe("Pass Rate Prompt", () => {
  const text = buildPassRatePrompt("android,ios,web");

  it("returns non-empty text", () => {
    assert.ok(text.length > 0);
  });

  it("includes the projects argument", () => {
    assert.ok(text.includes("android,ios,web"));
  });

  it("references expected tools", () => {
    assert.ok(text.includes("get_all_launches_with_filter"), "should reference get_all_launches_with_filter");
    assert.ok(text.includes("get_launch_test_summary"), "should reference get_launch_test_summary");
  });

  it("mentions pass rate targets", () => {
    assert.ok(text.includes("90%"), "should mention 90% target");
    assert.ok(text.includes("65%"), "should mention 65% target");
  });
});

describe("Runtime Efficiency Prompt", () => {
  const text = buildRuntimeEfficiencyPrompt("android,ios,web");

  it("returns non-empty text and includes projects", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android,ios,web"));
  });

  it("references expected tools", () => {
    assert.ok(text.includes("analyze_regression_runtime"));
  });

  it("mentions key metrics", () => {
    assert.ok(text.includes("WRI"));
    assert.ok(text.includes("Duration distribution") || text.includes("duration distribution"));
  });
});

describe("Automation Coverage Prompt", () => {
  const text = buildAutomationCoveragePrompt("android,ios,web");

  it("returns non-empty text and includes projects", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android,ios,web"));
  });

  it("references expected tools", () => {
    assert.ok(text.includes("get_automation_states"));
    assert.ok(text.includes("get_test_cases_by_automation_state"));
    assert.ok(text.includes("count_only"));
  });

  it("mentions intake rate concept", () => {
    assert.ok(text.includes("Automation Intake Rate") || text.includes("intake rate"));
  });
});

describe("Executive Dashboard Prompt", () => {
  const text = buildExecutiveDashboardPrompt("android,ios,web");

  it("returns non-empty text and includes projects", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android,ios,web"));
  });

  it("covers all 5 dashboard sections", () => {
    assert.ok(text.includes("Pass Rate"));
    assert.ok(text.includes("Runtime") || text.includes("runtime"));
    assert.ok(text.includes("Bug") || text.includes("bug"));
    assert.ok(text.includes("Coverage") || text.includes("coverage"));
    assert.ok(text.includes("Flaky") || text.includes("flaky"));
  });
});

describe("Release Readiness Prompt", () => {
  it("includes project name", () => {
    const text = buildReleaseReadinessPrompt("android");
    assert.ok(text.includes("android"));
  });

  it("uses milestone when provided", () => {
    const text = buildReleaseReadinessPrompt("android", "25.40.0");
    assert.ok(text.includes("25.40.0"));
  });

  it("defaults to latest milestone when not provided", () => {
    const text = buildReleaseReadinessPrompt("android");
    assert.ok(text.includes("latest milestone"));
  });

  it("references all 5 check areas", () => {
    const text = buildReleaseReadinessPrompt("android");
    assert.ok(text.includes("Pass rate") || text.includes("pass rate"));
    assert.ok(text.includes("Jira") || text.includes("jira"));
    assert.ok(text.includes("Runtime") || text.includes("runtime"));
    assert.ok(text.includes("Coverage") || text.includes("coverage") || text.includes("automated"));
    assert.ok(text.includes("defect") || text.includes("bug"));
  });

  it("mentions Go / No-Go", () => {
    const text = buildReleaseReadinessPrompt("android");
    assert.ok(text.includes("Go / No-Go") || text.includes("Go/No-Go"));
  });
});

describe("Suite Coverage Prompt", () => {
  const text = buildSuiteCoveragePrompt("android,ios,web");

  it("returns non-empty text and includes projects", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android,ios,web"));
  });

  it("handles Manual Only detection logic", () => {
    assert.ok(text.includes("Manual Only"));
    assert.ok(text.includes("automation state") || text.includes("automation_state"));
    assert.ok(text.includes("customField.manualOnly"));
  });

  it("mentions TOTAL REGRESSION row", () => {
    assert.ok(text.includes("TOTAL REGRESSION"));
  });
});

// ── Analysis prompt content validation ───────────────────────────────────────

describe("Review Test Case Prompt", () => {
  const text = buildReviewTestCasePrompt("MCP-5");

  it("includes the case key", () => {
    assert.ok(text.includes("MCP-5"));
  });

  it("references validation and improvement tools", () => {
    assert.ok(text.includes("validate_test_case"));
    assert.ok(text.includes("improve_test_case"));
    assert.ok(text.includes("get_test_case_by_key"));
  });
});

describe("Launch Triage Prompt", () => {
  const text = buildLaunchTriagePrompt("android");

  it("includes the project", () => {
    assert.ok(text.includes("android"));
  });

  it("references failure analysis tools", () => {
    assert.ok(text.includes("detailed_analyze_launch_failures"));
    assert.ok(text.includes("analyze_test_failure"));
  });
});

describe("Relaunch Regression Failures Prompt", () => {
  const TEST_RELAUNCH_SETTINGS = {
    excludeLaunchNamePatterns: ["Benchmark", "LoadTest"],
    maxLaunchesPerPlatform: 25,
  };

  const TEST_LOCALE_SETTINGS = {
    enabled: true,
    projectKeys: ["PROJ_A", "PROJ_B"],
    enUsOnlyFeatureSuites: ["FeatureAlpha"],
    suiteNameMatch: "includes" as const,
  };

  const DISABLED_LOCALE_SETTINGS = { ...TEST_LOCALE_SETTINGS, enabled: false };

  it("milestone mode references discovery and rerun tools", () => {
    const text = buildRelaunchRegressionFailuresPrompt(
      "PROJ_A,PROJ_B",
      "1.0.0",
      undefined,
      undefined,
      TEST_RELAUNCH_SETTINGS,
      DISABLED_LOCALE_SETTINGS,
    );
    assert.ok(text.includes("PROJ_A,PROJ_B"));
    assert.ok(text.includes("1.0.0"));
    assert.ok(text.includes("get_all_launches_with_filter"));
    assert.ok(text.includes("rerun_launch_failures"));
  });

  it("mentions preview/confirm safety rules", () => {
    const text = buildRelaunchRegressionFailuresPrompt(
      "PROJ_A",
      "1.0.0",
      undefined,
      undefined,
      TEST_RELAUNCH_SETTINGS,
      DISABLED_LOCALE_SETTINGS,
    );
    assert.ok(text.includes("confirm: true"));
    assert.ok(text.includes("preview"));
    assert.ok(text.includes("Never skip the preview step"));
  });

  it("last_7_days mode mentions startedAt and 7-day window", () => {
    const text = buildRelaunchRegressionFailuresPrompt(
      "PROJ_A,PROJ_B,PROJ_C",
      undefined,
      undefined,
      "last_7_days",
      TEST_RELAUNCH_SETTINGS,
      DISABLED_LOCALE_SETTINGS,
    );
    assert.ok(text.includes("startedAt"));
    assert.ok(text.includes("7 * 24 * 60 * 60 * 1000") || text.includes("Last 7 days"));
    assert.ok(text.includes("windowStartMs"));
  });

  it("uses relaunchFailures config for launch exclusions", () => {
    const text = buildRelaunchRegressionFailuresPrompt(
      "PROJ_A",
      undefined,
      undefined,
      undefined,
      TEST_RELAUNCH_SETTINGS,
      DISABLED_LOCALE_SETTINGS,
    );
    assert.ok(text.includes("relaunchFailures.excludeLaunchNamePatterns"));
    assert.ok(text.includes('"Benchmark"'));
    assert.ok(text.includes('"LoadTest"'));
    assert.ok(text.includes("maxLaunchesPerPlatform"));
    assert.ok(text.includes("25 launches"));
  });

  it("mentions localeTestRunRules when enabled in config", () => {
    const text = buildRelaunchRegressionFailuresPrompt(
      "PROJ_A",
      undefined,
      undefined,
      undefined,
      TEST_RELAUNCH_SETTINGS,
      TEST_LOCALE_SETTINGS,
    );
    assert.ok(text.includes("localeTestRunRules"));
    assert.ok(text.includes("PROJ_A"));
  });

  it("does not reference start_launch as rerun tool", () => {
    const text = buildRelaunchRegressionFailuresPrompt(
      "PROJ_A",
      "1.0.0",
      undefined,
      undefined,
      TEST_RELAUNCH_SETTINGS,
      DISABLED_LOCALE_SETTINGS,
    );
    assert.ok(text.includes("Do NOT use adv_start_launch"));
  });
});

describe("Feature-Scoped Launch Prompt", () => {
  const TEST_LAUNCH_PATHS = {
    rootSuiteLaunchPaths: {
      "Regression Alpha": "org/platform/regression-alpha",
    },
  };

  it("references aggregate_test_cases_by_feature and start_launch", () => {
    const text = buildFeatureScopedLaunchPrompt(
      "PROJ_A",
      "Water",
      "Regression Alpha",
      undefined,
      undefined,
      undefined,
      undefined,
      TEST_LAUNCH_PATHS,
    );
    assert.ok(text.includes("aggregate_test_cases_by_feature"));
    assert.ok(text.includes("adv_start_launch"));
    assert.ok(text.includes("Water"));
    assert.ok(text.includes("PROJ_A"));
  });

  it("includes suite scope when suite_name provided", () => {
    const text = buildFeatureScopedLaunchPrompt(
      "PROJ_A",
      "Water",
      "Regression Alpha",
      undefined,
      undefined,
      undefined,
      undefined,
      TEST_LAUNCH_PATHS,
    );
    assert.ok(text.includes("Regression Alpha"));
    assert.ok(text.includes("Suite scope"));
  });

  it("uses configured rootSuiteLaunchPaths from settings", () => {
    const text = buildFeatureScopedLaunchPrompt(
      "PROJ_A",
      "Water",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      TEST_LAUNCH_PATHS,
    );
    assert.ok(text.includes("org/platform/regression-alpha"));
    assert.ok(text.includes("featureScopedLaunch"));
  });

  it("builds test_run_rules TAGS guidance and one launch per root suite", () => {
    const text = buildFeatureScopedLaunchPrompt(
      "PROJ_A",
      "Water",
      undefined,
      undefined,
      "50977",
      undefined,
      undefined,
      TEST_LAUNCH_PATHS,
    );
    assert.ok(text.includes("TAGS=>featureSuiteId"));
    assert.ok(text.includes("50977"));
    assert.ok(text.includes("One Build Now launch per root suite"));
    assert.ok(text.includes("confirm: true"));
  });

  it("supports whole-project search when no suite scope", () => {
    const text = buildFeatureScopedLaunchPrompt("PROJ_A", "Water");
    assert.ok(text.includes("Whole project"));
  });
});

describe("Flaky Review Prompt", () => {
  const text = buildFlakyReviewPrompt("android");

  it("includes the project", () => {
    assert.ok(text.includes("android"));
  });

  it("references flaky detection tools", () => {
    assert.ok(text.includes("find_flaky_tests"));
  });
});

describe("Find Duplicates Prompt", () => {
  it("works without suite_id", () => {
    const text = buildFindDuplicatesPrompt("android");
    assert.ok(text.includes("android"));
    assert.ok(text.includes("analyze_test_cases_duplicates"));
  });

  it("includes suite_id when provided", () => {
    const text = buildFindDuplicatesPrompt("android", "42");
    assert.ok(text.includes("suite 42"));
  });
});

// ── Role-specific prompt content validation ──────────────────────────────────

describe("Daily QA Standup Prompt", () => {
  const text = buildDailyQaStandupPrompt("android,ios,web");

  it("returns non-empty text and includes projects", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android,ios,web"));
  });

  it("references expected tools", () => {
    assert.ok(text.includes("get_all_launches_with_filter"));
    assert.ok(text.includes("get_launch_test_summary"));
    assert.ok(text.includes("find_flaky_tests"));
  });

  it("mentions standup-specific outputs", () => {
    assert.ok(text.includes("standup") || text.includes("daily"));
    assert.ok(text.includes("Action items") || text.includes("action items"));
  });
});

describe("Automation Gaps Prompt", () => {
  const text = buildAutomationGapsPrompt("android,ios,web");

  it("returns non-empty text and includes projects", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android,ios,web"));
  });

  it("references expected tools", () => {
    assert.ok(text.includes("get_automation_states"));
    assert.ok(text.includes("get_test_cases_by_automation_state"));
    assert.ok(text.includes("list_test_suites"));
  });

  it("mentions gap analysis concepts", () => {
    assert.ok(text.includes("automation gaps") || text.includes("Automation Gaps") || text.includes("automation gap"));
    assert.ok(text.includes("coverage"));
  });
});

describe("Project Overview Prompt", () => {
  const text = buildProjectOverviewPrompt("android");

  it("returns non-empty text and includes project", () => {
    assert.ok(text.length > 0);
    assert.ok(text.includes("android"));
  });

  it("references expected tools", () => {
    assert.ok(text.includes("get_available_projects"));
    assert.ok(text.includes("list_test_suites"));
    assert.ok(text.includes("get_all_launches_for_project"));
    assert.ok(text.includes("get_project_milestones"));
  });

  it("covers comprehensive overview areas", () => {
    assert.ok(text.includes("suite") || text.includes("Suite"));
    assert.ok(text.includes("coverage") || text.includes("Coverage"));
    assert.ok(text.includes("milestone") || text.includes("Milestone"));
    assert.ok(text.includes("flaky") || text.includes("Flaky"));
  });
});

// ── Prompt Catalog API ───────────────────────────────────────────────────────

describe("getPromptsCatalog()", () => {
  const catalog = getPromptsCatalog();

  it("returns exactly 17 prompts matching registered count", () => {
    assert.equal(catalog.length, 17);
  });

  it("every entry has required fields", () => {
    for (const p of catalog) {
      assert.ok(p.name && p.name.length > 0, `prompt missing name`);
      assert.ok(p.title && p.title.length > 0, `${p.name} missing title`);
      assert.ok(p.description && p.description.length > 0, `${p.name} missing description`);
      assert.ok(p.category && p.category.length > 0, `${p.name} missing category`);
      assert.ok(Array.isArray(p.args), `${p.name} missing args`);
    }
  });

  it("catalog names match registered prompt names", () => {
    const root = getProjectRoot();
    const promptSource = fs.readFileSync(path.join(root, "src", "prompts.ts"), "utf-8");
    const registered = extractPromptRegistrations(promptSource);
    const catalogNames = catalog.map(p => p.name);
    assert.deepEqual(catalogNames.sort(), registered.sort(), "catalog names should match registered names");
  });

  it("has unique names", () => {
    const names = catalog.map(p => p.name);
    assert.equal(new Set(names).size, names.length, "catalog names should be unique");
  });

  it("covers all three categories", () => {
    const categories = new Set(catalog.map(p => p.category));
    assert.ok(categories.has("E2E Metrics"), "should have E2E Metrics category");
    assert.ok(categories.has("Analysis"), "should have Analysis category");
    assert.ok(categories.has("Role-Specific"), "should have Role-Specific category");
  });
});

// ── No hardcoded project keys in prompts ─────────────────────────────────────

describe("Prompt Hygiene", () => {
  const builders = [
    { name: "pass-rate", fn: () => buildPassRatePrompt("TEST_PROJ") },
    { name: "runtime-efficiency", fn: () => buildRuntimeEfficiencyPrompt("TEST_PROJ") },
    { name: "automation-coverage", fn: () => buildAutomationCoveragePrompt("TEST_PROJ") },
    { name: "executive-dashboard", fn: () => buildExecutiveDashboardPrompt("TEST_PROJ") },
    { name: "release-readiness", fn: () => buildReleaseReadinessPrompt("TEST_PROJ") },
    { name: "suite-coverage", fn: () => buildSuiteCoveragePrompt("TEST_PROJ") },
    { name: "launch-triage", fn: () => buildLaunchTriagePrompt("TEST_PROJ") },
    { name: "relaunch-regression-failures", fn: () => buildRelaunchRegressionFailuresPrompt("TEST_PROJ", "26.19.0") },
    { name: "feature-scoped-launch", fn: () => buildFeatureScopedLaunchPrompt("TEST_PROJ", "Water", "Suite A") },
    { name: "flaky-review", fn: () => buildFlakyReviewPrompt("TEST_PROJ") },
    { name: "find-duplicates", fn: () => buildFindDuplicatesPrompt("TEST_PROJ") },
    { name: "daily-qa-standup", fn: () => buildDailyQaStandupPrompt("TEST_PROJ") },
    { name: "automation-gaps", fn: () => buildAutomationGapsPrompt("TEST_PROJ") },
    { name: "project-overview", fn: () => buildProjectOverviewPrompt("TEST_PROJ") },
  ];

  for (const { name, fn } of builders) {
    it(`${name}: does not hardcode specific project keys`, () => {
      const text = fn();
      assert.ok(!text.includes("MCP"), `${name} should not hardcode MCP`);
      assert.ok(!text.includes("MCP"), `${name} should not hardcode MCP`);
      assert.ok(!text.includes("MCP"), `${name} should not hardcode MCP`);
    });

    it(`${name}: includes the user-provided project argument`, () => {
      const text = fn();
      assert.ok(text.includes("TEST_PROJ"), `${name} should interpolate the project argument`);
    });
  }
});
