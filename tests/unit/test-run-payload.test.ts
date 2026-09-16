import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  environmentRefForPublicApi,
  resolveEnvironmentForPublicApi,
  usedLegacyEnvironmentKey,
} from "../../src/utils/test-run-payload.js";

const CATALOG = [
  { id: 1, name: "PRODUCTION" },
  { id: 2, name: "RELEASE" },
];

describe("test-run-payload environmentRefForPublicApi", () => {
  it("returns id when id is set", () => {
    assert.deepEqual(environmentRefForPublicApi({ id: 12, name: "PRODUCTION" }), { id: 12 });
  });

  it("returns name when name is set", () => {
    assert.deepEqual(environmentRefForPublicApi({ name: "PRODUCTION" }), { name: "PRODUCTION" });
  });

  it("maps legacy key to name", () => {
    assert.deepEqual(environmentRefForPublicApi({ key: "pre-prod" }), { name: "pre-prod" });
  });

  it("prefers id over name and key", () => {
    assert.deepEqual(environmentRefForPublicApi({ id: 3, key: "ignored" }), { id: 3 });
  });

  it("throws when empty", () => {
    assert.throws(() => environmentRefForPublicApi({}), /requires/);
  });

  it("detects legacy key-only input", () => {
    assert.equal(usedLegacyEnvironmentKey({ key: "prod" }), true);
    assert.equal(usedLegacyEnvironmentKey({ name: "PRODUCTION" }), false);
    assert.equal(usedLegacyEnvironmentKey({ id: 1, key: "x" }), false);
  });
});

describe("resolveEnvironmentForPublicApi", () => {
  it("resolves legacy key case-insensitively against catalog", () => {
    const r = resolveEnvironmentForPublicApi({ key: "release" }, CATALOG);
    assert.deepEqual(r.ref, { name: "RELEASE" });
    assert.equal(r.matchedBy, "legacy_key_case_insensitive");
  });

  it("resolves name case-insensitively", () => {
    const r = resolveEnvironmentForPublicApi({ name: "production" }, CATALOG);
    assert.deepEqual(r.ref, { name: "PRODUCTION" });
    assert.equal(r.matchedBy, "name_case_insensitive");
  });

  it("passthrough when catalog empty (backward compat)", () => {
    const r = resolveEnvironmentForPublicApi({ key: "CUSTOM" }, []);
    assert.deepEqual(r.ref, { name: "CUSTOM" });
    assert.equal(r.matchedBy, "passthrough_legacy_key");
  });

  it("outbound ref never includes key field", () => {
    const r = resolveEnvironmentForPublicApi({ key: "RELEASE" }, CATALOG);
    assert.deepEqual(Object.keys(r.ref), ["name"]);
  });

  it("treats id: 0 as id branch (not empty name/key fallback)", () => {
    const r = resolveEnvironmentForPublicApi({ id: 0 });
    assert.deepEqual(r.ref, { id: 0 });
    assert.equal(r.matchedBy, "id");
  });
});
