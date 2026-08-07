import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { EVAL_PROMPTS } from "../eval/eval-prompts.js";
import { WIDGET_EVAL_PROMPTS, WIDGET_TEMPLATE_IDS } from "../eval/eval-widget-prompts.js";

/** Prompt IDs that cover template 37780 besides widget.tpl37780.* */
const DISTRIBUTION_LEGACY_IDS = [
  "get_test_case_distribution_by_field.automation_state",
  "get_test_case_distribution_by_field.field_name",
  "neg.confuse.distribution_vs_automation_state",
];

function promptsForTemplate(templateId: string) {
  const prefix = `widget.tpl${templateId}.`;
  const widgetMatches = EVAL_PROMPTS.filter(
    (p) => p.id.startsWith(prefix) || p.id.includes(`.tpl${templateId}.`),
  );
  if (templateId === "37780") {
    const legacy = EVAL_PROMPTS.filter((p) => DISTRIBUTION_LEGACY_IDS.includes(p.id));
    return [...widgetMatches, ...legacy];
  }
  return widgetMatches;
}

describe("eval widget prompts", () => {
  it("WIDGET_EVAL_PROMPTS is merged into EVAL_PROMPTS", () => {
    for (const p of WIDGET_EVAL_PROMPTS) {
      assert.ok(
        EVAL_PROMPTS.some((e) => e.id === p.id),
        `missing merged prompt ${p.id}`,
      );
    }
  });

  it("covers all 22 widget template IDs with at least one eval prompt", () => {
    for (const tid of WIDGET_TEMPLATE_IDS) {
      const matches = promptsForTemplate(tid);
      assert.ok(
        matches.length >= 1,
        `template ${tid}: expected >= 1 eval prompt, got ${matches.length}`,
      );
    }
  });

  it("template 8 has pie and dynamic period variants", () => {
    const tpl8 = promptsForTemplate("8");
    assert.ok(tpl8.some((p) => p.id.includes("pass_rate_pie")));
    assert.ok(tpl8.some((p) => p.id.includes("dynamic_period")));
  });

  it("failure widgets 6 and 10 require bug hashcode context when present", () => {
    for (const id of ["widget.tpl6.failure_info", "widget.tpl10.failure_details"]) {
      const p = EVAL_PROMPTS.find((e) => e.id === id);
      assert.ok(p);
      assert.deepEqual(p!.requiredContext, ["projectKey", "bugHashcode", "dashboardId"]);
    }
  });
});
