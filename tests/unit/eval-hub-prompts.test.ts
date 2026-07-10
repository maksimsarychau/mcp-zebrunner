import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { HUB_EVAL_PROMPTS } from "../eval/eval-hub-prompts.js";
import { allHubModes, PASS_RATE_VIEW_ROWS } from "../helpers/hub-widget-matrix.js";

describe("eval hub prompts", () => {
  it("has one prompt per hub mode", () => {
    assert.equal(
      HUB_EVAL_PROMPTS.filter(p => p.id.startsWith("hub.tcm.") || p.id.startsWith("hub.failure.") || p.id.startsWith("hub.execution.")).length,
      allHubModes().length,
    );
  });

  it("has pass-rate view prompts for bar/line/calendar/pie_line/summary", () => {
    const views = PASS_RATE_VIEW_ROWS.filter(r => r.view !== "pie").map(r => r.view);
    for (const view of views) {
      assert.ok(
        HUB_EVAL_PROMPTS.some(p => p.id === `hub.pass_rate.view_${view}`),
        `missing hub.pass_rate.view_${view}`,
      );
    }
  });

  it("includes tool-confusion negatives for hub vs legacy tools", () => {
    const negIds = [
      "hub.neg.failure_not_top_bugs",
      "hub.neg.execution_not_regression_runtime",
      "hub.neg.tcm_not_distribution",
    ];
    for (const id of negIds) {
      const p = HUB_EVAL_PROMPTS.find(e => e.id === id);
      assert.ok(p?.isNegative);
      assert.ok(p?.forbiddenTools && p.forbiddenTools.length >= 1);
    }
  });

  it("includes authoring trend prompt in hub eval set", () => {
    const p = HUB_EVAL_PROMPTS.find(e => e.id === "hub.authoring.trend");
    assert.ok(p);
    assert.deepEqual(p!.expectedTools, ["adv_get_test_authoring_trend"]);
  });
});
