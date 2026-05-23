import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPassRateTableRow,
  hasPassRateMetrics,
  noMilestoneLaunchesMessage,
} from "../../src/handlers/reports/pass-rate-display.js";
import type { PassRateData } from "../../src/handlers/reports/types.js";

const emptyMilestone: PassRateData = {
  project: "web",
  passed: 0,
  failed: 0,
  skipped: 0,
  knownIssue: 0,
  aborted: 0,
  total: 0,
  passRate: 0,
  passRateExclKnown: 0,
  noMilestoneLaunches: true,
  milestoneNote: noMilestoneLaunchesMessage("May 14 - version 21.8.10"),
};

describe("pass-rate-display", () => {
  it("hasPassRateMetrics is false when no launches on milestone", () => {
    assert.equal(hasPassRateMetrics(emptyMilestone), false);
  });

  it("table row shows em dash and no 0% pass rate", () => {
    const row = formatPassRateTableRow(emptyMilestone, 65);
    assert.ok(row.includes("—"));
    assert.ok(row.includes("No launches assigned to milestone"));
    assert.ok(!row.includes("| 0% |"));
  });
});
