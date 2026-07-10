import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { EVAL_PROMPTS } from "../eval/eval-prompts.js";
import { AUTHORING_EVAL_PROMPTS } from "../eval/eval-authoring-prompts.js";

describe("eval authoring prompts", () => {
  it("AUTHORING_EVAL_PROMPTS merged into EVAL_PROMPTS", () => {
    for (const p of AUTHORING_EVAL_PROMPTS) {
      assert.ok(EVAL_PROMPTS.some(e => e.id === p.id), `missing merged prompt ${p.id}`);
    }
  });

  it("all authoring prompts target adv_get_test_authoring_trend", () => {
    for (const p of AUTHORING_EVAL_PROMPTS) {
      assert.ok(p.expectedTools?.includes("adv_get_test_authoring_trend"), p.id);
    }
  });

  it("includes daily default and weekly quarter variants", () => {
    assert.ok(AUTHORING_EVAL_PROMPTS.some(p => p.id === "authoring.daily_default"));
    assert.ok(AUTHORING_EVAL_PROMPTS.some(p => p.id === "authoring.weekly_quarter"));
  });

  it("includes tool-confusion negatives", () => {
    const negs = AUTHORING_EVAL_PROMPTS.filter(p => p.isNegative);
    assert.ok(negs.length >= 3);
    for (const p of negs) {
      assert.ok(p.forbiddenTools && p.forbiddenTools.length >= 1);
    }
  });
});
