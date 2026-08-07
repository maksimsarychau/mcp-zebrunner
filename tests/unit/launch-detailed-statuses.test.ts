import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { ZebrunnerReportingClient } from "../../src/api/reporting-client.js";
import { ReportHandler } from "../../src/handlers/report-handler.js";
import { ZebrunnerReportingToolHandlers } from "../../src/handlers/reporting-tools.js";
import {
  LaunchListItemSchema,
  LaunchResponseSchema,
  TestRunResponseSchema,
} from "../../src/types/reporting.js";
import {
  getLaunchDetailedStatusCounts,
  getTcmDetailedStatusCounts,
  getTestRunDetailedStatusCounts,
  getWidgetDetailedStatusCounts,
} from "../../src/utils/launch-status-counts.js";
import {
  getLaunchFailureCount,
  isLaunchEligibleForFailureRerun,
} from "../../src/utils/launch-rerun.js";
import { EVAL_PROMPTS } from "../eval/eval-prompts.js";
import { isCloudEvalPrompt } from "../eval/eval-cloud-suite.js";

const launchFixture = {
  id: 101,
  name: "Regression",
  status: "FINISHED",
  projectId: 7,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_060_000,
  passed: 8,
  passedManually: 2,
  failed: 3,
  failedAsKnown: 1,
  skipped: 1,
  blocked: 0,
  inProgress: 0,
  aborted: 1,
};

function parseText(result: Awaited<ReturnType<ZebrunnerReportingToolHandlers["getLauncherSummary"]>>) {
  return JSON.parse(result.content[0].text);
}

describe("opt-in detailed launch statuses", () => {
  it("accepts detailed fields on launch and launch-list schemas", () => {
    const launch = LaunchResponseSchema.parse(launchFixture);
    assert.equal(launch.passedManually, 2);
    assert.equal(launch.failedAsKnown, 1);

    const listItem = LaunchListItemSchema.parse({
      ...launchFixture,
      total: 13,
      finishedAt: launchFixture.endedAt,
    });
    assert.equal(listItem.passedManually, 2);
    assert.equal(listItem.failedAsKnown, 1);
    assert.equal(listItem.blocked, 0);
    assert.equal(listItem.inProgress, 0);
  });

  it("marks fields unavailable when a source cannot supply them", () => {
    const launch = getLaunchDetailedStatusCounts({ passed: 5, failed: 2 });
    assert.equal(launch.source, "launch");
    assert.equal(launch.passed, 5);
    assert.equal(launch.failed, 2);
    assert.equal(launch.passedManually, undefined);
    assert.ok(launch.unavailable.includes("failedAsKnown"));

    const tcm = getTcmDetailedStatusCounts({ PASSED: 4, FAILED: 1 });
    assert.equal(tcm.source, "tcm");
    assert.equal(tcm.passed, 4);
    assert.equal(tcm.failed, 1);
    assert.equal(tcm.passedManually, undefined);
    assert.ok(tcm.unavailable.includes("passedManually"));

    const widget = getWidgetDetailedStatusCounts({
      passed: 4,
      failed: 1,
      knownIssue: 2,
    });
    assert.equal(widget.source, "widget");
    assert.equal(widget.passed, 4);
    assert.equal(widget.failed, 1);
    assert.equal(widget.knownIssue, 2);
    assert.equal(widget.passedManually, undefined);
  });

  it("deduplicates manual and known-issue conditions", () => {
    const detailed = getTestRunDetailedStatusCounts([
      { passedManually: true, knownIssue: false },
      { passedManually: false, knownIssue: true },
      { passedManually: true, knownIssue: true },
      { passedManually: false, knownIssue: false },
    ]);

    assert.deepEqual(detailed, {
      source: "testRuns",
      manualAndKnownIssue: {
        passedManually: 2,
        knownIssue: 2,
        bothConditions: 1,
        eitherCondition: 3,
        totalConsidered: 4,
        scope: "allLaunchTests",
      },
    });
  });

  it("getTestById parses manual pass without inferring known issue from message", async () => {
    const fixture = {
      id: 500,
      name: "manual override",
      status: "PASSED",
      message: "Assertion failed before reviewer accepted this result",
      startTime: 1_700_000_000_000,
      finishTime: 1_700_000_010_000,
      testRunId: 101,
      passedManually: true,
      knownIssue: false,
    };
    const client = new ZebrunnerReportingClient({
      baseUrl: "https://example.test",
      accessToken: "test-token",
    });
    (client as any).makeAuthenticatedRequest = async (
      method: string,
      url: string,
    ) => {
      assert.equal(method, "GET");
      assert.equal(url, "/api/reporting/v1/launches/101/tests/500?projectId=7");
      return { data: fixture };
    };

    const parsed = await client.getTestById(101, 500, 7);
    const detailed = getTestRunDetailedStatusCounts([parsed], "getTestById fixture");

    assert.equal(detailed.manualAndKnownIssue?.passedManually, 1);
    assert.equal(detailed.manualAndKnownIssue?.knownIssue, 0);
    assert.equal(detailed.manualAndKnownIssue?.eitherCondition, 1);
  });

  it("omits detailed status output by default and adds it when opted in", async () => {
    const fakeClient = {
      getProjectId: async () => 7,
      getLaunch: async () => LaunchResponseSchema.parse(launchFixture),
      jiraResolutionWarning: null,
    };
    const handlers = new ZebrunnerReportingToolHandlers(fakeClient as any);

    const legacy = parseText(await handlers.getLauncherSummary({
      projectKey: "MCP",
      launchId: 101,
    }));
    assert.equal("detailedStatuses" in legacy.testResults, false);
    assert.equal(legacy.testResults.total, 13);

    const optedIn = parseText(await handlers.getLauncherSummary({
      projectKey: "MCP",
      launchId: 101,
      includeDetailedStatuses: true,
    }));
    assert.equal(optedIn.testResults.detailedStatuses.source, "launch");
    assert.equal(optedIn.testResults.detailedStatuses.passedManually, 2);
    assert.equal(optedIn.testResults.detailedStatuses.knownIssue, undefined);
    assert.equal(optedIn.testResults.detailedStatuses.failedAsKnown, 1);
    assert.equal(optedIn.testResults.detailedStatuses.totalConsidered, undefined);
    assert.equal(optedIn.testResults.total, legacy.testResults.total);
  });

  it("answers manual/known counts in count-only, summary-only, and normal modes", async () => {
    const tests = [
      { id: 1, name: "manual", status: "PASSED", passedManually: true, knownIssue: false },
      { id: 2, name: "known", status: "FAILED", passedManually: false, knownIssue: true },
      { id: 3, name: "both", status: "PASSED", passedManually: true, knownIssue: true },
      { id: 4, name: "neither", status: "SKIPPED", passedManually: false, knownIssue: false },
    ].map((test) => TestRunResponseSchema.parse({
      ...test,
      startTime: 1_700_000_000_000,
      finishTime: 1_700_000_010_000,
      testRunId: 101,
    }));
    const fakeClient = {
      config: { baseUrl: "https://example.test" },
      getProjectId: async () => 7,
      getProjectKey: async () => "MCP",
      getLaunch: async () => LaunchResponseSchema.parse(launchFixture),
      getAllTestRuns: async () => ({ items: tests }),
      getAllTestSessions: async () => ({ items: [] }),
      getTestSessionsForTest: async () => ({ items: [] }),
      jiraResolutionWarning: null,
    };
    const handlers = new ZebrunnerReportingToolHandlers(fakeClient as any);

    const legacyCount = JSON.parse((await handlers.getLaunchTestSummary({
      projectKey: "MCP",
      launchId: 101,
      count_only: true,
    })).content[0].text);
    assert.equal("detailedStatuses" in legacyCount, false);

    const countOnly = JSON.parse((await handlers.getLaunchTestSummary({
      projectKey: "MCP",
      launchId: 101,
      count_only: true,
      includeDetailedStatuses: true,
    })).content[0].text);
    assert.equal(countOnly.detailedStatuses.manualAndKnownIssue.passedManually, 2);
    assert.equal(countOnly.detailedStatuses.manualAndKnownIssue.knownIssue, 2);
    assert.equal(countOnly.detailedStatuses.manualAndKnownIssue.bothConditions, 1);
    assert.equal(countOnly.detailedStatuses.manualAndKnownIssue.eitherCondition, 3);
    assert.equal(countOnly.detailedStatuses.manualAndKnownIssue.scope, "allLaunchTests");

    const filteredCount = JSON.parse((await handlers.getLaunchTestSummary({
      projectKey: "MCP",
      launchId: 101,
      count_only: true,
      statusFilter: ["FAILED"],
      includeDetailedStatuses: true,
    })).content[0].text);
    assert.deepEqual(filteredCount.detailedStatuses.manualAndKnownIssue, {
      passedManually: 0,
      knownIssue: 1,
      bothConditions: 0,
      eitherCondition: 1,
      totalConsidered: 1,
      scope: "filteredTests",
    });

    for (const summaryOnly of [true, false]) {
      const result = JSON.parse((await handlers.getLaunchTestSummary({
        projectKey: "MCP",
        launchId: 101,
        summaryOnly,
        includeDetailedStatuses: true,
      })).content[0].text);
      assert.equal(result.testRunDetailedStatuses.manualAndKnownIssue.passedManually, 2);
      assert.equal(result.testRunDetailedStatuses.manualAndKnownIssue.knownIssue, 2);
      assert.equal(result.testRunDetailedStatuses.manualAndKnownIssue.bothConditions, 1);
      assert.equal(result.testRunDetailedStatuses.manualAndKnownIssue.eitherCondition, 3);
      assert.equal(result.testRunDetailedStatuses.manualAndKnownIssue.scope, "allLaunchTests");
      assert.equal(result.summary.totalTests, 4);
    }
  });

  it("preserves weekly pass-rate and rerun eligibility semantics", async () => {
    const tests = [
      { id: 1, name: "automatic", status: "PASSED", passedManually: false, knownIssue: false },
      { id: 2, name: "manual", status: "FAILED", passedManually: true, knownIssue: false },
      { id: 3, name: "failed", status: "FAILED", passedManually: false, knownIssue: true },
    ].map((test) => TestRunResponseSchema.parse({
      ...test,
      startTime: 1_700_000_000_000,
      finishTime: 1_700_000_010_000,
      testRunId: 101,
    }));
    const fakeClient = {
      getLaunch: async () => LaunchResponseSchema.parse(launchFixture),
      getAllTestRuns: async () => ({ items: tests }),
      buildJiraUrl: async () => "https://example.test/issue",
    };
    const handlers = new ZebrunnerReportingToolHandlers(fakeClient as any);
    const metrics = await (handlers as any).getLaunchMetricsForStability(101, 7, false, 0);

    assert.equal(metrics.passed, 2);
    assert.equal(metrics.passedAutomatically, 1);
    assert.equal(metrics.passedManually, 1);
    assert.equal(metrics.passRate, 67);
    assert.deepEqual(metrics.detailedStatuses.manualAndKnownIssue, {
      passedManually: 1,
      knownIssue: 1,
      bothConditions: 0,
      eitherCondition: 2,
      totalConsidered: 3,
      scope: "allLaunchTests",
    });

    const rerunCandidate = { failed: 2, aborted: 1, status: "FINISHED" };
    assert.equal(getLaunchFailureCount(rerunCandidate), 3);
    assert.equal(isLaunchEligibleForFailureRerun(rerunCandidate, 3), true);
    assert.equal(isLaunchEligibleForFailureRerun(rerunCandidate, 4), false);
  });

  it("adds runtime launch/test/attempt details without changing runtime totals", async () => {
    const tests = [
      TestRunResponseSchema.parse({
        id: 1,
        name: "manual",
        status: "PASSED",
        passedManually: true,
        knownIssue: false,
        startTime: 1_700_000_000_000,
        finishTime: 1_700_000_010_000,
        testRunId: 101,
      }),
    ];
    const fakeClient = {
      getLaunch: async () => LaunchResponseSchema.parse({ ...launchFixture, elapsed: 10 }),
      getLaunchAttempts: async () => ({
        items: [{
          id: 1,
          startedAt: "2026-08-06T20:00:00Z",
          finishedAt: "2026-08-06T20:00:10Z",
          finishPassed: 1,
          finishFailed: 0,
          finishSkipped: 0,
          finishKnownIssue: 0,
          finishPassedManually: 1,
        }],
      }),
      getAllTestRuns: async () => ({ items: tests }),
      getAllTestSessions: async () => ({ items: [] }),
      getTestSessionsForTest: async () => ({ items: [] }),
    };
    const handlers = new ZebrunnerReportingToolHandlers(fakeClient as any);
    const result = await (handlers as any).collectLaunchRuntimeMetrics(
      101, 7, false, true, true, "auto", 300, 600
    );

    assert.equal(result.metrics.totalExecutedTests, 13);
    assert.equal(result.attempts.initialRun.passedManually, 1);
    assert.equal(result.launchDetailedStatuses.failedAsKnown, 1);
    assert.equal(
      result.testRunDetailedStatuses.manualAndKnownIssue.passedManually,
      1
    );
  });

  it("adds an opt-in source-aware block to universal reports only", async () => {
    const handler = new ReportHandler(
      {} as any,
      {} as any,
      {} as any,
      async () => [
        { label: "PASSED", value: 8 },
        { label: "FAILED", value: 2 },
        { label: "KNOWN ISSUE", value: 1 },
      ],
      async () => ({ projectId: 7 }),
      {},
    );
    const baseInput = {
      report_types: ["unsupported-for-focused-test"],
      projects: ["MCP"],
      period: "Last 7 Days",
    };

    const legacy = await handler.generateReport(baseInput);
    assert.equal(legacy.content.length, 1);

    const optedIn = await handler.generateReport({
      ...baseInput,
      includeDetailedStatuses: true,
    });
    assert.equal(optedIn.content.length, 2);
    const block = JSON.parse(optedIn.content[1].text);
    assert.equal(block.detailedStatuses[0].dataSource, "widget_sql");
    assert.equal(block.detailedStatuses[0].detailedStatuses.source, "widget");
    assert.equal(block.detailedStatuses[0].detailedStatuses.knownIssue, 1);
  });

  it("wires the opt-in flag across every planned related tool", () => {
    const source = readFileSync("src/server.ts", "utf8");
    assert.match(
      source,
      /const RerunLaunchFailuresSchema = z\.object\(\{[\s\S]*?includeDetailedStatuses:\s*z\.boolean\(\)\.default\(false\)/,
      "rerun_launch_failures must expose an opt-in default-false flag",
    );
    const toolNames = [
      "get_launch_details",
      "get_launch_test_summary",
      "regression_results_analyzer",
      "generate_weekly_regression_stability_report",
      "get_launch_summary",
      "analyze_regression_runtime",
      "generate_report",
      "get_all_launches_for_project",
      "get_all_launches_with_filter",
      "get_platform_results_by_period",
    ];
    for (const toolName of toolNames) {
      const start = source.indexOf(`"${toolName}"`);
      assert.notEqual(start, -1, `${toolName} must be registered`);
      const nextTool = source.indexOf("server.registerTool(", start + toolName.length);
      const registration = source.slice(start, nextTool === -1 ? undefined : nextTool);
      assert.match(
        registration,
        /includeDetailedStatuses:\s*z\.boolean\(\)\.default\(false\)/,
        `${toolName} must expose an opt-in default-false flag`,
      );
    }
  });
});

describe("detailed-status eval prompts", () => {
  const promptIds = [
    "get_launch_test_summary.detailed_statuses",
    "get_launch_test_summary.manual_known_union",
    "get_launch_details.detailed_statuses",
  ];

  it("asks for manual-pass and known-issue counts and demands the opt-in flag", () => {
    for (const id of promptIds) {
      const prompt = EVAL_PROMPTS.find((p) => p.id === id);
      assert.ok(prompt, `missing eval prompt ${id}`);
      assert.ok(
        prompt!.expectedArgKeys?.includes("include_detailed_statuses"),
        `${id} must require the include_detailed_statuses argument`,
      );
      assert.deepEqual(
        prompt!.expectedArgValues,
        { include_detailed_statuses: true },
        `${id} must require the flag to be set to true`,
      );
      assert.equal(prompt!.category, "launch");
    }
  });

  it("covers passed-manually, known-issue, overlap, and either-condition wording", () => {
    const summaryPrompts = promptIds
      .slice(0, 2)
      .map((id) => EVAL_PROMPTS.find((p) => p.id === id)!.promptTemplate.toLowerCase());

    assert.ok(summaryPrompts.some((t) => t.includes("passed manually")));
    assert.ok(summaryPrompts.some((t) => t.includes("known issue")));
    assert.ok(summaryPrompts.some((t) => t.includes("both")));
    assert.ok(summaryPrompts.some((t) => t.includes("either")));
  });

  it("executes against a real launch and asserts the union counters at layer 3", () => {
    const executed = EVAL_PROMPTS.find((p) => p.id === "get_launch_test_summary.manual_known_union")!;
    assert.equal(executed.layer, 3);
    assert.deepEqual(executed.expectedTools, ["adv_get_launch_test_summary"]);
    assert.deepEqual(executed.expectedOutputPatterns, ["passedManually", "eitherCondition"]);
    assert.deepEqual(executed.requiredContext, ["projectKey", "launchId"]);
  });

  it("is gated on the cloud suite because the flag needs a capable model", () => {
    for (const id of promptIds) {
      assert.ok(isCloudEvalPrompt(id), `${id} should run in the cloud eval suite`);
    }
  });
});
