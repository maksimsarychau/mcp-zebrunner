/**
 * Secret-leak test: run the new and changed artifact tools through a REAL client (local server)
 * that carries a sentinel token, with client debug logging ON, and assert the sentinel, the
 * Basic-auth base64 and the string "Authorization" never appear in tool output or stderr.
 */
process.env.TZ = "UTC";

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EnhancedZebrunnerClient } from "../../src/api/enhanced-client.js";
import { ArtifactToolHandlers } from "../../src/handlers/artifact-tools.js";
import { ZebrunnerReportingToolHandlers } from "../../src/handlers/reporting-tools.js";
import { LAUNCH_ID, PROJECT_KEY, buildFakeReportingClient, testsFixture, textOf } from "../helpers/analysis-fixtures.js";

const SENTINEL = "SENTINEL-TOKEN-9f3a1c77-do-not-leak";
const USER = "leak.test.user";
const B64 = Buffer.from(`${USER}:${SENTINEL}`).toString("base64");

const OK = "1a1c9e55-48b7-6ce0-f015-a119421211c9";
const BAD = "5e503c99-8cfb-a0c4-3459-e5d5865655ad";
const BIG = "3c3e1a77-6ad9-8ea2-1237-c3b3643433eb";
const XML = `<hierarchy><node class="android.widget.TextView" package="android" text="App keeps stopping"/></hierarchy>`;

let server: Server;
let baseUrl = "";

before(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.includes(`/files/${OK}/metadata`)) return json(200, { uuid: OK, name: "p.xml", contentType: "application/xml", sizeInBytes: XML.length });
    if (url.endsWith(`/files/${OK}`)) {
      res.writeHead(200, { "content-type": "application/xml" });
      return res.end(XML);
    }
    if (url.includes(`/files/${BIG}/metadata`)) return json(200, { uuid: BIG, name: "big.log", contentType: "text/plain", sizeInBytes: 99_000_000 });
    if (url.includes(`/files/-/metadata`)) return json(500, { message: "bulk failed" });
    return json(500, { message: "boom" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/v1`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  const origError = console.error;
  (process.stderr as any).write = (c: any) => {
    chunks.push(String(c));
    return true;
  };
  console.error = (...args: unknown[]) => {
    chunks.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  return fn()
    .then((result) => ({ result, stderr: chunks.join("\n") }))
    .finally(() => {
      (process.stderr as any).write = origWrite;
      console.error = origError;
    });
}

function assertClean(label: string, text: string) {
  assert.ok(!text.includes(SENTINEL), `${label}: token leaked`);
  assert.ok(!text.includes(B64), `${label}: basic-auth base64 leaked`);
  assert.ok(!/authorization/i.test(text), `${label}: Authorization header leaked`);
}

function client() {
  return new EnhancedZebrunnerClient({ baseUrl, username: USER, token: SENTINEL, retryAttempts: 1, retryDelay: 1, timeout: 5000, debug: true } as any);
}

describe("no credentials in output or stderr", () => {
  const tests = testsFixture.map((t: any) =>
    t.id === 101
      ? { ...t, artifacts: [{ name: "failure_page_source_live.xml", value: `/files/${OK}` }, { name: "bad.xml", value: `/files/${BAD}` }] }
      : t,
  );

  const cases: Array<[string, (a: ArtifactToolHandlers, h: ZebrunnerReportingToolHandlers) => Promise<unknown>]> = [
    ["download ok", (a) => a.downloadArtifact({ uuid: OK })],
    ["download 500", (a) => a.downloadArtifact({ uuid: BAD })],
    ["download too large", (a) => a.downloadArtifact({ uuid: BIG })],
    ["download redact", (a) => a.downloadArtifact({ uuid: OK, redact: true })],
    ["metadata ok", (a) => a.getFileMetadataTool({ uuid: OK })],
    ["metadata 500", (a) => a.getFileMetadataTool({ uuid: BAD })],
    ["list with metadata (bulk 500)", (a) => a.listTestArtifacts({ projectKey: PROJECT_KEY, launchId: LAUNCH_ID, includeMetadata: true })],
    [
      "analyze failure with page source",
      (_a, h) => h.analyzeTestFailureById({ testId: 101, testRunId: LAUNCH_ID, projectKey: PROJECT_KEY, format: "detailed" }),
    ],
    [
      "analyze launch with page sources",
      (_a, h) =>
        h.analyzeLaunchFailures({ testRunId: LAUNCH_ID, projectKey: PROJECT_KEY, filterType: "all", format: "summary", includePageSource: true }),
    ],
    [
      "screenshot tool on an artifact uuid",
      (_a, h) => h.downloadTestScreenshot({ screenshotUrl: `/files/${OK}` }),
    ],
  ];

  for (const [label, run] of cases) {
    it(label, async () => {
      const tcm = client();
      const reporting = buildFakeReportingClient({ tests });
      const artifacts = new ArtifactToolHandlers(reporting as any, tcm);
      const handlers = new ZebrunnerReportingToolHandlers(reporting as any, tcm);
      const { result, stderr } = await captureStderr(() => run(artifacts, handlers) as Promise<any>);
      assertClean(`${label} (output)`, typeof result === "string" ? result : textOf(result as any));
      assertClean(`${label} (stderr)`, stderr);
    });
  }
});
