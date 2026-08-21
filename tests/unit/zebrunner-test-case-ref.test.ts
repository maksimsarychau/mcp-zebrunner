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

const CONFIG_WEB = "https://mfp.zebrunner.com";

describe("zebrunner-test-case-ref", () => {
  it("detects URL-like inputs", () => {
    assert.equal(isUrlLikeTestCaseInput("MCP-315"), false);
    assert.equal(
      isUrlLikeTestCaseInput("https://mfp.zebrunner.com/projects/MCP/test-cases?caseId=90857"),
      true,
    );
    assert.equal(isUrlLikeTestCaseInput("/projects/MCP/test-cases/90857"), true);
  });

  it("parses ?caseId= URLs", () => {
    const ref = parseZebrunnerTestCaseRef(
      "https://mfp.zebrunner.com/projects/MFPIOS/test-cases?caseId=85628",
    );
    assert.ok(ref);
    assert.equal(ref!.projectKey, "MFPIOS");
    assert.equal(ref!.lookupKey, "85628");
    assert.equal(ref!.source, "url_caseId");
  });

  it("parses ?caseKey= URLs", () => {
    const ref = parseZebrunnerTestCaseRef(
      "https://mfp.zebrunner.com/projects/MCP/test-cases?caseKey=MCP-315",
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
    assert.ok(n.hostMismatchWarning?.includes("other.example.com"));
    assert.ok(n.hostMismatchWarning?.includes("mfp.zebrunner.com"));
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
    assert.match(msg, /a\.com/);
    assert.match(msg, /b\.com/);
  });
});
