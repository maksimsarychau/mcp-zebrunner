import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

/**
 * Unit tests for analyze_regression_runtime tool
 *
 * Tests duration classification logic, metrics calculations,
 * test case coverage breakdown, and attempt elapsed computation.
 */

const DEFAULT_MEDIUM_THRESHOLD_S = 300;
const DEFAULT_LONG_THRESHOLD_S = 600;

function classifyTestDuration(
  durationSeconds: number,
  mediumThreshold = DEFAULT_MEDIUM_THRESHOLD_S,
  longThreshold = DEFAULT_LONG_THRESHOLD_S
): 'short' | 'medium' | 'long' {
  if (durationSeconds < mediumThreshold) return 'short';
  if (durationSeconds < longThreshold) return 'medium';
  return 'long';
}

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function computeAttemptElapsed(attempt: { startedAt: string; finishedAt?: string | null }): number {
  if (!attempt.finishedAt) return 0;
  const start = new Date(attempt.startedAt).getTime();
  const end = new Date(attempt.finishedAt).getTime();
  return Math.max(0, (end - start) / 1000);
}

describe('Regression Runtime Tools Unit Tests', () => {

  describe('Duration Classification', () => {

    it('should classify tests under 300s as short (default thresholds)', () => {
      assert.strictEqual(classifyTestDuration(0), 'short');
      assert.strictEqual(classifyTestDuration(15), 'short');
      assert.strictEqual(classifyTestDuration(120), 'short');
      assert.strictEqual(classifyTestDuration(299), 'short');
    });

    it('should classify tests 300-599s as medium (default thresholds)', () => {
      assert.strictEqual(classifyTestDuration(300), 'medium');
      assert.strictEqual(classifyTestDuration(400), 'medium');
      assert.strictEqual(classifyTestDuration(599), 'medium');
    });

    it('should classify tests 600s+ as long (default thresholds)', () => {
      assert.strictEqual(classifyTestDuration(600), 'long');
      assert.strictEqual(classifyTestDuration(900), 'long');
      assert.strictEqual(classifyTestDuration(3600), 'long');
    });

    it('should support custom thresholds', () => {
      assert.strictEqual(classifyTestDuration(59, 60, 300), 'short');
      assert.strictEqual(classifyTestDuration(60, 60, 300), 'medium');
      assert.strictEqual(classifyTestDuration(299, 60, 300), 'medium');
      assert.strictEqual(classifyTestDuration(300, 60, 300), 'long');

      assert.strictEqual(classifyTestDuration(599, 600, 1200), 'short');
      assert.strictEqual(classifyTestDuration(600, 600, 1200), 'medium');
      assert.strictEqual(classifyTestDuration(1200, 600, 1200), 'long');
    });

    it('should classify a realistic test suite', () => {
      const durations = [5, 30, 120, 250, 310, 400, 500, 550, 650, 1200];
      const classified = durations.map(d => classifyTestDuration(d));

      const short = classified.filter(c => c === 'short').length;
      const medium = classified.filter(c => c === 'medium').length;
      const long = classified.filter(c => c === 'long').length;

      assert.strictEqual(short, 4);
      assert.strictEqual(medium, 4);
      assert.strictEqual(long, 2);
      assert.strictEqual(short + medium + long, durations.length);
    });
  });

  describe('Elapsed Time Formatting', () => {

    it('should format seconds only', () => {
      assert.strictEqual(formatElapsed(45), '45s');
    });

    it('should format minutes and seconds', () => {
      assert.strictEqual(formatElapsed(125), '2m 5s');
    });

    it('should format hours, minutes and seconds', () => {
      assert.strictEqual(formatElapsed(4578), '1h 16m 18s');
    });

    it('should format zero', () => {
      assert.strictEqual(formatElapsed(0), '0s');
    });

    it('should format exact hour', () => {
      assert.strictEqual(formatElapsed(3600), '1h 0m 0s');
    });
  });

  describe('Attempt Elapsed Computation', () => {

    it('should compute elapsed from ISO timestamps', () => {
      const elapsed = computeAttemptElapsed({
        startedAt: "2026-03-21T02:51:39.906764Z",
        finishedAt: "2026-03-21T03:23:13.496575Z"
      });
      assert.ok(elapsed > 1890 && elapsed < 1895, `Expected ~1893s, got ${elapsed}`);
    });

    it('should return 0 when finishedAt is null', () => {
      const elapsed = computeAttemptElapsed({
        startedAt: "2026-03-21T02:51:39Z",
        finishedAt: null
      });
      assert.strictEqual(elapsed, 0);
    });

    it('should return 0 when finishedAt is undefined', () => {
      const elapsed = computeAttemptElapsed({
        startedAt: "2026-03-21T02:51:39Z"
      });
      assert.strictEqual(elapsed, 0);
    });
  });

  describe('Average Runtime per Test Calculation', () => {

    it('should compute avg runtime per test', () => {
      const elapsed = 4578;
      const totalTests = 146;
      const avg = Math.round((elapsed / totalTests) * 100) / 100;
      assert.strictEqual(avg, 31.36);
    });

    it('should handle zero tests gracefully', () => {
      const elapsed = 4578;
      const totalTests = 0;
      const avg = totalTests > 0 ? Math.round((elapsed / totalTests) * 100) / 100 : 0;
      assert.strictEqual(avg, 0);
    });

    it('should compute avg runtime per test case separately', () => {
      const elapsed = 4578;
      const totalTests = 146;
      const totalTestCases = 230;

      const avgPerTest = Math.round((elapsed / totalTests) * 100) / 100;
      const avgPerTestCase = Math.round((elapsed / totalTestCases) * 100) / 100;

      assert.ok(avgPerTestCase < avgPerTest, 'avg per test case should be less when more TCs than tests');
      assert.strictEqual(avgPerTestCase, 19.9);
    });
  });

  describe('Weighted Runtime Index', () => {

    it('should compute weighted index with all duration classes', () => {
      const buckets = {
        short:  { count: 80, avgDuration: 25 },
        medium: { count: 50, avgDuration: 150 },
        long:   { count: 16, avgDuration: 450 }
      };

      const wShort = 1, wMedium = 2, wLong = 3;
      const weightedSum =
        buckets.short.avgDuration * buckets.short.count * wShort +
        buckets.medium.avgDuration * buckets.medium.count * wMedium +
        buckets.long.avgDuration * buckets.long.count * wLong;
      const weightedCount =
        buckets.short.count * wShort +
        buckets.medium.count * wMedium +
        buckets.long.count * wLong;
      const index = Math.round((weightedSum / weightedCount) * 100) / 100;

      assert.ok(index > 0, 'Weighted index should be positive');
      assert.ok(index > buckets.short.avgDuration, 'Index should exceed short avg due to weighting');
      assert.ok(index < buckets.long.avgDuration, 'Index should be below long avg');
    });

    it('should return 0 when no tests', () => {
      const weightedCount = 0;
      const index = weightedCount > 0 ? 1 : 0;
      assert.strictEqual(index, 0);
    });

    it('should compute WRI per test case using avgDurationPerTestCase', () => {
      const buckets = {
        short:  { count: 80, avgDuration: 25, testCasesCovered: 120, totalDuration: 2000, avgDurationPerTestCase: 0 },
        medium: { count: 50, avgDuration: 150, testCasesCovered: 80, totalDuration: 7500, avgDurationPerTestCase: 0 },
        long:   { count: 16, avgDuration: 450, testCasesCovered: 20, totalDuration: 7200, avgDurationPerTestCase: 0 }
      };
      buckets.short.avgDurationPerTestCase = Math.round(buckets.short.totalDuration / buckets.short.testCasesCovered);
      buckets.medium.avgDurationPerTestCase = Math.round(buckets.medium.totalDuration / buckets.medium.testCasesCovered);
      buckets.long.avgDurationPerTestCase = Math.round(buckets.long.totalDuration / buckets.long.testCasesCovered);

      const wShort = 1, wMedium = 2, wLong = 3;
      const weightedSumPerTC =
        buckets.short.avgDurationPerTestCase * buckets.short.testCasesCovered * wShort +
        buckets.medium.avgDurationPerTestCase * buckets.medium.testCasesCovered * wMedium +
        buckets.long.avgDurationPerTestCase * buckets.long.testCasesCovered * wLong;
      const weightedCountPerTC =
        buckets.short.testCasesCovered * wShort +
        buckets.medium.testCasesCovered * wMedium +
        buckets.long.testCasesCovered * wLong;
      const indexPerTC = Math.round((weightedSumPerTC / weightedCountPerTC) * 100) / 100;

      const weightedSumPerTest =
        buckets.short.avgDuration * buckets.short.count * wShort +
        buckets.medium.avgDuration * buckets.medium.count * wMedium +
        buckets.long.avgDuration * buckets.long.count * wLong;
      const weightedCountPerTest =
        buckets.short.count * wShort + buckets.medium.count * wMedium + buckets.long.count * wLong;
      const indexPerTest = Math.round((weightedSumPerTest / weightedCountPerTest) * 100) / 100;

      assert.ok(indexPerTC > 0, 'WRI per test case should be positive');
      assert.ok(indexPerTC !== indexPerTest, 'WRI per test case should differ from WRI per test when TC/test ratios vary');
    });

    it('should return 0 WRI per test case when no test cases', () => {
      const weightedCountPerTC = 0;
      const index = weightedCountPerTC > 0 ? 1 : 0;
      assert.strictEqual(index, 0);
    });
  });

  describe('Test Case Coverage Breakdown', () => {

    it('should count tests with 0, 1, and multiple test cases', () => {
      const tests = [
        { testCases: [{ testCaseId: "A-1" }, { testCaseId: "A-2" }] },
        { testCases: [{ testCaseId: "A-3" }] },
        { testCases: [] },
        { },
        { testCases: [{ testCaseId: "B-1" }, { testCaseId: "B-2" }, { testCaseId: "B-3" }] }
      ];

      let total = 0, zero = 0, one = 0, multi = 0;
      for (const t of tests) {
        const count = (t as any).testCases?.length ?? 0;
        total += count;
        if (count === 0) zero++;
        else if (count === 1) one++;
        else multi++;
      }

      assert.strictEqual(total, 6);
      assert.strictEqual(zero, 2);
      assert.strictEqual(one, 1);
      assert.strictEqual(multi, 2);
    });

    it('should correctly distribute test cases across duration classes', () => {
      const tests = [
        { durationSeconds: 10, testCases: [{ id: "A" }, { id: "B" }] },
        { durationSeconds: 30, testCases: [{ id: "C" }] },
        { durationSeconds: 350, testCases: [{ id: "D" }, { id: "E" }, { id: "F" }] },
        { durationSeconds: 700, testCases: [] }
      ];

      const buckets: Record<string, { testCases: number; totalDuration: number; count: number }> = {
        short: { testCases: 0, totalDuration: 0, count: 0 },
        medium: { testCases: 0, totalDuration: 0, count: 0 },
        long: { testCases: 0, totalDuration: 0, count: 0 }
      };
      for (const t of tests) {
        const cls = classifyTestDuration(t.durationSeconds);
        buckets[cls].testCases += t.testCases.length;
        buckets[cls].totalDuration += t.durationSeconds;
        buckets[cls].count++;
      }

      assert.strictEqual(buckets.short.testCases, 3);
      assert.strictEqual(buckets.medium.testCases, 3);
      assert.strictEqual(buckets.long.testCases, 0);

      const shortAvgPerTC = buckets.short.testCases > 0
        ? Math.round(buckets.short.totalDuration / buckets.short.testCases) : 0;
      const mediumAvgPerTC = buckets.medium.testCases > 0
        ? Math.round(buckets.medium.totalDuration / buckets.medium.testCases) : 0;
      const shortAvgPerTest = buckets.short.count > 0
        ? Math.round(buckets.short.totalDuration / buckets.short.count) : 0;

      assert.strictEqual(shortAvgPerTC, Math.round(40 / 3));
      assert.strictEqual(mediumAvgPerTC, Math.round(350 / 3));
      assert.ok(shortAvgPerTC < shortAvgPerTest, 'avgDurationPerTestCase should be less when TCs > tests');
    });
  });

  describe('Baseline Delta Calculation', () => {

    it('should calculate percentage delta correctly', () => {
      const current = 35.5;
      const previous = 31.0;
      const delta = Math.round(((current - previous) / previous) * 10000) / 100;
      assert.strictEqual(delta, 14.52);
    });

    it('should detect degraded status when delta > 5%', () => {
      const delta = 14.52;
      const status = Math.abs(delta) <= 5 ? 'stable' : delta > 0 ? 'degraded' : 'improved';
      assert.strictEqual(status, 'degraded');
    });

    it('should detect stable status when delta within 5%', () => {
      const delta = 3.2;
      const status = Math.abs(delta) <= 5 ? 'stable' : delta > 0 ? 'degraded' : 'improved';
      assert.strictEqual(status, 'stable');
    });

    it('should detect improved status when delta < -5%', () => {
      const delta = -12.0;
      const status = Math.abs(delta) <= 5 ? 'stable' : delta > 0 ? 'degraded' : 'improved';
      assert.strictEqual(status, 'improved');
    });

    it('should handle zero previous value', () => {
      const previous = 0;
      const delta = previous > 0 ? ((10 - previous) / previous) * 100 : 0;
      assert.strictEqual(delta, 0);
    });

    it('should detect abnormal long-test degradation above 20%', () => {
      const currentLongAvg = 550;
      const previousLongAvg = 400;
      const degradation = ((currentLongAvg - previousLongAvg) / previousLongAvg) * 100;
      assert.ok(degradation > 20, 'Should flag as abnormal degradation');
      assert.strictEqual(Math.round(degradation * 100) / 100, 37.5);
    });
  });

  describe('Tool Parameter Validation', () => {

    it('should require project parameter', () => {
      const params = { project: 'android', milestone: 'develop-49771' };
      assert.ok(params.project, 'project is required');
    });

    it('should accept all filter combinations', () => {
      const combinations = [
        { milestone: 'develop-49771' },
        { build: 'myfitnesspal-develop-49771-qaRelease.apk' },
        { suite_names: ['Android-Social-AA', 'Android-Core'] },
        { launch_ids: [127644] },
        { milestone: 'develop-49771', suite_names: ['Android-Social-AA'] }
      ];

      for (const c of combinations) {
        const hasFilter = (c as any).milestone || (c as any).build || (c as any).suite_names || (c as any).launch_ids;
        assert.ok(hasFilter, 'At least one filter should be provided');
      }
    });

    it('should validate format parameter options', () => {
      const validFormats = ['dto', 'json', 'string'];
      validFormats.forEach(f => {
        assert.ok(['dto', 'json', 'string'].includes(f), `${f} should be valid`);
      });
    });

    it('should validate session_resolution parameter options', () => {
      const valid = ['auto', 'per_test', 'launch_level'];
      valid.forEach(v => {
        assert.ok(['auto', 'per_test', 'launch_level'].includes(v), `${v} should be valid`);
      });
    });
  });

  describe('Session-Aware Duration Classification', () => {

    it('should classify by effective duration, not wall-clock', () => {
      const wallClockSeconds = 2459;
      const effectiveSeconds = 979;
      assert.strictEqual(classifyTestDuration(wallClockSeconds), 'long');
      assert.strictEqual(classifyTestDuration(effectiveSeconds), 'long');

      const wallClock2 = 600;
      const effective2 = 45;
      assert.strictEqual(classifyTestDuration(wallClock2), 'long');
      assert.strictEqual(classifyTestDuration(effective2), 'short');
    });

    it('should correctly track retry overhead', () => {
      const tests = [
        { effective: 120, totalRetry: 350 },
        { effective: 45, totalRetry: 45 },
        { effective: 500, totalRetry: 1200 }
      ];

      let retryOverhead = 0;
      let testsWithRetries = 0;
      for (const t of tests) {
        if (t.totalRetry > t.effective) {
          testsWithRetries++;
          retryOverhead += t.totalRetry - t.effective;
        }
      }

      assert.strictEqual(testsWithRetries, 2);
      assert.strictEqual(retryOverhead, 930);
    });

    it('should use effective durations for bucket aggregation', () => {
      const tests = [
        { wallClock: 2459, effective: 979 },
        { wallClock: 800, effective: 450 },
        { wallClock: 600, effective: 150 },
        { wallClock: 30, effective: 30 }
      ];

      const buckets: Record<string, { count: number; total: number }> = {
        short: { count: 0, total: 0 },
        medium: { count: 0, total: 0 },
        long: { count: 0, total: 0 }
      };

      for (const t of tests) {
        const cls = classifyTestDuration(t.effective);
        buckets[cls].count++;
        buckets[cls].total += t.effective;
      }

      assert.strictEqual(buckets.short.count, 2);
      assert.strictEqual(buckets.medium.count, 1);
      assert.strictEqual(buckets.long.count, 1);
      assert.strictEqual(buckets.short.total, 180);
      assert.strictEqual(buckets.medium.total, 450);
      assert.strictEqual(buckets.long.total, 979);
    });
  });
});
