/**
 * v9.4.5: page-source evidence in video analysis.
 *  - PredictionEngine: signals shift the verdict evidence; absent signals leave it untouched
 *  - VideoAnalyzer: evidence is fetched only when requested and never blocks the analysis
 */
process.env.TZ = "UTC";

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PredictionEngine } from "../../src/utils/video-analysis/prediction-engine.js";
import { VideoAnalyzer } from "../../src/utils/video-analysis/analyzer.js";
import { extractPageSourceSignals } from "../../src/utils/artifact-evidence.js";
import type { FailureAnalysis } from "../../src/utils/video-analysis/types.js";

const UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const xml = (inner: string) => `<?xml version="1.0"?><hierarchy rotation="0">${inner}</hierarchy>`;
const CRASH = xml(
  `<android.widget.TextView class="android.widget.TextView" package="android" text="App keeps stopping"/>`,
);
const PERMISSION = xml(
  `<android.widget.Button class="android.widget.Button" package="com.google.android.permissioncontroller" resource-id="com.android.permissioncontroller:id/permission_allow_button" text="Allow"/>`,
);
const HOME = xml(
  `<android.widget.FrameLayout class="android.widget.FrameLayout" package="com.app" resource-id="com.app:id/home_title" text="Home"/>`,
);

function failure(overrides: Partial<FailureAnalysis> = {}): FailureAnalysis {
  return {
    failureTimestamp: "2026-11-11T09:00:00Z",
    failureType: "assertion",
    errorMessage: "Element 'home_title' not found on the screen",
    stackTrace: "",
    failureFrames: [],
    rootCause: { category: "unclear", confidence: 40, reasoning: "n/a", evidence: [] },
    ...overrides,
  };
}

const predict = (signals?: ReturnType<typeof extractPageSourceSignals>) =>
  new PredictionEngine(false).predictIssueType(failure(), null, [], "[]", signals);

describe("PredictionEngine with page-source signals", () => {
  it("is identical with undefined signals and with the argument omitted", () => {
    const omitted = new PredictionEngine(false).predictIssueType(failure(), null, [], "[]");
    assert.deepEqual(predict(undefined), omitted);
  });

  it("a crash dialog adds bug evidence and raises the bug score", () => {
    const base = predict();
    const crash = predict(extractPageSourceSignals(CRASH));
    assert.ok(crash.evidenceForBug.some((e) => /crash\/ANR dialog/i.test(e)));
    assert.ok(!base.evidenceForBug.some((e) => /crash\/ANR dialog/i.test(e)));
  });

  it("a crash dialog tips a borderline failure into a 'bug' verdict", () => {
    // NullPointerException alone scores 25 (< 30 threshold) -> unclear; the crash dialog adds 25 -> bug.
    const npe = failure({ errorMessage: "java.lang.NullPointerException at Foo.bar" });
    const engine = new PredictionEngine(false);
    const without = engine.predictIssueType(npe, null, [], "[]");
    const withCrash = engine.predictIssueType(npe, null, [], "[]", extractPageSourceSignals(CRASH));
    assert.equal(without.verdict, "unclear");
    assert.equal(withCrash.verdict, "bug");
  });

  it("a permission dialog is evidence for a test update, not a bug", () => {
    const p = predict(extractPageSourceSignals(PERMISSION));
    assert.ok(p.evidenceForTestUpdate.some((e) => /permission dialog/i.test(e)));
    assert.ok(!p.evidenceForBug.some((e) => /permission/i.test(e)));
  });

  it("a locator that IS in the page source points at timing, not a missing element", () => {
    const signals = extractPageSourceSignals(HOME, { errorMessage: "Element 'home_title' not found on the screen" });
    assert.ok(signals.locator?.found.length, "fixture sanity: locator found");
    const p = predict(signals);
    assert.ok(p.evidenceForTestUpdate.some((e) => /present in the page source/i.test(e)));
  });

  it("a locator that is NOT in the page source is evidence for a bug", () => {
    const signals = extractPageSourceSignals(CRASH.replace("App keeps stopping", "Other"), {
      errorMessage: "Element 'home_title' not found on the screen",
    });
    assert.ok(signals.locator?.missing.length, "fixture sanity: locator missing");
    const p = predict(signals);
    assert.ok(p.evidenceForBug.some((e) => /absent from the page source/i.test(e)));
  });
});

// ───────────────────────── VideoAnalyzer evidence handling ─────────────────────────

function fakeReporting(artifacts: unknown[]) {
  return {
    getProjectId: async () => 7,
    getProjectKey: async () => "FIX",
    getTestRuns: async () => ({
      items: [{ id: 101, name: "login", message: "Element 'home_title' not found", status: "FAILED", artifacts }],
    }),
    // No sessions -> analysis ends with "No video found" after the evidence step.
    getTestSessionsForTest: async () => ({ items: [] }),
    config: { baseUrl: "https://fixture.zebrunner.test" },
  } as any;
}

function fakeTcm(download: () => Promise<any>) {
  const calls = { download: 0 };
  return {
    calls,
    client: {
      downloadFileContent: async () => {
        calls.download++;
        return download();
      },
    } as any,
  };
}

const PAGE_SOURCE_ARTIFACT = [{ name: "failure_page_source_live.xml", value: `/files/${UUID}` }];
const NO_VIDEO = /No video found for this test execution/;

describe("VideoAnalyzer artifact evidence", () => {
  it("reads the page source when requested (and then continues to the video step)", async () => {
    const tcm = fakeTcm(async () => ({
      buffer: Buffer.from(CRASH),
      metadata: { uuid: UUID, name: "failure_page_source_live.xml", contentType: "application/xml", sizeInBytes: CRASH.length },
      contentType: "application/xml",
      fileName: "failure_page_source_live.xml",
    }));
    const analyzer = new VideoAnalyzer(fakeReporting(PAGE_SOURCE_ARTIFACT), tcm.client, false);
    await assert.rejects(
      analyzer.analyzeTestExecutionVideo({ testId: 101, testRunId: 9001, projectKey: "FIX" } as any),
      NO_VIDEO,
    );
    assert.equal(tcm.calls.download, 1, "page source fetched once with default flags");
  });

  it("does not download anything when evidence is switched off", async () => {
    const tcm = fakeTcm(async () => {
      throw new Error("must not be called");
    });
    const analyzer = new VideoAnalyzer(fakeReporting(PAGE_SOURCE_ARTIFACT), tcm.client, false);
    await assert.rejects(
      analyzer.analyzeTestExecutionVideo({
        testId: 101,
        testRunId: 9001,
        projectKey: "FIX",
        includeArtifactEvidence: false,
        includePageSource: false,
      } as any),
      NO_VIDEO,
    );
    assert.equal(tcm.calls.download, 0);
  });

  it("a failing artifact download never replaces the real outcome", async () => {
    const tcm = fakeTcm(async () => {
      throw new Error("HTTP 500 boom");
    });
    const analyzer = new VideoAnalyzer(fakeReporting(PAGE_SOURCE_ARTIFACT), tcm.client, false);
    await assert.rejects(
      analyzer.analyzeTestExecutionVideo({ testId: 101, testRunId: 9001, projectKey: "FIX" } as any),
      (err: Error) => NO_VIDEO.test(err.message) && !/boom/.test(err.message),
    );
    assert.equal(tcm.calls.download, 1);
  });

  it("works without a Public API client (evidence degrades to a warning)", async () => {
    const analyzer = new VideoAnalyzer(fakeReporting(PAGE_SOURCE_ARTIFACT), undefined, false);
    await assert.rejects(
      analyzer.analyzeTestExecutionVideo({ testId: 101, testRunId: 9001, projectKey: "FIX" } as any),
      NO_VIDEO,
    );
  });

  it("a test without artifacts skips the download entirely", async () => {
    const tcm = fakeTcm(async () => {
      throw new Error("must not be called");
    });
    const analyzer = new VideoAnalyzer(fakeReporting([]), tcm.client, false);
    await assert.rejects(
      analyzer.analyzeTestExecutionVideo({ testId: 101, testRunId: 9001, projectKey: "FIX" } as any),
      NO_VIDEO,
    );
    assert.equal(tcm.calls.download, 0);
  });
});
