import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  AUTHORING_GROUPING_PERIOD,
  AUTHORING_TREND_TEMPLATE_ID,
} from "../../src/handlers/widget-authoring-trend-tool.js";
import { buildParamsConfig } from "../../src/utils/widget-sql.js";
import {
  parseAuthoringTrendRows,
  sumAuthoringAmounts,
} from "../../src/utils/widget-response-parsers.js";

describe("widget-authoring-trend-tool", () => {
  it("uses TAM template 7", () => {
    assert.equal(AUTHORING_TREND_TEMPLATE_ID, 7);
  });

  it("supports DAY, WEEK, MONTH grouping periods", () => {
    assert.deepEqual([...AUTHORING_GROUPING_PERIOD], ["DAY", "WEEK", "MONTH"]);
  });

  it("MCP default params match W-TPL7 api-verify payload", () => {
    const params = buildParamsConfig({
      period: "Last 14 Days",
      extra: {
        groupingPeriod: "DAY",
        dashboardName: "api-verify",
        isReact: true,
      },
    });
    assert.equal(params.PERIOD, "Last 14 Days");
    assert.equal(params.groupingPeriod, "DAY");
    assert.equal(params.dashboardName, "api-verify");
    assert.equal(params.isReact, true);
  });

  it("weekly quarter params match W-TPL7-WEEK api-verify payload", () => {
    const params = buildParamsConfig({
      period: "Quarter",
      extra: {
        groupingPeriod: "WEEK",
        dashboardName: "api-verify",
        isReact: true,
      },
    });
    assert.equal(params.PERIOD, "Quarter");
    assert.equal(params.groupingPeriod, "WEEK");
  });

  it("absolute period params match W-TPL7-ABS api-verify payload", () => {
    const params = buildParamsConfig({
      period: "Last 14 Days",
      periodInput: {
        period_mode: "absolute",
        period_start_date: "2026-07-01",
        period_end_date: "2026-07-09",
      },
      extra: {
        groupingPeriod: "DAY",
        dashboardName: "api-verify",
        isReact: true,
      },
    });
    assert.equal(params.PERIOD, "ABSOLUTE");
    assert.equal(params.periodStartDate, "2026-07-01");
    assert.equal(params.periodEndDate, "2026-07-09");
    assert.equal(params.groupingPeriod, "DAY");
  });

  it("formats compact output shape from parsed rows", () => {
    const rows = parseAuthoringTrendRows([
      { CREATED_AT: "07/01", AMOUNT: 10 },
      { CREATED_AT: "07/02", AMOUNT: 5 },
    ]);
    const payload = {
      templateId: AUTHORING_TREND_TEMPLATE_ID,
      period: "Last 14 Days",
      grouping_period: "DAY",
      total_created: sumAuthoringAmounts(rows),
      rows,
    };
    assert.equal(payload.templateId, 7);
    assert.equal(payload.total_created, 15);
    assert.equal(payload.rows.length, 2);
  });
});
