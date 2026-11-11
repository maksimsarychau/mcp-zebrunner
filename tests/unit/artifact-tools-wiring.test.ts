/**
 * Artifact tools + analysis wiring tests.
 *  - real EnhancedZebrunnerClient against a local HTTP server (size limits, paths, credential safety)
 *  - screenshot-download regression for non-image artifacts (the 9.4.5 XML bug)
 *  - artifact-aware analysis: evidence in output, failure isolation, budget, flags off = unchanged
 */
process.env.TZ = "UTC";

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnhancedZebrunnerClient } from "../../src/api/enhanced-client.js";
import { ArtifactToolHandlers } from "../../src/handlers/artifact-tools.js";
import { ZebrunnerReportingToolHandlers } from "../../src/handlers/reporting-tools.js";
import { ArtifactTooLargeError, getDefaultArtifactDir } from "../../src/utils/artifacts.js";
import {
  LAUNCH_ID,
  PROJECT_KEY,
  buildFakeReportingClient,
  testsFixture,
  textOf,
} from "../helpers/analysis-fixtures.js";

const UUID_XML = "1a1c9e55-48b7-6ce0-f015-a119421211c9";
const UUID_BIG = "3c3e1a77-6ad9-8ea2-1237-c3b3643433eb";
const UUID_NOMETA = "4d4f2b88-7bea-9fb3-2348-d4c4754544fc";
const UUID_500 = "5e503c99-8cfb-a0c4-3459-e5d5865655ad";
const TOKEN = "super-secret-token-123";
const USER = "mcp.user";

const CRASH_XML = `<?xml version="1.0"?><hierarchy><android.widget.TextView class="android.widget.TextView" package="android" text="App keeps stopping"/></hierarchy>`;

interface Seen {
  method: string;
  url: string;
  auth?: string;
}

let server: Server;
let baseUrl = "";
const seen: Seen[] = [];

function handle(req: IncomingMessage, res: ServerResponse) {
  seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization });
  const url = req.url ?? "";
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url === `/api/public/v1/files/${UUID_XML}/metadata`) {
    return json(200, { data: { uuid: UUID_XML, name: "failure_page_source_live.xml", type: "OTHER", sizeInBytes: Buffer.byteLength(CRASH_XML), contentType: "application/xml" } });
  }
  if (url === `/api/public/v1/files/${UUID_XML}`) {
    res.writeHead(200, { "content-type": "application/xml" });
    return res.end(CRASH_XML);
  }
  if (url === `/api/public/v1/files/${UUID_BIG}/metadata`) {
    return json(200, { data: { uuid: UUID_BIG, name: "huge.log", type: "OTHER", sizeInBytes: 50 * 1024 * 1024, contentType: "text/plain" } });
  }
  if (url === `/api/public/v1/files/${UUID_NOMETA}/metadata`) return json(503, { message: "metadata temporarily unavailable" });
  if (url === `/api/public/v1/files/${UUID_NOMETA}`) {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("x".repeat(5000));
  }
  if (url.startsWith(`/api/public/v1/files/${UUID_500}`)) return json(500, { message: "boom" });
  json(404, { message: "not found" });
}

const ORIGINAL_TMPDIR = process.env.TMPDIR;
let isolatedTmp = "";

before(async () => {
  isolatedTmp = mkdtempSync(join(tmpdir(), "zbr-wiring-"));
  process.env.TMPDIR = isolatedTmp;
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/v1`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  if (ORIGINAL_TMPDIR === undefined) delete process.env.TMPDIR;
  else process.env.TMPDIR = ORIGINAL_TMPDIR;
  rmSync(isolatedTmp, { recursive: true, force: true });
});

function realClient() {
  return new EnhancedZebrunnerClient({ baseUrl, username: USER, token: TOKEN, retryAttempts: 1, retryDelay: 1, timeout: 5000 } as any);
}

describe("EnhancedZebrunnerClient file access (local server)", () => {
  it("fetches metadata and bytes from /api/public/v1/files with Basic auth", async () => {
    seen.length = 0;
    const out = await realClient().downloadFileContent(UUID_XML, { maxBytes: 1024 * 1024 });
    assert.equal(out.buffer.toString("utf8"), CRASH_XML);
    assert.equal(out.contentType, "application/xml");
    assert.equal(out.fileName, "failure_page_source_live.xml");
    assert.ok(seen.every((s) => s.url.startsWith("/api/public/v1/files/")), "only v1 files endpoints are called");
    assert.ok(seen.every((s) => s.method === "GET"), "read-only");
    assert.ok(seen.every((s) => s.auth?.startsWith("Basic ")));
  });

  it("refuses by metadata size before downloading any bytes", async () => {
    seen.length = 0;
    await assert.rejects(realClient().downloadFileContent(UUID_BIG, { maxBytes: 1024 * 1024 }), ArtifactTooLargeError);
    assert.ok(!seen.some((s) => s.url === `/api/public/v1/files/${UUID_BIG}`), "bytes endpoint was never hit");
  });

  it("enforces the limit at transport level when metadata is unavailable", async () => {
    await assert.rejects(realClient().downloadFileContent(UUID_NOMETA, { maxBytes: 1000 }), ArtifactTooLargeError);
  });

  it("rejects non-uuid input without calling the network", async () => {
    seen.length = 0;
    await assert.rejects(realClient().downloadFileContent("../../etc/passwd", { maxBytes: 10 }));
    assert.equal(seen.length, 0);
  });
});

describe("credential safety", () => {
  it("never includes the token or Authorization material in tool errors", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient() as any, realClient());
    const res = await handlers.downloadArtifact({ uuid: UUID_500 });
    const text = textOf(res);
    const b64 = Buffer.from(`${USER}:${TOKEN}`).toString("base64");
    assert.ok(!text.includes(TOKEN));
    assert.ok(!text.includes(b64));
    assert.ok(!/authorization/i.test(text));
  });

  it("never includes credentials in a refused / too-large payload", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient() as any, realClient());
    const text = textOf(await handlers.downloadArtifact({ uuid: UUID_BIG }));
    assert.ok(text.includes("too_large"));
    assert.ok(!text.includes(TOKEN));
  });
});

describe("ArtifactToolHandlers", () => {
  const withArtifacts = testsFixture.map((t: any) =>
    t.id === 101
      ? { ...t, artifacts: [{ name: "failure_page_source_live.xml", value: `/files/${UUID_XML}` }, { name: "build", value: "https://ci.test/b/1" }] }
      : t,
  );

  it("lists launch and test artifacts and points to the download tool", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient({ tests: withArtifacts }) as any, realClient());
    const payload = JSON.parse(textOf(await handlers.listTestArtifacts({ projectKey: PROJECT_KEY, launchId: LAUNCH_ID })));
    assert.equal(payload.total, 3); // 1 launch link + 2 on test 101
    const file = payload.artifacts.find((a: any) => a.kind === "file");
    assert.equal(file.uuid, UUID_XML);
    assert.equal(file.testId, 101);
    assert.ok(payload.nextStep.includes("adv_download_artifact"));
  });

  it("returns XML inline by default (the ticket's Steps to Verify)", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient() as any, realClient());
    const out = textOf(await handlers.downloadArtifact({ uuid: UUID_XML }));
    assert.ok(out.includes('"status": "ok"'));
    assert.ok(out.includes('"contentType": "application/xml"'));
    assert.ok(out.includes("App keeps stopping"));
  });

  it("redacts only when asked", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient() as any, undefined);
    const xml = `<n password="true" text="hunter2"/> jane@example.test`;
    const plain = textOf(handlers.deliverBuffer({ buffer: Buffer.from(xml), name: "a.xml", contentType: "application/xml" }));
    assert.ok(plain.includes("hunter2"));
    const red = textOf(handlers.deliverBuffer({ buffer: Buffer.from(xml), name: "a.xml", contentType: "application/xml", redact: true }));
    assert.ok(!red.includes("hunter2"));
    assert.ok(!red.includes("jane@example.test"));
  });

  it("saves into the default dir and refuses paths outside the allow-list", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient() as any, realClient());
    const ok = JSON.parse(textOf(await handlers.downloadArtifact({ uuid: UUID_XML, outputPath: "wiring-test.xml", returnContent: false })));
    assert.equal(ok.status, "ok");
    assert.ok(existsSync(ok.savedTo));
    assert.equal(readFileSync(ok.savedTo, "utf8"), CRASH_XML);
    assert.ok(ok.savedTo.startsWith(getDefaultArtifactDir()) || ok.savedTo.includes("zebrunner-artifacts"));
    rmSync(ok.savedTo, { force: true });

    const refused = JSON.parse(textOf(await handlers.downloadArtifact({ uuid: UUID_XML, outputPath: "/etc/zbr-should-not-exist.xml" })));
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "output_path_not_allowed");
    assert.ok(!existsSync("/etc/zbr-should-not-exist.xml"));
  });

  it("refuses files above the limit with a clear message", async () => {
    const handlers = new ArtifactToolHandlers(buildFakeReportingClient() as any, realClient());
    const refused = JSON.parse(textOf(await handlers.downloadArtifact({ uuid: UUID_BIG })));
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "too_large");
    assert.ok(refused.message.includes("exceeds"));
  });
});

describe("adv_download_test_screenshot regression (XML artifact)", () => {
  it("delegates non-image content to the artifact path instead of failing", async () => {
    const reporting = buildFakeReportingClient();
    let imagePipelineCalled = false;
    reporting.downloadScreenshot = async () => {
      imagePipelineCalled = true;
      return Buffer.from(CRASH_XML);
    };
    const handlers = new ZebrunnerReportingToolHandlers(reporting as any, realClient());
    const out = textOf(await handlers.downloadTestScreenshot({ screenshotUrl: `/files/${UUID_XML}` }));
    assert.equal(imagePipelineCalled, false);
    assert.ok(out.includes("application/xml"));
    assert.ok(out.includes("adv_download_test_screenshot"));
    assert.ok(!/Input buffer|unsupported image|Error downloading screenshot/i.test(out), out.slice(0, 300));
    const status = JSON.parse(out.slice(0, out.indexOf("\n}") + 2));
    assert.equal(status.contentIncluded, true, "textual fallback is returned inline");
    assert.equal(status.savedTo, undefined, "nothing is written to disk without outputPath");
    assert.ok(out.includes(CRASH_XML.slice(0, 20)));
    const dir = getDefaultArtifactDir();
    assert.ok(!existsSync(dir) || readdirSync(dir).length === 0);
  });

  it("writes an image to an allow-listed outputPath and refuses paths outside it", async () => {
    const png = await import("sharp").then((m) =>
      m.default({ create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer(),
    );
    const reporting = buildFakeReportingClient();
    reporting.downloadScreenshot = async () => png;
    const handlers = new ZebrunnerReportingToolHandlers(reporting as any);

    const ok = JSON.parse(textOf(await handlers.downloadTestScreenshot({ screenshotUrl: "https://x.test/shot.png", outputPath: "shots/" })));
    assert.equal(ok.success, true);
    assert.ok(ok.localPath && existsSync(ok.localPath), "file really exists at localPath");
    assert.ok(ok.localPath.includes("zebrunner-artifacts"));

    const refused = JSON.parse(textOf(await handlers.downloadTestScreenshot({ screenshotUrl: "https://x.test/shot.png", outputPath: "/etc/zbr-shot.png" })));
    assert.equal(refused.success, false);
    assert.equal(refused.reason, "output_path_not_allowed");
    assert.ok(!existsSync("/etc/zbr-shot.png"));
  });
});

// ───────────────────────── analysis wiring ─────────────────────────

const CRASH_ARTIFACTS = [{ name: "failure_page_source_live.xml", value: `/files/${UUID_XML}` }];
const testsWithPageSource = testsFixture.map((t: any) => (t.id === 101 || t.id === 102 ? { ...t, artifacts: CRASH_ARTIFACTS } : t));

function fakeTcm(handler: (uuid: string) => Promise<{ buffer: Buffer }>) {
  const calls: string[] = [];
  return {
    calls,
    tcm: {
      downloadFileContent: async (uuid: string) => {
        calls.push(uuid);
        return handler(uuid);
      },
      getFileMetadata: async () => ({ uuid: UUID_XML, contentType: "application/xml" }),
    } as any,
  };
}

describe("artifact-aware analysis", () => {
  const base = { testId: 101, testRunId: LAUNCH_ID, projectKey: PROJECT_KEY };

  it("analyze_test_failure: lists artifacts and refines classification from the page source", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(CRASH_XML) }));
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: testsWithPageSource }) as any, f.tcm);
    const out = textOf(await h.analyzeTestFailureById({ ...base, format: "detailed" }));
    assert.ok(out.includes("failure_page_source_live.xml"));
    assert.ok(out.includes(UUID_XML));
    assert.ok(out.includes("Application Crash / ANR"));
    assert.equal(f.calls.length, 1);
  });

  it("analyze_test_failure: a failing download never breaks the analysis", async () => {
    const f = fakeTcm(async () => {
      throw new Error("Request failed with status code 403");
    });
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: testsWithPageSource }) as any, f.tcm);
    for (const format of ["detailed", "summary", "jira"] as const) {
      const out = textOf(await h.analyzeTestFailureById({ ...base, format }));
      assert.ok(out.length > 500, `${format} analysis still produced`);
      assert.ok(!/Error analyzing test failure/i.test(out), format);
    }
  });

  it("analyze_test_failure: explicit 'none' line when the test has no artifacts", async () => {
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient() as any, fakeTcm(async () => ({ buffer: Buffer.alloc(0) })).tcm);
    const out = textOf(await h.analyzeTestFailureById({ ...base, format: "detailed" }));
    assert.ok(out.includes("No artifacts attached"));
  });

  it("analyze_test_failure: flags off means no artifact calls at all", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(CRASH_XML) }));
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: testsWithPageSource }) as any, f.tcm);
    const out = textOf(await h.analyzeTestFailureById({ ...base, format: "detailed", includeArtifacts: false, includePageSource: false }));
    assert.equal(f.calls.length, 0);
    assert.ok(!out.includes("failure_page_source_live.xml"));
  });

  it("launch analysis: page sources are opt-in and capped by pageSourceMaxTests", async () => {
    const f = fakeTcm(async () => ({ buffer: Buffer.from(CRASH_XML) }));
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: testsWithPageSource }) as any, f.tcm);
    const common = { testRunId: LAUNCH_ID, projectKey: PROJECT_KEY, filterType: "all" as const, format: "summary" as const };

    await h.analyzeLaunchFailures({ ...common });
    assert.equal(f.calls.length, 0, "default does not download page sources");

    const out = textOf(await h.analyzeLaunchFailures({ ...common, includePageSource: true, pageSourceMaxTests: 1 }));
    assert.equal(f.calls.length, 1, "budget of 1 page source per call");
    assert.ok(out.includes("Page sources analyzed"));
  });

  it("launch analysis: one failing page source does not fail the launch report", async () => {
    const f = fakeTcm(async () => {
      throw new Error("timeout of 60000ms exceeded");
    });
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: testsWithPageSource }) as any, f.tcm);
    const out = textOf(
      await h.analyzeLaunchFailures({ testRunId: LAUNCH_ID, projectKey: PROJECT_KEY, filterType: "all", format: "summary", includePageSource: true }),
    );
    assert.ok(out.includes("Executive Summary"));
    assert.ok(out.includes("3 failed tests analyzed"));
  });

  it("rollout: opt-in artifact summaries in launch tools", async () => {
    const h = new ZebrunnerReportingToolHandlers(buildFakeReportingClient({ tests: testsWithPageSource }) as any, undefined);
    const summary = JSON.parse(
      textOf(await h.getLaunchTestSummary({ projectKey: PROJECT_KEY, launchId: LAUNCH_ID, includeArtifacts: true })),
    );
    const t101 = summary.tests.find((t: any) => t.id === 101);
    assert.equal(t101.artifacts.count, 1);
    const plain = JSON.parse(textOf(await h.getLaunchTestSummary({ projectKey: PROJECT_KEY, launchId: LAUNCH_ID })));
    assert.equal(plain.tests.find((t: any) => t.id === 101).artifacts, undefined, "off by default");
  });
});
