import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseWidgetStatusCounts } from "../../src/utils/widget-sql.js";
import { buildStackedStatusChartDatasets } from "../../src/utils/chart-generator.js";

describe("parseWidgetStatusCounts", () => {
  it("parses label/value rows from RESULTS_BY_PLATFORM (milestone filter shape)", () => {
    const rows = [
      { label: "2026-04-22 - 2026-05-23", value: 0 },
      { label: "PASSED", value: 1087 },
      { label: "FAILED", value: 0 },
      { label: "BLOCKED", value: 0 },
      { label: "SKIPPED", value: 0 },
      { label: "KNOWN ISSUE", value: 47 },
      { label: "ABORTED", value: 0 },
    ];
    const counts = parseWidgetStatusCounts(rows);
    assert.ok(counts);
    assert.equal(counts.passed, 1087);
    assert.equal(counts.failed, 0);
    assert.equal(counts.knownIssue, 47);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.aborted, 0);
  });

  it("parses column-oriented rows (legacy mock shape)", () => {
    const rows = [{ PLATFORM: "Android", PASSED: 80, FAILED: 10, SKIPPED: 5 }];
    const counts = parseWidgetStatusCounts(rows);
    assert.ok(counts);
    assert.equal(counts.passed, 80);
    assert.equal(counts.failed, 10);
    assert.equal(counts.skipped, 5);
  });

  it("returns null for empty or unrecognizable rows", () => {
    assert.equal(parseWidgetStatusCounts([]), null);
    assert.equal(parseWidgetStatusCounts([{ foo: 1, bar: 2 }]), null);
  });

  it("buildStackedStatusChartDatasets omits zero buckets", () => {
    const counts = parseWidgetStatusCounts([
      { label: "PASSED", value: 100 },
      { label: "KNOWN ISSUE", value: 5 },
      { label: "FAILED", value: 0 },
    ]);
    assert.ok(counts);
    const datasets = buildStackedStatusChartDatasets(counts);
    assert.equal(datasets.length, 2);
    assert.equal(datasets[0].label, "Passed");
    assert.equal(datasets[0].values[0], 100);
    assert.equal(datasets[1].label, "Known Issue");
    assert.equal(datasets[1].values[0], 5);
  });
});
