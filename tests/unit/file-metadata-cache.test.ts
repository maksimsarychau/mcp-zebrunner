/**
 * File metadata lookups against a local HTTP server:
 *  1. a 404 (unknown / deleted file uuid) is not retried
 *  2. the metadata cache evicts the least recently USED entry, not the least recently inserted one
 */
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EnhancedZebrunnerClient } from "../../src/api/enhanced-client.js";
import { ZebrunnerNotFoundError } from "../../src/types/api.js";

const USER = "user@example.test";
const TOKEN = "test-token-not-real";

/** Build a deterministic uuid for index i (valid v4-shaped hex). */
function uuidFor(i: number): string {
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

let server: Server;
let baseUrl = "";
const requests = new Map<string, number>();
const NOT_FOUND = uuidFor(0xdead);

function count(uuid: string): number {
  return requests.get(uuid) ?? 0;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function metadataFor(uuid: string) {
  return { uuid, name: `${uuid}.bin`, type: "OTHER", sizeInBytes: 10, contentType: "application/octet-stream" };
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/public/v1/files/-/metadata") {
    const uuids = url.searchParams.getAll("uuid");
    for (const u of uuids) requests.set(u, count(u) + 1);
    return json(res, 200, { items: uuids.map(metadataFor) });
  }
  const single = /^\/api\/public\/v1\/files\/([0-9a-f-]{36})\/metadata$/i.exec(url.pathname);
  if (single) {
    const uuid = single[1].toLowerCase();
    requests.set(uuid, count(uuid) + 1);
    if (uuid === NOT_FOUND) return json(res, 404, { message: "not found" });
    return json(res, 200, { data: metadataFor(uuid) });
  }
  json(res, 500, { message: "unexpected" });
}

before(async () => {
  server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/public/v1`;
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function client(retryAttempts: number): EnhancedZebrunnerClient {
  return new EnhancedZebrunnerClient({
    baseUrl,
    username: USER,
    token: TOKEN,
    retryAttempts,
    retryDelay: 1,
    timeout: 5000,
  } as any);
}

describe("file metadata lookups", () => {
  it("does not retry a 404 for an unknown file uuid", async () => {
    requests.clear();
    await assert.rejects(client(3).getFileMetadata(NOT_FOUND), ZebrunnerNotFoundError);
    assert.equal(count(NOT_FOUND), 1, "one request, no retries");
  });

  it("evicts the least recently used entry when the cache is full", async () => {
    requests.clear();
    const c = client(1);
    // Fill the cache to its 500-entry limit through the bulk endpoint (5 chunks of 100).
    const all = Array.from({ length: 500 }, (_, i) => uuidFor(i + 1));
    const first = await c.getBulkFileMetadata(all);
    assert.equal(first.length, 500);

    // Use the first (oldest inserted) entry, which makes it the most recently used.
    await c.getFileMetadata(all[0]);
    assert.equal(count(all[0]), 1, "cache hit, no new request");

    // One more entry pushes the cache over its limit and must evict the LRU entry (all[1]).
    const extra = uuidFor(10_001);
    await c.getBulkFileMetadata([extra]);

    await c.getFileMetadata(all[0]);
    assert.equal(count(all[0]), 1, "recently used entry survived eviction");

    await c.getFileMetadata(all[1]);
    assert.equal(count(all[1]), 2, "least recently used entry was evicted and fetched again");
  });
});
