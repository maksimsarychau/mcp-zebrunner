import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { populatePrompt } from "../eval/eval-prompts.js";
import type { EvalDiscoveryContext } from "../eval/eval-discovery.js";

const baseCtx: EvalDiscoveryContext = {
  projectKey: "DEMO",
  projectId: 1,
  suiteId: 42,
  suiteName: "Smoke",
  testCaseKey: "DEMO-1",
  testCaseId: 100,
  testRunId: 7,
};

describe("populatePrompt", () => {
  it("substitutes test_case_key and test_run_id placeholders", () => {
    const out = populatePrompt(
      "Case {{test_case_key}} in run {{test_run_id}} for {{project_key}}",
      baseCtx,
    );
    assert.equal(out, "Case DEMO-1 in run 7 for DEMO");
  });

  it("leaves unknown placeholders intact", () => {
    const out = populatePrompt("Value {{unknown_var}}", baseCtx);
    assert.equal(out, "Value {{unknown_var}}");
  });
});
