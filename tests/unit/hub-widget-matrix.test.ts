import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { EVAL_PROMPTS } from "../eval/eval-prompts.js";
import { HUB_EVAL_PROMPTS } from "../eval/eval-hub-prompts.js";
import {
  allHubModes,
  allWidgetTemplateIds,
  assertHubExportsMatchMatrix,
  AUTHORING_TREND_ROW,
  DISTRIBUTION_ROW,
  HUB_EXECUTION_MODES,
  HUB_FAILURE_MODES,
  HUB_TCM_MODES,
  PASS_RATE_VIEW_ROWS,
  WIDGET_TEMPLATE_TO_MCP,
} from "../helpers/hub-widget-matrix.js";
import { PASS_RATE_VIEWS } from "../../src/utils/widget-pass-rate-views.js";
import { AUTHORING_EVAL_PROMPTS } from "../eval/eval-authoring-prompts.js";
import { WIDGET_TEMPLATE_IDS } from "../eval/eval-widget-prompts.js";

describe("hub-widget-matrix", () => {
  it("matrix modes match widget-hub-tools exports", () => {
    assert.doesNotThrow(() => assertHubExportsMatchMatrix());
  });

  it("every hub mode has a unique templateId and apiTestId", () => {
    const modes = allHubModes();
    const templateIds = new Set(modes.map(m => m.templateId));
    assert.equal(templateIds.size, modes.length, "duplicate templateIds in hub matrix");
    const apiIds = new Set(modes.map(m => m.apiTestId));
    assert.equal(apiIds.size, modes.length, "duplicate apiTestIds in hub matrix");
  });

  it("pass-rate view matrix covers all PASS_RATE_VIEWS", () => {
    assert.deepEqual(
      PASS_RATE_VIEW_ROWS.map(r => r.view).sort(),
      [...PASS_RATE_VIEWS].sort(),
    );
  });

  it("distribution row maps to TCM-DIST api smokes", () => {
    assert.equal(DISTRIBUTION_ROW.templateId, 37780);
    assert.ok(DISTRIBUTION_ROW.apiTestIds.includes("TCM-DIST-AUTO"));
  });

  it("HUB_EVAL_PROMPTS merged into EVAL_PROMPTS", () => {
    for (const p of HUB_EVAL_PROMPTS) {
      assert.ok(EVAL_PROMPTS.some(e => e.id === p.id), `missing merged hub prompt ${p.id}`);
    }
  });

  it("every hub mode has a dedicated eval prompt", () => {
    for (const row of allHubModes()) {
      const id = row.mcpTool === "adv_get_tcm_case_analytics"
        ? `hub.tcm.${row.mode}`
        : row.mcpTool === "adv_get_failure_analytics"
          ? `hub.failure.${row.mode}`
          : `hub.execution.${row.mode}`;
      const p = EVAL_PROMPTS.find(e => e.id === id);
      assert.ok(p, `missing eval prompt for ${row.mcpTool} mode=${row.mode}`);
      assert.ok(p!.expectedTools?.includes(row.mcpTool));
    }
  });

  it("every non-pie pass-rate view has an eval prompt", () => {
    for (const row of PASS_RATE_VIEW_ROWS.filter(r => r.view !== "pie")) {
      const p = EVAL_PROMPTS.find(e => e.id === `hub.pass_rate.view_${row.view}`);
      assert.ok(p, `missing pass-rate view eval for ${row.view}`);
      assert.ok(p!.expectedTools?.includes("adv_get_platform_results_by_period"));
    }
  });

  it("pie default regression prompt exists", () => {
    const p = EVAL_PROMPTS.find(e => e.id === "hub.regression.pie_default_unchanged");
    assert.ok(p);
    assert.deepEqual(p!.expectedTools, ["adv_get_platform_results_by_period"]);
  });

  it("authoring trend row maps to W-TPL7 smokes", () => {
    assert.equal(AUTHORING_TREND_ROW.templateId, 7);
    assert.deepEqual(AUTHORING_TREND_ROW.apiTestIds, ["W-TPL7", "W-TPL7-WEEK", "W-TPL7-MONTH"]);
    assert.equal(AUTHORING_TREND_ROW.mcpTool, "adv_get_test_authoring_trend");
  });

  it("WIDGET_TEMPLATE_TO_MCP covers all 22 templates", () => {
    const ids = allWidgetTemplateIds();
    assert.equal(ids.length, 22);
    for (const tid of WIDGET_TEMPLATE_IDS) {
      assert.ok(WIDGET_TEMPLATE_TO_MCP[tid], `template ${tid} missing MCP mapping`);
    }
  });

  it("every authoring eval prompt is merged", () => {
    for (const p of AUTHORING_EVAL_PROMPTS) {
      assert.ok(EVAL_PROMPTS.some(e => e.id === p.id), `missing ${p.id}`);
    }
  });

  it("template 7 eval prompt routes to adv_get_test_authoring_trend", () => {
    const p = EVAL_PROMPTS.find(e => e.id === "widget.tpl7.authoring_trend");
    assert.ok(p);
    assert.deepEqual(p!.expectedTools, ["adv_get_test_authoring_trend"]);
  });
});
