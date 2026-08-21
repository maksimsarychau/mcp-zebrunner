import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { EVAL_PROMPTS } from "../eval/eval-prompts.js";
import { TEST_IMPACT_EVAL_PROMPTS } from "../eval/eval-test-impact-tools.js";

describe("eval test impact prompts", () => {
  it("TEST_IMPACT_EVAL_PROMPTS merged into EVAL_PROMPTS", () => {
    for (const p of TEST_IMPACT_EVAL_PROMPTS) {
      assert.ok(EVAL_PROMPTS.some((e) => e.id === p.id), `missing merged prompt ${p.id}`);
    }
  });

  it("all test impact prompts target adv_analyze_test_impact", () => {
    for (const p of TEST_IMPACT_EVAL_PROMPTS) {
      assert.ok(
        p.expectedTools?.includes("adv_analyze_test_impact"),
        p.id,
      );
    }
  });

  it("includes tool-confusion negatives", () => {
    const negs = TEST_IMPACT_EVAL_PROMPTS.filter((p) => p.isNegative);
    assert.ok(negs.length >= 3);
  });
});
