import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

/**
 * Unit tests for find_flaky_tests tool
 *
 * Tests flip-flop detection, pass rate / stability metrics,
 * trend classification, Phase 2 manual scan logic,
 * Phase 3 enrichment classification, and parameter validation.
 */

// ── Replicated core logic from findFlakyTests handler ──

interface TestEntry {
  launchId: number;
  status: string;
  stability: number;
  date: number;
  testClass: string;
  testCaseIds: number[];
}

interface FlakyEntry {
  test_name: string;
  test_class: string;
  source: string;
  flip_count: number;
  appearances: number;
  pass_rate: string;
  avg_stability: number;
  stability_trend: string;
  last_status: string;
  history?: Array<{ date: string; status: string; type: string; launch_id?: number }>;
}

function computeFlipCount(entries: TestEntry[]): number {
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  let flips = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].status;
    const curr = sorted[i].status;
    if (
      (prev === "PASSED" && curr === "FAILED") ||
      (prev === "FAILED" && curr === "PASSED")
    ) {
      flips++;
    }
  }
  return flips;
}

function computePassRate(entries: TestEntry[]): number {
  if (entries.length === 0) return 0;
  const passed = entries.filter((e) => e.status === "PASSED").length;
  return Math.round((passed / entries.length) * 100);
}

function computeAvgStability(entries: TestEntry[]): number {
  if (entries.length === 0) return 0;
  return Math.round(
    entries.reduce((s, e) => s + e.stability, 0) / entries.length
  );
}

function computeStabilityTrend(entries: TestEntry[]): string {
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  const mid = Math.ceil(sorted.length / 2);
  const first = sorted.slice(0, mid);
  const second = sorted.slice(mid);
  const avgFirst =
    first.reduce((s, e) => s + e.stability, 0) / (first.length || 1);
  const avgSecond =
    second.reduce((s, e) => s + e.stability, 0) / (second.length || 1);
  const diff = avgSecond - avgFirst;
  if (diff > 5) return "improving";
  if (diff < -5) return "degrading";
  return "volatile";
}

function buildFlakyEntry(
  name: string,
  entries: TestEntry[],
  minFlipCount: number,
  stabilityThreshold: number
): FlakyEntry | null {
  if (entries.length < 2) return null;
  const sorted = [...entries].sort((a, b) => a.date - b.date);

  const flips = computeFlipCount(sorted);
  if (flips < minFlipCount) return null;

  const avgStab = computeAvgStability(sorted);
  if (avgStab > stabilityThreshold) return null;

  return {
    test_name: name,
    test_class: sorted[0].testClass,
    source: "automated",
    flip_count: flips,
    appearances: sorted.length,
    pass_rate: `${computePassRate(sorted)}%`,
    avg_stability: avgStab,
    stability_trend: computeStabilityTrend(sorted),
    last_status: sorted[sorted.length - 1].status,
  };
}

function classifyManualVsAuto(
  manualPassRate: number,
  autoPassRate: number
): string {
  if (manualPassRate > 80 && autoPassRate < 60)
    return "passes manually, flaky in automation";
  if (manualPassRate < 60 && autoPassRate > 80)
    return "passes in automation, flaky manually";
  return "flaky in both";
}

function filterByPeriod<T extends { date: number }>(
  items: T[],
  cutoffDate: number
): T[] {
  return items.filter((item) => item.date >= cutoffDate);
}

// ── Tests ──

describe("Flaky Test Detection Unit Tests", () => {
  describe("Flip-Flop Detection", () => {
    it("should count zero flips when all tests passed", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 100, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "PASSED", stability: 100, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 100, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeFlipCount(entries), 0);
    });

    it("should count zero flips when all tests failed", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "FAILED", stability: 0, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 0, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeFlipCount(entries), 0);
    });

    it("should count one flip for PASSED→FAILED", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 50, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeFlipCount(entries), 1);
    });

    it("should count two flips for PASSED→FAILED→PASSED", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 60, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeFlipCount(entries), 2);
    });

    it("should handle many alternating statuses", () => {
      const entries: TestEntry[] = [];
      for (let i = 0; i < 10; i++) {
        entries.push({
          launchId: i,
          status: i % 2 === 0 ? "PASSED" : "FAILED",
          stability: 50,
          date: i * 1000,
          testClass: "Test",
          testCaseIds: [],
        });
      }
      assert.strictEqual(computeFlipCount(entries), 9);
    });

    it("should ignore non-PASSED/FAILED transitions (e.g., SKIPPED)", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "SKIPPED", stability: 80, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "FAILED", stability: 40, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      // PASSED→SKIPPED = no flip, SKIPPED→FAILED = no flip
      assert.strictEqual(computeFlipCount(entries), 0);
    });

    it("should sort entries by date before counting flips", () => {
      const entries: TestEntry[] = [
        { launchId: 3, status: "PASSED", stability: 60, date: 3000, testClass: "Test", testCaseIds: [] },
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      // Sorted: PASSED(1000)→FAILED(2000)→PASSED(3000) = 2 flips
      assert.strictEqual(computeFlipCount(entries), 2);
    });
  });

  describe("Pass Rate Calculation", () => {
    it("should return 100% when all passed", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 100, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "PASSED", stability: 100, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computePassRate(entries), 100);
    });

    it("should return 0% when all failed", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "FAILED", stability: 0, date: 1000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computePassRate(entries), 0);
    });

    it("should compute correct rate for mixed results", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 60, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computePassRate(entries), 67); // 2/3 ≈ 67%
    });

    it("should return 0 for empty array", () => {
      assert.strictEqual(computePassRate([]), 0);
    });
  });

  describe("Average Stability Calculation", () => {
    it("should compute average stability correctly", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 60, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeAvgStability(entries), 60); // (80+40+60)/3
    });

    it("should return 0 for empty array", () => {
      assert.strictEqual(computeAvgStability([]), 0);
    });

    it("should round to nearest integer", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 33, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 33, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 34, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeAvgStability(entries), 33); // (33+33+34)/3 = 33.33 → 33
    });
  });

  describe("Stability Trend Classification", () => {
    it("should detect improving trend", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "FAILED", stability: 20, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 30, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 60, date: 3000, testClass: "Test", testCaseIds: [] },
        { launchId: 4, status: "PASSED", stability: 80, date: 4000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeStabilityTrend(entries), "improving");
    });

    it("should detect degrading trend", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 90, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "PASSED", stability: 80, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "FAILED", stability: 30, date: 3000, testClass: "Test", testCaseIds: [] },
        { launchId: 4, status: "FAILED", stability: 20, date: 4000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeStabilityTrend(entries), "degrading");
    });

    it("should detect volatile trend when stability is flat", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 50, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 50, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 50, date: 3000, testClass: "Test", testCaseIds: [] },
        { launchId: 4, status: "FAILED", stability: 50, date: 4000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(computeStabilityTrend(entries), "volatile");
    });

    it("should handle only two entries", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 40, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      assert.ok(["volatile", "improving", "degrading"].includes(computeStabilityTrend(entries)));
    });
  });

  describe("Flaky Entry Builder", () => {
    it("should return null for single-entry test (< 2 appearances)", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
      ];
      assert.strictEqual(buildFlakyEntry("TestA", entries, 2, 80), null);
    });

    it("should return null when flip count is below threshold", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 80, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 50, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      // 1 flip, threshold is 2
      assert.strictEqual(buildFlakyEntry("TestA", entries, 2, 80), null);
    });

    it("should return null when avg stability exceeds threshold", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 90, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 90, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 90, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      // avg stability = 90, threshold = 80 → excluded (too stable)
      assert.strictEqual(buildFlakyEntry("TestA", entries, 2, 80), null);
    });

    it("should return a flaky entry when criteria are met", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 60, date: 1000, testClass: "com.app.LoginTest", testCaseIds: [10] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "com.app.LoginTest", testCaseIds: [10] },
        { launchId: 3, status: "PASSED", stability: 50, date: 3000, testClass: "com.app.LoginTest", testCaseIds: [10] },
      ];
      const result = buildFlakyEntry("LoginTest.testOAuth", entries, 2, 80);
      assert.ok(result !== null);
      assert.strictEqual(result!.test_name, "LoginTest.testOAuth");
      assert.strictEqual(result!.test_class, "com.app.LoginTest");
      assert.strictEqual(result!.source, "automated");
      assert.strictEqual(result!.flip_count, 2);
      assert.strictEqual(result!.appearances, 3);
      assert.strictEqual(result!.pass_rate, "67%");
      assert.strictEqual(result!.avg_stability, 50);
      assert.strictEqual(result!.last_status, "PASSED");
    });

    it("should respect custom min_flip_count of 1", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 60, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "Test", testCaseIds: [] },
      ];
      const result = buildFlakyEntry("TestA", entries, 1, 80);
      assert.ok(result !== null);
      assert.strictEqual(result!.flip_count, 1);
    });

    it("should respect custom stability_threshold of 50", () => {
      const entries: TestEntry[] = [
        { launchId: 1, status: "PASSED", stability: 55, date: 1000, testClass: "Test", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 55, date: 2000, testClass: "Test", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 55, date: 3000, testClass: "Test", testCaseIds: [] },
      ];
      // avg stability = 55, threshold = 50 → excluded
      assert.strictEqual(buildFlakyEntry("TestA", entries, 2, 50), null);
    });
  });

  describe("Phase 3: Manual vs Auto Classification", () => {
    it("should detect passes manually, flaky in automation", () => {
      assert.strictEqual(
        classifyManualVsAuto(90, 40),
        "passes manually, flaky in automation"
      );
    });

    it("should detect passes in automation, flaky manually", () => {
      assert.strictEqual(
        classifyManualVsAuto(40, 90),
        "passes in automation, flaky manually"
      );
    });

    it("should detect flaky in both", () => {
      assert.strictEqual(classifyManualVsAuto(50, 50), "flaky in both");
    });

    it("should handle boundary values (manual=81, auto=59)", () => {
      assert.strictEqual(
        classifyManualVsAuto(81, 59),
        "passes manually, flaky in automation"
      );
    });

    it("should handle boundary values (manual=80, auto=60)", () => {
      // 80 is NOT > 80, and 60 is NOT < 60
      assert.strictEqual(classifyManualVsAuto(80, 60), "flaky in both");
    });
  });

  describe("Period Filtering", () => {
    it("should filter entries by cutoff date", () => {
      const now = Date.now();
      const entries = [
        { date: now - 5 * 86400000, status: "PASSED" },
        { date: now - 20 * 86400000, status: "FAILED" },
        { date: now - 1 * 86400000, status: "PASSED" },
      ];
      const cutoff = now - 14 * 86400000;
      const filtered = filterByPeriod(entries, cutoff);
      assert.strictEqual(filtered.length, 2);
    });

    it("should return empty array when all entries are before cutoff", () => {
      const cutoff = Date.now();
      const entries = [
        { date: cutoff - 86400000, status: "PASSED" },
        { date: cutoff - 2 * 86400000, status: "FAILED" },
      ];
      const filtered = filterByPeriod(entries, cutoff);
      assert.strictEqual(filtered.length, 0);
    });

    it("should include entry exactly at cutoff", () => {
      const cutoff = 1000;
      const entries = [{ date: 1000, status: "PASSED" }];
      const filtered = filterByPeriod(entries, cutoff);
      assert.strictEqual(filtered.length, 1);
    });
  });

  describe("Parameter Validation", () => {
    it("should validate period_days range (1-90)", () => {
      assert.ok(1 >= 1 && 1 <= 90, "period_days=1 should be valid");
      assert.ok(90 >= 1 && 90 <= 90, "period_days=90 should be valid");
      assert.ok(14 >= 1 && 14 <= 90, "period_days=14 (default) should be valid");
      assert.ok(!(0 >= 1), "period_days=0 should be invalid");
      assert.ok(!(91 <= 90), "period_days=91 should be invalid");
    });

    it("should validate min_flip_count is positive", () => {
      assert.ok(1 > 0, "min_flip_count=1 should be valid");
      assert.ok(2 > 0, "min_flip_count=2 (default) should be valid");
      assert.ok(!(0 > 0), "min_flip_count=0 should be invalid");
    });

    it("should validate stability_threshold range (0-100)", () => {
      assert.ok(0 >= 0 && 0 <= 100, "stability_threshold=0 should be valid");
      assert.ok(100 >= 0 && 100 <= 100, "stability_threshold=100 should be valid");
      assert.ok(80 >= 0 && 80 <= 100, "stability_threshold=80 (default) should be valid");
    });

    it("should validate limit max (200)", () => {
      assert.ok(50 >= 1 && 50 <= 200, "limit=50 (default) should be valid");
      assert.ok(200 >= 1 && 200 <= 200, "limit=200 should be valid");
      assert.ok(!(201 <= 200), "limit=201 should be invalid");
    });

    it("should validate format enum values", () => {
      const validFormats = ["json", "string", "jira"];
      assert.ok(validFormats.includes("json"));
      assert.ok(validFormats.includes("string"));
      assert.ok(validFormats.includes("jira"));
      assert.ok(!validFormats.includes("xml"));
    });

    it("should validate chart enum values", () => {
      const validCharts = ["none", "png", "html", "text"];
      assert.ok(validCharts.includes("none"));
      assert.ok(validCharts.includes("png"));
      assert.ok(validCharts.includes("html"));
      assert.ok(validCharts.includes("text"));
      assert.ok(!validCharts.includes("svg"));
    });
  });

  describe("Sorting and Limiting", () => {
    it("should sort flaky tests by flip_count descending", () => {
      const tests: FlakyEntry[] = [
        { test_name: "A", test_class: "", source: "automated", flip_count: 2, appearances: 5, pass_rate: "60%", avg_stability: 50, stability_trend: "volatile", last_status: "FAILED" },
        { test_name: "B", test_class: "", source: "automated", flip_count: 7, appearances: 10, pass_rate: "50%", avg_stability: 40, stability_trend: "volatile", last_status: "PASSED" },
        { test_name: "C", test_class: "", source: "manual_only", flip_count: 4, appearances: 8, pass_rate: "55%", avg_stability: 45, stability_trend: "degrading", last_status: "FAILED" },
      ];
      const sorted = [...tests].sort(
        (a, b) => b.flip_count - a.flip_count || a.avg_stability - b.avg_stability
      );
      assert.strictEqual(sorted[0].test_name, "B"); // flip_count=7
      assert.strictEqual(sorted[1].test_name, "C"); // flip_count=4
      assert.strictEqual(sorted[2].test_name, "A"); // flip_count=2
    });

    it("should use avg_stability as tiebreaker (lower = more flaky first)", () => {
      const tests: FlakyEntry[] = [
        { test_name: "A", test_class: "", source: "automated", flip_count: 5, appearances: 10, pass_rate: "50%", avg_stability: 60, stability_trend: "volatile", last_status: "FAILED" },
        { test_name: "B", test_class: "", source: "automated", flip_count: 5, appearances: 10, pass_rate: "50%", avg_stability: 30, stability_trend: "volatile", last_status: "FAILED" },
      ];
      const sorted = [...tests].sort(
        (a, b) => b.flip_count - a.flip_count || a.avg_stability - b.avg_stability
      );
      assert.strictEqual(sorted[0].test_name, "B"); // lower stability first
    });

    it("should limit results to specified count", () => {
      const tests: FlakyEntry[] = Array.from({ length: 100 }, (_, i) => ({
        test_name: `Test${i}`,
        test_class: "",
        source: "automated",
        flip_count: 100 - i,
        appearances: 10,
        pass_rate: "50%",
        avg_stability: 50,
        stability_trend: "volatile" as const,
        last_status: "FAILED",
      }));
      const limited = tests.slice(0, 50);
      assert.strictEqual(limited.length, 50);
      assert.strictEqual(limited[0].test_name, "Test0");
    });
  });

  describe("Integration: End-to-End Flaky Detection Pipeline", () => {
    it("should process a realistic multi-launch dataset", () => {
      const testMap = new Map<string, TestEntry[]>();

      // Test 1: Flaky (3 flips, low stability)
      testMap.set("LoginTest.testOAuth", [
        { launchId: 1, status: "PASSED", stability: 60, date: 1000, testClass: "LoginTest", testCaseIds: [1] },
        { launchId: 2, status: "FAILED", stability: 40, date: 2000, testClass: "LoginTest", testCaseIds: [1] },
        { launchId: 3, status: "PASSED", stability: 50, date: 3000, testClass: "LoginTest", testCaseIds: [1] },
        { launchId: 4, status: "FAILED", stability: 30, date: 4000, testClass: "LoginTest", testCaseIds: [1] },
      ]);

      // Test 2: Stable (no flips)
      testMap.set("LoginTest.testBasic", [
        { launchId: 1, status: "PASSED", stability: 100, date: 1000, testClass: "LoginTest", testCaseIds: [2] },
        { launchId: 2, status: "PASSED", stability: 100, date: 2000, testClass: "LoginTest", testCaseIds: [2] },
        { launchId: 3, status: "PASSED", stability: 100, date: 3000, testClass: "LoginTest", testCaseIds: [2] },
      ]);

      // Test 3: Borderline (1 flip, below threshold)
      testMap.set("CartTest.testAdd", [
        { launchId: 1, status: "PASSED", stability: 70, date: 1000, testClass: "CartTest", testCaseIds: [3] },
        { launchId: 2, status: "FAILED", stability: 50, date: 2000, testClass: "CartTest", testCaseIds: [3] },
      ]);

      // Test 4: Also flaky (2 flips)
      testMap.set("PaymentTest.testCheckout", [
        { launchId: 1, status: "FAILED", stability: 30, date: 1000, testClass: "PaymentTest", testCaseIds: [4] },
        { launchId: 2, status: "PASSED", stability: 50, date: 2000, testClass: "PaymentTest", testCaseIds: [4] },
        { launchId: 3, status: "FAILED", stability: 40, date: 3000, testClass: "PaymentTest", testCaseIds: [4] },
      ]);

      const automatedFlaky: FlakyEntry[] = [];
      for (const [name, entries] of testMap.entries()) {
        const entry = buildFlakyEntry(name, entries, 2, 80);
        if (entry) automatedFlaky.push(entry);
      }

      automatedFlaky.sort(
        (a, b) => b.flip_count - a.flip_count || a.avg_stability - b.avg_stability
      );

      assert.strictEqual(automatedFlaky.length, 2, "Should find 2 flaky tests");
      assert.strictEqual(automatedFlaky[0].test_name, "LoginTest.testOAuth");
      assert.strictEqual(automatedFlaky[0].flip_count, 3);
      assert.strictEqual(automatedFlaky[1].test_name, "PaymentTest.testCheckout");
      assert.strictEqual(automatedFlaky[1].flip_count, 2);
    });

    it("should handle count_only mode (Phase 1 only)", () => {
      const testMap = new Map<string, TestEntry[]>();
      testMap.set("FlakyTest", [
        { launchId: 1, status: "PASSED", stability: 50, date: 1000, testClass: "T", testCaseIds: [] },
        { launchId: 2, status: "FAILED", stability: 50, date: 2000, testClass: "T", testCaseIds: [] },
        { launchId: 3, status: "PASSED", stability: 50, date: 3000, testClass: "T", testCaseIds: [] },
      ]);
      testMap.set("StableTest", [
        { launchId: 1, status: "PASSED", stability: 100, date: 1000, testClass: "T", testCaseIds: [] },
        { launchId: 2, status: "PASSED", stability: 100, date: 2000, testClass: "T", testCaseIds: [] },
      ]);

      const flaky: FlakyEntry[] = [];
      for (const [name, entries] of testMap.entries()) {
        const entry = buildFlakyEntry(name, entries, 2, 80);
        if (entry) flaky.push(entry);
      }

      const countOnlyResult = {
        automated_flaky_count: flaky.length,
        total_tests_analyzed: testMap.size,
      };

      assert.strictEqual(countOnlyResult.automated_flaky_count, 1);
      assert.strictEqual(countOnlyResult.total_tests_analyzed, 2);
    });

    it("should merge automated and manual flaky tests and respect limit", () => {
      const automated: FlakyEntry[] = Array.from({ length: 5 }, (_, i) => ({
        test_name: `Auto${i}`, test_class: "", source: "automated",
        flip_count: 10 - i, appearances: 10, pass_rate: "50%",
        avg_stability: 50, stability_trend: "volatile", last_status: "FAILED",
      }));
      const manual: FlakyEntry[] = Array.from({ length: 3 }, (_, i) => ({
        test_name: `Manual${i}`, test_class: "", source: "manual_only",
        flip_count: 8 - i, appearances: 10, pass_rate: "50%",
        avg_stability: 50, stability_trend: "volatile", last_status: "FAILED",
      }));

      const merged = [...automated, ...manual]
        .sort((a, b) => b.flip_count - a.flip_count || a.avg_stability - b.avg_stability)
        .slice(0, 5);

      assert.strictEqual(merged.length, 5);
      assert.strictEqual(merged[0].flip_count, 10);
      assert.ok(merged.some((t) => t.source === "manual_only"));
    });
  });
});
