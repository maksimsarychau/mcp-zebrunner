/**
 * v9.4.5: steering hint for launch analysis + per-call page-source limits
 * (pageSourceMaxTests input and ARTIFACT_EVIDENCE_MAX_FILES env).
 */
process.env.TZ = "UTC";

import { describe, it, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { steeringHint } from "../../src/helpers/steering.js";
import { EvidenceBudget, getEvidenceMaxFiles } from "../../src/utils/artifact-evidence.js";
import { ZebrunnerReportingToolHandlers } from "../../src/handlers/reporting-tools.js";
import { LAUNCH_ID, PROJECT_KEY, buildFakeReportingClient, testsFixture, textOf } from "../helpers/analysis-fixtures.js";

const ENV_KEY = "ARTIFACT_EVIDENCE_MAX_FILES";
const savedEnv = process.env[ENV_KEY];
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
});

describe("steeringHint(analyze_launch_failures_artifacts)", () => {
  it("points at includePageSource and the artifact tools with the launch id", () => {
    const hint = steeringHint("analyze_launch_failures_artifacts", { id: 140961 });
    assert.ok(hint.startsWith("\n\nTip: Next steps:"), "uses the standard Tip format");
    assert.ok(hint.includes("includePageSource: true"));
    assert.ok(hint.includes("pageSourceMaxTests"));
    assert.ok(hint.includes("adv_list_test_artifacts with launchId: 140961"));
    assert.ok(hint.includes("adv_download_artifact"));
  });
});

describe("ARTIFACT_EVIDENCE_MAX_FILES", () => {
  it("defaults to 10", () => {
    assert.equal(getEvidenceMaxFiles({}), 10);
  });
  it("accepts a positive integer", () => {
    assert.equal(getEvidenceMaxFiles({ [ENV_KEY]: "3" }), 3);
  });
  for (const bad of ["", "0", "-4", "abc", "NaN"]) {
    it(`falls back to 10 for ${JSON.stringify(bad)}`, () => {
      assert.equal(getEvidenceMaxFiles({ [ENV_KEY]: bad }), 10);
    });
  }
  it("a default-constructed EvidenceBudget reads the env at construction time", () => {
    process.env[ENV_KEY] = "2";
    const budget = new EvidenceBudget();
    assert.equal(budget.take(), true);
    assert.equal(budget.take(), true);
    assert.equal(budget.take(), false, "third page source is refused");
    assert.equal(budget.left, 0);
  });
});

// ───────────────────────── launch analysis wiring ─────────────────────────

const UUID = "1a1c9e55-48b7-6ce0-f015-a119421211c9";
const HOME = `<?xml version="1.0"?><hierarchy><android.widget.FrameLayout class="android.widget.FrameLayout" package="com.app" resource-id="com.app:id/home_title" text="Home"/></hierarchy>`;

/** Every failed fixture test carries a page-source artifact. */
const failedWithPageSource = testsFixture.map((t: any) =>
  t.status === "FAILED"
    ? { ...t, artifacts: [{ name: "failure_page_source_live.xml", value: `/files/${UUID}` }] }
    : t,
);

function launchHandlers() {
  const calls = { download: 0 };
  const tcm: any = {
    downloadFileContent: async () => {
      calls.download++;
      return {
        buffer: Buffer.from(HOME),
        metadata: { uuid: UUID, name: "failure_page_source_live.xml", contentType: "application/xml", sizeInBytes: HOME.length },
        contentType: "application/xml",
        fileName: "failure_page_source_live.xml",
      };
    },
  };
  const handlers = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: failedWithPageSource }) as any, tcm);
  return { handlers, calls };
}

const base = { testRunId: LAUNCH_ID, projectKey: PROJECT_KEY, filterType: "all" as const };

describe("analyzeLaunchFailures steering hint", () => {
  it("is appended by default (artifacts listed, page sources not requested)", async () => {
    const { handlers, calls } = launchHandlers();
    const text = textOf(await handlers.analyzeLaunchFailures({ ...base }));
    assert.ok(text.includes("includePageSource: true"), "hint shown");
    assert.equal(calls.download, 0, "default run downloads nothing");
  });

  it("is omitted once page sources were requested", async () => {
    const { handlers } = launchHandlers();
    const text = textOf(await handlers.analyzeLaunchFailures({ ...base, includePageSource: true }));
    assert.ok(!text.includes("rerun with includePageSource: true"), "no 'rerun' hint when already requested");
  });

  it("is omitted when artifacts are switched off", async () => {
    const { handlers } = launchHandlers();
    const text = textOf(await handlers.analyzeLaunchFailures({ ...base, includeArtifacts: false }));
    assert.ok(!text.includes("rerun with includePageSource: true"));
  });
});

describe("analyzeLaunchFailures page-source limits", () => {
  it("pageSourceMaxTests caps downloads", async () => {
    const { handlers, calls } = launchHandlers();
    const text = textOf(await handlers.analyzeLaunchFailures({ ...base, includePageSource: true, pageSourceMaxTests: 2 }));
    assert.equal(calls.download, 2);
    assert.match(text, /Page sources analyzed:\*\* 2 of 3 test\(s\) \(limit 2\)/);
  });

  it("the env cap wins when it is lower than pageSourceMaxTests", async () => {
    process.env[ENV_KEY] = "1";
    const { handlers, calls } = launchHandlers();
    await handlers.analyzeLaunchFailures({ ...base, includePageSource: true, pageSourceMaxTests: 5 });
    assert.equal(calls.download, 1);
  });

  it("without limits every failed test is analyzed", async () => {
    delete process.env[ENV_KEY];
    const { handlers, calls } = launchHandlers();
    await handlers.analyzeLaunchFailures({ ...base, includePageSource: true });
    assert.equal(calls.download, 3);
  });
});
