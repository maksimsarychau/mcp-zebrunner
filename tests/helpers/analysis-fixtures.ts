/**
 * Deterministic fixtures + fake Reporting client used by the analysis golden
 * tests (tests/unit/analysis-golden.test.ts) and the failure-isolation tests.
 *
 * The fake client implements only the read methods the analysis handlers call.
 * Any additional method a handler needs must be added here explicitly so
 * accidental new network calls show up as test failures.
 */
import {
  LaunchResponseSchema,
  LogsAndScreenshotsResponseSchema,
  TestExecutionHistoryResponseSchema,
  TestRunResponseSchema,
} from "../../src/types/reporting.js";

export const BASE_URL = "https://fixture.zebrunner.test";
export const PROJECT_KEY = "FIX";
export const PROJECT_ID = 42;
export const LAUNCH_ID = 9001;
export const T0 = 1_700_000_000_000;

export const launchFixture = LaunchResponseSchema.parse({
  id: LAUNCH_ID,
  name: "Fixture Regression",
  status: "FAILED",
  projectId: PROJECT_ID,
  startedAt: T0,
  endedAt: T0 + 1_800_000,
  environment: "stage",
  platform: "android",
  build: "app-1.2.3.apk",
  testSuite: { id: 77, name: "Fixture Suite", projectId: PROJECT_ID },
  user: { id: 1, username: "fixture.user", email: "fixture@example.test" },
  passed: 1,
  failed: 3,
  skipped: 0,
  artifacts: [{ name: "app link", value: "https://example.test/app.apk" }],
});

function testRun(overrides: Record<string, unknown>) {
  return TestRunResponseSchema.parse({
    status: "FAILED",
    startTime: T0 + 1000,
    finishTime: T0 + 61_000,
    testRunId: LAUNCH_ID,
    testClass: "com.fixture.LoginTests",
    stability: 0.5,
    ...overrides,
  });
}

export const testsFixture = [
  testRun({
    id: 101,
    name: "login shows home screen",
    message: "Element 'home_title' not found on the screen after 10 seconds",
    testCases: [{ testId: 101, tcmType: "ZEBRUNNER", testCaseId: "FIX-1" }],
  }),
  testRun({
    id: 102,
    name: "checkout completes",
    message: "Timeout waiting for payment confirmation",
    testClass: "com.fixture.CheckoutTests",
  }),
  testRun({
    id: 103,
    name: "profile saves",
    message: "Assertion failed: expected 'Saved' but actual was 'Error'",
    testClass: "com.fixture.ProfileTests",
  }),
  testRun({
    id: 104,
    name: "logout works",
    status: "PASSED",
    message: undefined,
    stability: 1,
  }),
];

/** Same failed test as 101 but carrying launch artifacts (used to prove "off" really means off). */
export const testsWithArtifactsFixture = testsFixture.map((t) =>
  t.id === 101
    ? {
        ...t,
        artifacts: [
          { name: "failure_page_source_live.xml", value: "/files/1a1c9e55-48b7-6ce0-f015-a119421211c9" },
          { name: "build link", value: "https://example.test/build/1" },
        ],
      }
    : t,
);

export const logsFixture = LogsAndScreenshotsResponseSchema.parse({
  items: [
    { kind: "log", level: "INFO", instant: "2023-11-14T22:13:21.000Z", value: "Login button is clicked" },
    { kind: "log", level: "INFO", instant: "2023-11-14T22:13:22.000Z", value: "Navigating to home" },
    { kind: "log", level: "WARN", instant: "2023-11-14T22:13:23.000Z", value: "Slow response" },
    { kind: "log", level: "ERROR", instant: "2023-11-14T22:13:24.000Z", value: "Element 'home_title' not found" },
    { kind: "screenshot", instant: "2023-11-14T22:13:25.000Z", value: "/files/aaaaaaaa-0000-0000-0000-000000000001" },
  ],
});

export const historyFixture = TestExecutionHistoryResponseSchema.parse({
  items: [
    { testId: 101, status: "FAILED", passedManually: false, elapsed: 60_000, issueReferences: [], testRunId: LAUNCH_ID, startTime: T0 },
    { testId: 55, status: "PASSED", passedManually: false, elapsed: 30_000, issueReferences: [], testRunId: 8000, startTime: T0 - 86_400_000 },
  ],
});

export interface FakeClientOptions {
  tests?: ReturnType<typeof testRun>[] | Array<Record<string, unknown>>;
  logs?: unknown;
  history?: unknown;
  /** Extra / overriding methods (used by failure-isolation tests). */
  overrides?: Record<string, unknown>;
}

export function buildFakeReportingClient(opts: FakeClientOptions = {}) {
  const tests = (opts.tests ?? testsFixture) as any[];
  const calls: string[] = [];
  const track = <T extends (...a: any[]) => any>(name: string, fn: T) =>
    ((...args: any[]) => {
      calls.push(name);
      return fn(...args);
    }) as T;

  const client: any = {
    config: { baseUrl: BASE_URL, debug: false },
    jiraResolutionWarning: null,
    calls,
    getProject: track("getProject", async () => ({ id: PROJECT_ID, key: PROJECT_KEY, name: "Fixture", deleted: false, createdAt: "2023-01-01" })),
    getProjectId: track("getProjectId", async () => PROJECT_ID),
    getProjectKey: track("getProjectKey", async () => PROJECT_KEY),
    getLaunch: track("getLaunch", async () => launchFixture),
    getAllTestRuns: track("getAllTestRuns", async () => ({ items: tests })),
    getTestRuns: track("getTestRuns", async () => ({ items: tests })),
    getTestById: track("getTestById", async (_l: number, id: number) => tests.find((t) => t.id === id)),
    getTestLogsAndScreenshots: track("getTestLogsAndScreenshots", async () => opts.logs ?? logsFixture),
    getTestExecutionHistory: track("getTestExecutionHistory", async () => opts.history ?? historyFixture),
    getTestSessionsForTest: track("getTestSessionsForTest", async () => ({ items: [] })),
    getAllTestSessions: track("getAllTestSessions", async () => ({ items: [] })),
    getTestSessions: track("getTestSessions", async () => ({ items: [] })),
    getLaunchJobParameters: track("getLaunchJobParameters", async () => ({ items: [] })),
    getLaunchAttempts: track("getLaunchAttempts", async () => ({ items: [] })),
    buildJiraUrl: track("buildJiraUrl", async (key: string) => `https://jira.fixture.test/browse/${key}`),
    ...(opts.overrides ?? {}),
  };
  return client;
}

/** Strip wall-clock dependent fragments so outputs are comparable across runs. */
export function normalizeOutput(text: string): string {
  return text
    .replace(/\*Analysis generated at [^*]+\*/g, "*Analysis generated at <NOW>*")
    .replace(/_Analysis Date: [^_]+_/g, "_Analysis Date: <NOW>_")
    .replace(/\*\*Analysis Date:\*\* [^\n]+/g, "**Analysis Date:** <NOW>")
    .replace(/Generated: [^\n]+/g, "Generated: <NOW>")
    .replace(/Analysis completed in [\d.]+s/g, "Analysis completed in <T>s")
    .replace(/Analysis Duration[^\n]*/g, "Analysis Duration <T>");
}

export function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
}
