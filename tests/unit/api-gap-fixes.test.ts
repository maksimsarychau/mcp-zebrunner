/**
 * Regression tests for the four v9.4.5 API-gap fixes, against a local HTTP server:
 *  1. AZURE_DEVOPS is an accepted issue type on test-run test cases
 *  2. getTestCaseById unwraps the Public API v1 `{ data: {...} }` envelope (and still accepts a bare object)
 *  3. getTestSuite uses the direct GET /test-suites/{id} and falls back to list+cache (never on auth errors)
 *  4. testConnection sends `maxPageSize` (not the ignored `size`)
 */
process.env.TZ = "UTC";

import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ZebrunnerApiClient } from "../../src/api/client.js";
import { EnhancedZebrunnerClient } from "../../src/api/enhanced-client.js";
import { PublicTestRunTestCaseResourceSchema } from "../../src/types/core.js";
import { ZebrunnerAuthError } from "../../src/types/api.js";

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
}

let server: Server;
let baseUrl = "";
const seen: Seen[] = [];

function handle(req: IncomingMessage, res: ServerResponse) {
  const u = new URL(req.url ?? "/", "http://localhost");
  seen.push({ method: req.method ?? "", path: u.pathname, query: u.searchParams });
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const p = u.pathname.replace("/api/public/v1", "");

  // test cases: 11 = wrapped envelope, 12 = bare object
  if (p === "/test-cases/11") return json(200, { data: { id: 11, key: "FIX-11", title: "wrapped" } });
  if (p === "/test-cases/12") return json(200, { id: 12, key: "FIX-12", title: "bare" });

  // suites: 21 = direct hit, 22 = direct 404 -> list fallback, 23 = auth error on direct call
  if (p === "/test-suites/21") return json(200, { data: { id: 21, title: "Direct suite" } });
  if (p === "/test-suites/22") return json(404, { message: "no such endpoint on this workspace" });
  if (p === "/test-suites/23") return json(401, { message: "unauthorized" });
  if (p === "/test-suites") {
    return json(200, {
      items: [
        { id: 22, title: "Fallback suite", parentSuiteId: null },
        { id: 24, title: "Other suite", parentSuiteId: null },
      ],
      _meta: {},
    });
  }
  json(404, { message: "not found" });
}

before(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/v1`;
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const cfg = () => ({ baseUrl, username: "u", token: "t", retryAttempts: 1, retryDelay: 1, timeout: 5000 }) as any;

describe("AZURE_DEVOPS issue type", () => {
  const base = {
    testCase: { id: 1, key: "FIX-1", title: "t" },
    result: { status: { id: 1, name: "PASSED" }, attachments: [] },
  };
  for (const type of ["JIRA", "GITHUB", "AZURE_DEVOPS"]) {
    it(`accepts ${type}`, () => {
      const parsed = PublicTestRunTestCaseResourceSchema.safeParse({
        ...base,
        result: { ...base.result, issue: { type, id: "X-1" } },
      });
      assert.equal(parsed.success, true, `${type} should parse`);
    });
  }
  it("still rejects unknown issue types", () => {
    const parsed = PublicTestRunTestCaseResourceSchema.safeParse({
      ...base,
      result: { ...base.result, issue: { type: "TRELLO", id: "X-1" } },
    });
    assert.equal(parsed.success, false);
  });
});

describe("getTestCaseById envelope handling", () => {
  it("unwraps { data: {...} }", async () => {
    const tc = await new ZebrunnerApiClient(cfg()).getTestCaseById("FIX", 11);
    assert.equal(tc.id, 11);
    assert.equal(tc.key, "FIX-11");
  });
  it("still accepts a bare object", async () => {
    const tc = await new ZebrunnerApiClient(cfg()).getTestCaseById("FIX", 12);
    assert.equal(tc.id, 12);
    assert.equal(tc.title, "bare");
  });
});

describe("getTestSuite direct GET", () => {
  it("uses GET /test-suites/{id} and does not list all suites", async () => {
    seen.length = 0;
    const suite = await new EnhancedZebrunnerClient(cfg()).getTestSuite("FIX", 21);
    assert.equal(suite.id, 21);
    assert.ok(seen.some((s) => s.path.endsWith("/test-suites/21")));
    assert.ok(!seen.some((s) => s.path.endsWith("/test-suites")), "no list call when the direct call works");
  });

  it("falls back to list + cache when the direct call fails", async () => {
    seen.length = 0;
    const suite = await new EnhancedZebrunnerClient(cfg()).getTestSuite("FIX", 22);
    assert.equal(suite.id, 22);
    assert.equal(suite.title, "Fallback suite");
    assert.ok(seen.some((s) => s.path.endsWith("/test-suites")), "list endpoint used as fallback");
  });

  it("does not hide authentication errors behind the fallback", async () => {
    seen.length = 0;
    await assert.rejects(new EnhancedZebrunnerClient(cfg()).getTestSuite("FIX", 23), ZebrunnerAuthError);
    assert.ok(!seen.some((s) => s.path.endsWith("/test-suites")), "no list fallback after 401");
  });
});

describe("testConnection page-size parameter", () => {
  it("sends maxPageSize=1 and not size", async () => {
    seen.length = 0;
    const result = await new EnhancedZebrunnerClient(cfg()).testConnection("FIX");
    assert.equal(result.success, true);
    const call = seen.find((s) => s.path.endsWith("/test-suites"));
    assert.ok(call, "test-suites endpoint called");
    assert.equal(call!.query.get("maxPageSize"), "1");
    assert.equal(call!.query.has("size"), false, "the ignored 'size' parameter is gone");
    assert.equal(call!.query.get("projectKey"), "FIX");
  });
});
