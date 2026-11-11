/**
 * Unit tests for src/utils/artifact-evidence.ts (signals, loading, classification, rendering).
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  EvidenceBudget,
  diffArtifactNames,
  diffSignals,
  extractLocatorCandidates,
  extractPageSourceSignals,
  loadArtifactEvidence,
  refineClassification,
  renderEvidenceJira,
  renderEvidenceMarkdown,
  selectPageSource,
  signalSummary,
  type ArtifactEvidence,
} from "../../src/utils/artifact-evidence.js";
import { collectArtifacts } from "../../src/utils/artifacts.js";

const UUID = "1a1c9e55-48b7-6ce0-f015-a119421211c9";
const UUID2 = "2b2d0f66-59c8-7df1-0126-b2a2532322da";

const androidXml = (inner: string) =>
  `<?xml version="1.0"?><hierarchy rotation="0">${inner}</hierarchy>`;

const HOME = androidXml(
  `<android.widget.FrameLayout class="android.widget.FrameLayout" package="com.app" resource-id="com.app:id/home_title" text="Home"/>`,
);
const CRASH = androidXml(
  `<android.widget.FrameLayout class="android.widget.FrameLayout" package="android" resource-id="android:id/aerr_close" text="Close app"/>
   <android.widget.TextView class="android.widget.TextView" package="android" text="App keeps stopping"/>`,
);
const ANR = androidXml(`<android.widget.TextView class="android.widget.TextView" package="android" text="App isn't responding"/>`);
const PERMISSION = androidXml(
  `<android.widget.Button class="android.widget.Button" package="com.google.android.permissioncontroller" resource-id="com.android.permissioncontroller:id/permission_allow_button" text="Allow"/>`,
);
const KEYBOARD_LOADING = androidXml(
  `<android.widget.FrameLayout class="android.widget.FrameLayout" package="com.google.android.inputmethod.latin" resource-id="x"/>
   <android.widget.ProgressBar class="android.widget.ProgressBar" package="com.app" resource-id="com.app:id/loading_spinner"/>
   <android.widget.Toast class="android.widget.Toast" package="com.app" text="Saved offline"/>`,
);
const IOS = `<AppiumAUT><XCUIElementTypeApplication name="App"><XCUIElementTypeKeyboard name="kb"/></XCUIElementTypeApplication></AppiumAUT>`;

describe("page source signals", () => {
  it("detects a healthy screen with nothing notable", () => {
    const s = extractPageSourceSignals(HOME);
    assert.equal(s.platform, "android");
    assert.equal(s.crashDialog, false);
    assert.equal(s.anrDialog, false);
    assert.equal(s.permissionDialog, false);
    assert.equal(signalSummary({ artifacts: [], warnings: [], pageSource: { name: "x", uuid: UUID, signals: s, redacted: false } }), "");
  });

  it("detects crash and ANR dialogs", () => {
    assert.equal(extractPageSourceSignals(CRASH).crashDialog, true);
    const anr = extractPageSourceSignals(ANR);
    assert.equal(anr.anrDialog, true);
  });

  it("detects permission dialogs, keyboard, loading and toast", () => {
    assert.equal(extractPageSourceSignals(PERMISSION).permissionDialog, true);
    const s = extractPageSourceSignals(KEYBOARD_LOADING);
    assert.equal(s.keyboardVisible, true);
    assert.equal(s.loadingIndicator, true);
    assert.deepEqual(s.toasts, ["Saved offline"]);
  });

  it("detects iOS and keyboard on iOS", () => {
    const s = extractPageSourceSignals(IOS);
    assert.equal(s.platform, "ios");
    assert.equal(s.keyboardVisible, true);
  });

  it("checks locators mentioned in the error message", () => {
    const found = extractPageSourceSignals(HOME, { errorMessage: "Element 'home_title' not found" });
    assert.deepEqual(found.locator?.found, ["home_title"]);
    const missing = extractPageSourceSignals(HOME, { errorMessage: "Element 'checkout_button' not found" });
    assert.deepEqual(missing.locator?.missing, ["checkout_button"]);
  });

  it("extracts locator candidates safely from odd messages", () => {
    assert.deepEqual(extractLocatorCandidates(undefined), []);
    assert.ok(extractLocatorCandidates("no such element: id=com.app:id/btn").length >= 1);
  });

  it("does not throw on garbage input", () => {
    assert.doesNotThrow(() => extractPageSourceSignals("not xml at all <<<>>>"));
    assert.equal(extractPageSourceSignals("").platform, "unknown");
  });

  it("diffSignals reports what only the failed run has", () => {
    const diffs = diffSignals(extractPageSourceSignals(CRASH), extractPageSourceSignals(HOME));
    assert.ok(diffs.some((d) => /Crash dialog/.test(d)));
    assert.deepEqual(diffSignals(extractPageSourceSignals(HOME), extractPageSourceSignals(HOME)), []);
  });

  it("diffArtifactNames splits by side", () => {
    const a = collectArtifacts({ tests: [{ id: 1, artifacts: [{ name: "a", value: `/files/${UUID}` }, { name: "b", value: `/files/${UUID2}` }] }] });
    const b = collectArtifacts({ tests: [{ id: 2, artifacts: [{ name: "b", value: `/files/${UUID2}` }, { name: "c", value: `/files/${UUID}` }] }] });
    assert.deepEqual(diffArtifactNames(a, b), { onlyFailed: ["a"], onlyPassed: ["c"] });
  });
});

describe("selectPageSource", () => {
  it("prefers failure_page_source files, newest last", () => {
    const items = collectArtifacts({
      tests: [
        {
          id: 1,
          artifacts: [
            { name: "other_page_source.xml", value: `/files/${UUID2}` },
            { name: "failure_page_source_1.xml", value: `/files/${UUID}` },
          ],
        },
      ],
    });
    assert.equal(selectPageSource(items)?.uuid, UUID);
  });

  it("returns undefined when nothing looks like a page source", () => {
    const items = collectArtifacts({ tests: [{ id: 1, artifacts: [{ name: "log.txt", value: `/files/${UUID}` }] }] });
    assert.equal(selectPageSource(items), undefined);
  });
});

function fakeTcm(handler: (uuid: string) => Promise<{ buffer: Buffer }>) {
  const calls: string[] = [];
  return {
    calls,
    tcm: {
      downloadFileContent: async (uuid: string) => {
        calls.push(uuid);
        return handler(uuid);
      },
    } as any,
  };
}

const PS_ARTIFACTS = [{ name: "failure_page_source_live.xml", value: `/files/${UUID}` }];

describe("loadArtifactEvidence", () => {
  it("returns null when nothing is requested", async () => {
    assert.equal(await loadArtifactEvidence({ testArtifacts: PS_ARTIFACTS }), null);
  });

  it("lists artifacts without downloading when includePageSource is false", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(HOME) }));
    const ev = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includeArtifacts: true });
    assert.equal(ev?.artifacts.length, 1);
    assert.equal(f.calls.length, 0);
    assert.equal(ev?.pageSource, undefined);
  });

  it("downloads and analyzes the page source", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(CRASH) }));
    const ev = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includePageSource: true, includeArtifacts: true });
    assert.equal(ev?.pageSource?.signals.crashDialog, true);
    assert.deepEqual(f.calls, [UUID]);
  });

  it("applies redaction to derived text only when asked", async () => {
    const xml = androidXml(`<android.widget.Toast class="android.widget.Toast" text="mail jane@example.com"/>`);
    const f = fakeTcm(async () => ({ buffer: Buffer.from(xml) }));
    const plain = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includePageSource: true });
    assert.ok(plain?.pageSource?.signals.toasts[0].includes("jane@example.com"));
    const red = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includePageSource: true, redact: true });
    assert.ok(!JSON.stringify(red).includes("jane@example.com"));
    assert.equal(red?.pageSource?.redacted, true);
  });

  const failures: Array<[string, Error]> = [
    ["404 not found", new Error("Request failed with status code 404")],
    ["403 forbidden", new Error("Request failed with status code 403")],
    ["500 server error", new Error("Request failed with status code 500")],
    ["timeout", new Error("timeout of 60000ms exceeded")],
    ["oversize", new Error("Artifact is 99 bytes, which exceeds the return limit of 10 bytes.")],
  ];
  for (const [label, err] of failures) {
    it(`isolates download failure: ${label}`, async () => {
      const f = fakeTcm(async () => {
        throw err;
      });
      const ev = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includePageSource: true, includeArtifacts: true });
      assert.ok(ev, "evidence is still returned");
      assert.equal(ev?.artifacts.length, 1);
      assert.equal(ev?.pageSource, undefined);
      assert.equal(ev?.warnings.length, 1);
      assert.ok(ev?.warnings[0].includes("could not be analyzed"));
    });
  }

  it("warns when no client is available", async () => {
    const ev = await loadArtifactEvidence({ testArtifacts: PS_ARTIFACTS, includePageSource: true });
    assert.ok(ev?.warnings[0].includes("unavailable"));
  });

  it("stops downloading once the budget is spent", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(HOME) }));
    const budget = new EvidenceBudget(1);
    const first = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includePageSource: true, budget });
    const second = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: PS_ARTIFACTS, includePageSource: true, budget });
    assert.ok(first?.pageSource);
    assert.equal(second?.pageSource, undefined);
    assert.ok(second?.warnings[0].includes("limit"));
    assert.equal(f.calls.length, 1);
  });

  it("does not warn when a test has no page source", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(HOME) }));
    const ev = await loadArtifactEvidence({ tcm: f.tcm, testArtifacts: [], includePageSource: true, includeArtifacts: true });
    assert.deepEqual(ev?.warnings, []);
    assert.equal(f.calls.length, 0);
  });
});

describe("refineClassification", () => {
  const base = { category: "Locator Issue", confidence: "High", reasons: ["Element not found"] };
  const ev = (xml: string, msg?: string): ArtifactEvidence => ({
    artifacts: [],
    warnings: [],
    pageSource: { name: "p.xml", uuid: UUID, redacted: false, signals: extractPageSourceSignals(xml, { errorMessage: msg }) },
  });

  it("returns the input untouched without a page source (backward compatible)", () => {
    assert.equal(refineClassification(base, null), base);
    assert.equal(refineClassification(base, { artifacts: [], warnings: [] }), base);
  });

  it("flips to crash when a crash dialog is visible", () => {
    assert.equal(refineClassification(base, ev(CRASH)).category, "Application Crash / ANR");
  });

  it("flags a permission dialog as a test setup issue", () => {
    assert.equal(refineClassification(base, ev(PERMISSION)).category, "Test Setup Issue");
  });

  it("downgrades Locator Issue to Timing Issue when the locator is present", () => {
    const r = refineClassification(base, ev(HOME, "Element 'home_title' not found"));
    assert.equal(r.category, "Timing Issue");
  });

  it("keeps Locator Issue and raises confidence when the locator is missing", () => {
    const r = refineClassification({ ...base, confidence: "Medium" }, ev(HOME, "Element 'nope_btn' not found"));
    assert.equal(r.category, "Locator Issue");
    assert.equal(r.confidence, "High");
  });
});

describe("rendering", () => {
  const evidence: ArtifactEvidence = {
    artifacts: collectArtifacts({
      tests: [{ id: 1, artifacts: [{ name: "failure_page_source.xml", value: `/files/${UUID}` }, { name: "signed", value: "https://b.test/x?X-Amz-Signature=topsecret" }] }],
    }),
    warnings: ["something failed"],
    pageSource: { name: "failure_page_source.xml", uuid: UUID, redacted: false, signals: extractPageSourceSignals(CRASH) },
  };

  it("renders detailed markdown with uuid, signals, warnings and no secrets", () => {
    const md = renderEvidenceMarkdown(evidence, { format: "detailed", baseUrl: "https://ws.test" });
    assert.ok(md.includes(UUID));
    assert.ok(md.includes("Crash dialog"));
    assert.ok(md.includes("something failed"));
    assert.ok(!md.includes("topsecret"));
  });

  it("renders summary and jira blocks", () => {
    assert.ok(renderEvidenceMarkdown(evidence, { format: "summary" }).includes("**Artifacts:** 2"));
    const jira = renderEvidenceJira(evidence, "https://ws.test");
    assert.ok(jira.startsWith("h3. Artifacts"));
    assert.ok(!jira.includes("topsecret"));
  });

  it("prints a 'none' line only when asked", () => {
    const empty: ArtifactEvidence = { artifacts: [], warnings: [] };
    assert.equal(renderEvidenceMarkdown(empty, { format: "detailed" }), "");
    assert.ok(renderEvidenceMarkdown(empty, { format: "detailed", showNone: true }).includes("No artifacts attached"));
    assert.equal(renderEvidenceMarkdown(null, { format: "detailed", showNone: true }), "");
    assert.equal(renderEvidenceJira(empty), "");
  });
});

describe("video prediction uses page-source signals (optional 5th argument)", () => {
  const failure: any = {
    failureType: "Unknown",
    errorMessage: "something odd",
    rootCause: { category: "unknown", reasoning: "n/a", confidence: 0 },
  };

  it("is unchanged without signals and shifts toward bug on a crash dialog", async () => {
    const { PredictionEngine } = await import("../../src/utils/video-analysis/prediction-engine.js");
    const engine = new PredictionEngine(false);
    const without = engine.predictIssueType(failure, null, [], "");
    const withoutExplicit = engine.predictIssueType(failure, null, [], "", undefined);
    assert.deepEqual(without, withoutExplicit);

    const crash = engine.predictIssueType(failure, null, [], "", extractPageSourceSignals(CRASH));
    const text = JSON.stringify(crash);
    assert.ok(/crash/i.test(text), "crash evidence is cited");
    assert.notDeepEqual(crash, without);
  });
});
