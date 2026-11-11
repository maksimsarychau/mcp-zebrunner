/**
 * Golden-output regression tests for the analysis tools.
 *
 * Baselines in tests/baselines/golden/*.txt were captured on the clean 9.4.4
 * tree BEFORE the artifact-aware changes. They prove that, for tests that
 * carry no artifacts (or with artifact flags turned off), the analysis output
 * is byte-for-byte identical after the change.
 *
 * Re-record intentionally with:  UPDATE_GOLDEN=1 npm run test:unit
 */
process.env.TZ = "UTC";

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ZebrunnerReportingToolHandlers } from "../../src/handlers/reporting-tools.js";
import {
  LAUNCH_ID,
  PROJECT_KEY,
  buildFakeReportingClient,
  normalizeOutput,
  testsFixture,
  testsWithArtifactsFixture,
  textOf,
} from "../helpers/analysis-fixtures.js";

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "baselines", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function handlersFor(tests: any[] = testsFixture) {
  return new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests }) as any);
}

// Artifact flags are explicitly off: the 9.4.4 baselines were captured before artifact evidence existed.
// New artifact output is covered by tests/unit/artifact-evidence*.test.ts.
const NO_ARTIFACTS = { includeArtifacts: false, includePageSource: false } as const;
const baseFailure = { testId: 101, testRunId: LAUNCH_ID, projectKey: PROJECT_KEY, ...NO_ARTIFACTS };

interface Scenario {
  name: string;
  run: () => Promise<string>;
}

const scenarios: Scenario[] = [
  {
    name: "analyze-failure-detailed",
    run: async () => textOf(await handlersFor().analyzeTestFailureById({ ...baseFailure, format: "detailed" })),
  },
  {
    name: "analyze-failure-summary",
    run: async () => textOf(await handlersFor().analyzeTestFailureById({ ...baseFailure, format: "summary" })),
  },
  {
    name: "analyze-failure-jira",
    run: async () => textOf(await handlersFor().analyzeTestFailureById({ ...baseFailure, format: "jira" })),
  },
  {
    name: "analyze-failure-compare-last-passed",
    run: async () =>
      textOf(
        await handlersFor().analyzeTestFailureById({
          ...baseFailure,
          format: "detailed",
          compareWithLastPassed: { enabled: true },
        }),
      ),
  },
  {
    name: "analyze-failure-artifacts-off",
    run: async () =>
      textOf(
        await handlersFor(testsWithArtifactsFixture as any[]).analyzeTestFailureById({
          ...baseFailure,
          format: "detailed",
        }),
      ),
  },
  {
    name: "launch-failures-summary",
    run: async () =>
      textOf(
        await handlersFor().analyzeLaunchFailures({
          testRunId: LAUNCH_ID,
          projectKey: PROJECT_KEY,
          filterType: "all",
          ...NO_ARTIFACTS,
          format: "summary",
        }),
      ),
  },
  {
    name: "launch-failures-detailed-parallel",
    run: async () =>
      textOf(
        await handlersFor().analyzeLaunchFailures({
          testRunId: LAUNCH_ID,
          projectKey: PROJECT_KEY,
          filterType: "all",
          ...NO_ARTIFACTS,
          format: "detailed",
          executionMode: "parallel",
        }),
      ),
  },
  {
    name: "launch-failures-jira-batches",
    run: async () =>
      textOf(
        await handlersFor().analyzeLaunchFailures({
          testRunId: LAUNCH_ID,
          projectKey: PROJECT_KEY,
          filterType: "all",
          ...NO_ARTIFACTS,
          format: "jira",
          executionMode: "batches",
          batchSize: 2,
        }),
      ),
  },
  {
    name: "launch-test-summary-json",
    run: async () =>
      textOf(await handlersFor().getLaunchTestSummary({ projectKey: PROJECT_KEY, launchId: LAUNCH_ID })),
  },
  {
    name: "launch-test-summary-string",
    run: async () =>
      textOf(
        await handlersFor().getLaunchTestSummary({ projectKey: PROJECT_KEY, launchId: LAUNCH_ID, format: "string" }),
      ),
  },
  {
    name: "launch-details",
    run: async () =>
      textOf(
        await handlersFor().getLauncherDetails({
          projectKey: PROJECT_KEY,
          launchId: LAUNCH_ID,
          includeLaunchDetails: true,
          includeTestSessions: true,
          includeJobParameters: false,
          includeDetailedStatuses: false,
          format: "json",
        } as any),
      ),
  },
];

describe("analysis tools: golden outputs (artifacts off / absent)", () => {
  for (const scenario of scenarios) {
    it(`matches baseline: ${scenario.name}`, async () => {
      const actual = normalizeOutput(await scenario.run());
      const file = join(GOLDEN_DIR, `${scenario.name}.txt`);

      if (UPDATE || !existsSync(file)) {
        if (!UPDATE) {
          assert.fail(`Missing golden baseline ${file}. Re-record with UPDATE_GOLDEN=1 only on a verified-clean tree.`);
        }
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(file, actual, "utf8");
        return;
      }

      assert.equal(actual, readFileSync(file, "utf8"));
    });
  }

  it("scenarios are deterministic (run twice, same output)", async () => {
    const a = normalizeOutput(await scenarios[0].run());
    const b = normalizeOutput(await scenarios[0].run());
    assert.equal(a, b);
  });
});

/**
 * Parser contract: analyzeLaunchFailures extracts fields from the per-test
 * analysis text with regexes. If a refactor changes these headings the launch
 * report silently degrades, so pin them here.
 */
describe("analysis tools: parser contract with analyzeLaunchFailures", () => {
  it("per-test summary output exposes the markers parsed by analyzeLaunchFailures", async () => {
    const text = textOf(await handlersFor().analyzeTestFailureById({ ...baseFailure, format: "summary" }));
    // NOTE: analyzeLaunchFailures also looks for "**Error Classification:**", which the summary
    // format does not emit ("**Error Type:**" instead) — pre-existing 9.4.4 behaviour, pinned here.
    assert.match(text, /\*\*Error Type:\*\* [^\n]+/);
    assert.match(text, /\*\*Error \(Short\):\*\*\s*```[^`]+```/);
  });

  it("per-test detailed output exposes the markers parsed by analyzeLaunchFailures", async () => {
    const text = textOf(await handlersFor().analyzeTestFailureById({ ...baseFailure, format: "detailed" }));
    assert.match(text, /- \*\*Root Cause:\*\* [^\n]+/);
    assert.match(text, /### Error Message \(Short\)\s*\n\s*```[^`]+```/);
  });
});
