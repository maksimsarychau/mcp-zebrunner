import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { ZebrunnerReportingClient } from "../../src/api/reporting-client.js";
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
    assert.equal(launch.passedManually, "unavailable");
    assert.equal(launch.knownIssue, "unavailable");
    assert.equal(launch.bothConditions, "unavailable");
    assert.ok(launch.unavailable.includes("failedAsKnown"));

    const tcm = getTcmDetailedStatusCounts({ PASSED: 4, FAILED: 1 });
    assert.equal(tcm.source, "tcm");
    assert.equal(tcm.passedManually, "unavailable");
    assert.equal(tcm.knownIssue, "unavailable");

    const widget = getWidgetDetailedStatusCounts({
      passed: 4,
      failed: 1,
      knownIssue: 2,
    });
    assert.equal(widget.source, "widget");
    assert.equal(widget.knownIssue, 2);
    assert.equal(widget.passedManually, "unavailable");
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
      scope: "all test runs",
      passedManually: 2,
      knownIssue: 2,
      bothConditions: 1,
      eitherCondition: 3,
      totalConsidered: 4,
      unavailable: [],
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

    assert.equal(detailed.passedManually, 1);
    assert.equal(detailed.knownIssue, 0);
    assert.equal(detailed.eitherCondition, 1);
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
    assert.equal(optedIn.testResults.detailedStatuses.knownIssue, "unavailable");
    assert.equal(optedIn.testResults.detailedStatuses.buckets.failedAsKnown, 1);
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
    assert.equal(countOnly.detailedStatuses.passedManually, 2);
    assert.equal(countOnly.detailedStatuses.knownIssue, 2);
    assert.equal(countOnly.detailedStatuses.bothConditions, 1);
    assert.equal(countOnly.detailedStatuses.eitherCondition, 3);

    for (const summaryOnly of [true, false]) {
      const result = JSON.parse((await handlers.getLaunchTestSummary({
        projectKey: "MCP",
        launchId: 101,
        summaryOnly,
        includeDetailedStatuses: true,
      })).content[0].text);
      assert.equal(result.testRunDetailedStatuses.passedManually, 2);
      assert.equal(result.testRunDetailedStatuses.knownIssue, 2);
      assert.equal(result.testRunDetailedStatuses.bothConditions, 1);
      assert.equal(result.testRunDetailedStatuses.eitherCondition, 3);
      assert.equal(result.summary.totalTests, 4);
    }
  });
});
