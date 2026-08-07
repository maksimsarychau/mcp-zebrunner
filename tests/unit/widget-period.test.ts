import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  composeDynamicExpression,
  extractResolvedPeriodLabel,
  formatWidgetPeriodLabel,
  inferWidgetPeriodMode,
  pickWidgetPeriodInputFromReport,
  resolveDynamicExpressions,
  resolveWidgetPeriodParams,
} from "../../src/utils/widget-period.js";
import { buildParamsConfig } from "../../src/utils/widget-sql.js";

describe("widget-period: composeDynamicExpression", () => {
  it("returns TODAY for zero offset", () => {
    assert.equal(composeDynamicExpression("TODAY", 0), "TODAY");
  });

  it("builds month offset expression", () => {
    assert.equal(
      composeDynamicExpression("START_OF_MONTH", -1, "MONTH"),
      "START_OF_MONTH -1 MONTH",
    );
  });

  it("builds quarter offset on month anchor", () => {
    assert.equal(
      composeDynamicExpression("START_OF_MONTH", -2, "QUARTER"),
      "START_OF_MONTH -2 QUARTER",
    );
  });

  it("builds week range expressions", () => {
    assert.equal(
      composeDynamicExpression("START_OF_WEEK", -2, "WEEK"),
      "START_OF_WEEK -2 WEEK",
    );
    assert.equal(
      composeDynamicExpression("END_OF_WEEK", -1, "DAY"),
      "END_OF_WEEK -1 DAY",
    );
  });

  it("builds long-range expressions", () => {
    assert.equal(
      composeDynamicExpression("START_OF_QUARTER", -2, "YEAR"),
      "START_OF_QUARTER -2 YEAR",
    );
    assert.equal(
      composeDynamicExpression("END_OF_MONTH", -1, "DAY"),
      "END_OF_MONTH -1 DAY",
    );
  });
});

describe("widget-period: resolveWidgetPeriodParams", () => {
  it("preset mode unchanged vs legacy buildParamsConfig PERIOD", () => {
    const legacy = buildParamsConfig({ period: "Last 30 Days" });
    const resolved = resolveWidgetPeriodParams({ period_mode: "preset", period: "Last 30 Days" });
    assert.equal(resolved.PERIOD, "Last 30 Days");
    assert.equal(legacy.PERIOD, resolved.PERIOD);
    assert.equal(legacy.dashboardName, "Weekly results");
  });

  it("absolute mode outputs ABSOLUTE with dates", () => {
    const result = resolveWidgetPeriodParams({
      period_mode: "absolute",
      period_start_date: "2026-07-01",
      period_end_date: "2026-07-09",
    });
    assert.deepEqual(result, {
      PERIOD: "ABSOLUTE",
      periodStartDate: "2026-07-01",
      periodEndDate: "2026-07-09",
      periodStartExpression: null,
      periodEndExpression: null,
    });
  });

  it("dynamic mode with raw expressions", () => {
    const result = resolveWidgetPeriodParams({
      period_mode: "dynamic",
      period_start_expression: "START_OF_MONTH -2 QUARTER",
      period_end_expression: "TODAY",
    });
    assert.equal(result.PERIOD, "DYNAMIC");
    assert.equal(result.periodStartDate, null);
    assert.equal(result.periodEndExpression, "TODAY");
  });

  it("dynamic mode from structured fields", () => {
    const result = resolveWidgetPeriodParams({
      period_mode: "dynamic",
      period_dynamic_from_anchor: "START_OF_MONTH",
      period_dynamic_from_offset: -1,
      period_dynamic_from_unit: "MONTH",
      period_dynamic_to_anchor: "TODAY",
      period_dynamic_to_offset: 0,
    });
    assert.equal(result.periodStartExpression, "START_OF_MONTH -1 MONTH");
    assert.equal(result.periodEndExpression, "TODAY");
  });

  it("structured fields take precedence over raw expressions", () => {
    const { periodStartExpression, periodEndExpression } = resolveDynamicExpressions({
      period_dynamic_from_anchor: "START_OF_WEEK",
      period_dynamic_from_offset: -2,
      period_dynamic_from_unit: "WEEK",
      period_dynamic_to_anchor: "END_OF_WEEK",
      period_dynamic_to_offset: -1,
      period_dynamic_to_unit: "DAY",
      period_start_expression: "IGNORED",
      period_end_expression: "IGNORED",
    });
    assert.equal(periodStartExpression, "START_OF_WEEK -2 WEEK");
    assert.equal(periodEndExpression, "END_OF_WEEK -1 DAY");
  });

  it("rejects invalid absolute dates", () => {
    assert.throws(
      () => resolveWidgetPeriodParams({ period_mode: "absolute", period_start_date: "bad" }),
      /YYYY-MM-DD/,
    );
  });
});

describe("widget-period: inferWidgetPeriodMode", () => {
  it("defaults to preset", () => {
    assert.equal(inferWidgetPeriodMode({ period: "Last 7 Days" }), "preset");
  });

  it("infers absolute from dates", () => {
    assert.equal(
      inferWidgetPeriodMode({ period_start_date: "2026-01-01", period_end_date: "2026-02-01" }),
      "absolute",
    );
  });
});

describe("widget-period: extractResolvedPeriodLabel", () => {
  it("extracts date range label from widget rows", () => {
    const rows = [
      { label: "2024-07-01 - 2026-07-31", value: 0 },
      { label: "PASSED", value: 282572 },
    ];
    assert.equal(extractResolvedPeriodLabel(rows), "2024-07-01 - 2026-07-31");
  });
});

describe("widget-period: formatWidgetPeriodLabel", () => {
  it("uses resolved label when provided", () => {
    assert.equal(
      formatWidgetPeriodLabel({ period_mode: "dynamic" }, "2024-07-01 - 2026-07-31"),
      "2024-07-01 - 2026-07-31",
    );
  });
});

describe("widget-period: pickWidgetPeriodInputFromReport", () => {
  it("maps widget_period_* prefixed fields", () => {
    const input = pickWidgetPeriodInputFromReport({
      period: "Last 30 Days",
      widget_period_mode: "dynamic",
      widget_period_start_expression: "TODAY",
      widget_period_end_expression: "TODAY",
    });
    assert.equal(input.period_mode, "dynamic");
    assert.equal(input.period_start_expression, "TODAY");
    assert.equal(input.period, "Last 30 Days");
  });
});

describe("widget-period: buildParamsConfig integration", () => {
  it("adds dynamic fields to paramsConfig", () => {
    const result = buildParamsConfig({
      period: "Last 7 Days",
      periodInput: {
        period_mode: "dynamic",
        period_start_expression: "START_OF_MONTH -2 QUARTER",
        period_end_expression: "TODAY",
      },
    });
    assert.equal(result.PERIOD, "DYNAMIC");
    assert.equal((result as any).periodStartDate, null);
    assert.equal((result as any).periodStartExpression, "START_OF_MONTH -2 QUARTER");
  });

  it("preset path does not add period expression fields", () => {
    const result = buildParamsConfig({ period: "Last 7 Days" });
    assert.equal(result.PERIOD, "Last 7 Days");
    assert.equal((result as any).periodStartExpression, undefined);
  });
});
