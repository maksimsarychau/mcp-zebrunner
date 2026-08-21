import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildTestCaseWebUrl,
  formatHostMismatchWarning,
  isUrlLikeTestCaseInput,
  lookupUsesNumericId,
  normalizeTestCaseInput,
  parseZebrunnerTestCaseRef,
} from "../../src/utils/zebrunner-test-case-ref.js";

const CONFIG_WEB = "https://zebrunner.example.com";
const CONFIG_HOST = "zebrunner.example.com";

describe("zebrunner-test-case-ref", () => {
  it("detects URL-like inputs", () => {
    assert.equal(isUrlLikeTestCaseInput("MCP-315"), false);
    assert.equal(
      isUrlLikeTestCaseInput(`${CONFIG_WEB}/projects/MCP/test-cases?caseId=90857`),
      true,
    );
    assert.equal(isUrlLikeTestCaseInput("/projects/MCP/test-cases/90857"), true);
  });

  it("parses ?caseId= URLs", () => {
    const ref = parseZebrunnerTestCaseRef(
      `${CONFIG_WEB}/projects/PROJ2/test-cases?caseId=85628`,
    );
    assert.ok(ref);
    assert.equal(ref!.projectKey, "PROJ2");
    assert.equal(ref!.lookupKey, "85628");
    assert.equal(ref!.source, "url_caseId");
  });

  it("parses ?caseKey= URLs", () => {
    const ref = parseZebrunnerTestCaseRef(
      `${CONFIG_WEB}/projects/MCP/test-cases?caseKey=MCP-315`,
    );
    assert.ok(ref);
    assert.equal(ref!.caseKey, "MCP-315");
    assert.equal(ref!.lookupKey, "MCP-315");
    assert.equal(ref!.source, "url_caseKey");
  });

  it("parses path form URLs", () => {
    const ref = parseZebrunnerTestCaseRef("/projects/MCP/test-cases/90857");
    assert.ok(ref);
    assert.equal(ref!.projectKey, "MCP");
    assert.equal(ref!.lookupKey, "90857");
    assert.equal(ref!.source, "url_path");
  });

  it("passes through plain keys unchanged", () => {
    const n = normalizeTestCaseInput("MCP-315");
    assert.equal(n.lookupKey, "MCP-315");
    assert.equal(n.projectKey, "MCP");
    assert.equal(n.source, "plain_key");
  });

  it("passes through plain numeric id with hint", () => {
    const n = normalizeTestCaseInput("90857", { projectKeyHint: "MCP" });
    assert.equal(n.lookupKey, "90857");
    assert.equal(n.projectKey, "MCP");
    assert.equal(n.source, "plain_id");
    assert.equal(lookupUsesNumericId(n), true);
  });

  it("warns on host mismatch without rejecting", () => {
    const n = normalizeTestCaseInput(
      "https://other.example.com/projects/MCP/test-cases?caseId=90857",
      { configuredWebUrl: CONFIG_WEB },
    );
    assert.equal(n.projectKey, "MCP");
    assert.equal(n.lookupKey, "90857");
    assert.equal(
      n.hostMismatchWarning,
      formatHostMismatchWarning("other.example.com", CONFIG_HOST),
    );
  });

  it("compares parsed hostnames only (path segments do not affect host check)", () => {
    const n = normalizeTestCaseInput(
      "https://evil.example.com/projects/MCP/test-cases?caseId=90857",
      { configuredWebUrl: "https://not-evil.example.com/zebrunner.example.com/path" },
    );
    assert.equal(n.lookupKey, "90857");
    assert.equal(
      n.hostMismatchWarning,
      formatHostMismatchWarning("evil.example.com", "not-evil.example.com"),
    );
  });

  it("does not mis-parse unrelated URLs", () => {
    assert.equal(parseZebrunnerTestCaseRef("https://github.com/org/repo/pull/1"), null);
  });

  it("buildTestCaseWebUrl prefers caseId", () => {
    assert.equal(
      buildTestCaseWebUrl(CONFIG_WEB, "MCP", { id: 90857, key: "MCP-315" }),
      `${CONFIG_WEB}/projects/MCP/test-cases?caseId=90857`,
    );
  });

  it("buildTestCaseWebUrl falls back to caseKey", () => {
    assert.equal(
      buildTestCaseWebUrl(CONFIG_WEB, "MCP", { key: "MCP-315" }),
      `${CONFIG_WEB}/projects/MCP/test-cases?caseKey=MCP-315`,
    );
  });

  it("formatHostMismatchWarning is stable", () => {
    const msg = formatHostMismatchWarning("a.com", "b.com");
    assert.equal(
      msg,
      "⚠️ URL host (a.com) differs from configured Zebrunner web URL (b.com). Parsed reference anyway.",
    );
  });
});
