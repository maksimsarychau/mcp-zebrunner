import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  capCasesForByteBudget,
  legacyBulkTruncate,
  compactBulkTruncate,
  truncateBulkItems,
  measurePayloadBytes,
  MAX_RESPONSE_BYTES,
} from "../../src/utils/bulk-truncation.js";
import { projectTestCases, serializeFormattedOutput } from "../../src/utils/formatter.js";

function makeCase(i: number) {
  return {
    id: i,
    key: `TC-${i}`,
    title: `Case ${i} `.repeat(20),
    description: "d".repeat(500),
  };
}

describe("bulk-truncation", () => {
  describe("capCasesForByteBudget()", () => {
    it("returns all cases when payload fits budget", () => {
      const cases = [makeCase(1), makeCase(2)];
      const result = capCasesForByteBudget(
        cases,
        (slice) => ({ total: cases.length, test_cases: slice }),
        50_000,
      );
      assert.equal(result.slice.length, 2);
      assert.equal(result.wasTruncated, false);
    });

    it("binary-searches row cap from compact wrapper size", () => {
      const cases = Array.from({ length: 200 }, (_, i) => makeCase(i));
      const buildPayload = (slice: typeof cases) => ({
        project_key: "MCP",
        total_fetched: cases.length,
        was_truncated: true,
        test_cases: slice,
      });
      const capped = capCasesForByteBudget(cases, buildPayload, 20_000);
      assert.ok(capped.slice.length < cases.length);
      assert.equal(capped.wasTruncated, true);
      assert.ok(measurePayloadBytes(buildPayload(capped.slice)) <= 20_000);
    });
  });

  describe("truncateBulkItems()", () => {
    it("compact path uses wrapper shape, not bare array root", () => {
      const cases = Array.from({ length: 100 }, (_, i) => makeCase(i));
      const buildPayload = (s: typeof cases) => ({
        project_key: "MCP",
        total_fetched: cases.length,
        was_truncated: true,
        test_cases: s,
      });
      const capped = compactBulkTruncate(cases, buildPayload, "compact", 15_000);
      assert.ok(capped.slice.length < cases.length);
      assert.ok(capped.bodyText.includes('"project_key"'));
      assert.ok(capped.bodyText.includes('"test_cases"'));
      assert.ok(!capped.bodyText.trimStart().startsWith("["));
    });

    it("json path keeps legacy bare-array slice (golden behavior)", () => {
      const cases = Array.from({ length: 100 }, (_, i) => makeCase(i));
      const fullJson = serializeFormattedOutput(cases, "json");
      const legacy = legacyBulkTruncate(cases, fullJson.length, "json");
      const viaHelper = truncateBulkItems(
        cases,
        fullJson.length,
        "json",
        (s) => ({ test_cases: s }),
      );
      assert.equal(viaHelper.bodyText, legacy.bodyText);
      assert.deepEqual(viaHelper.slice, legacy.slice);
    });

    it("compact returns fewer or equal rows than json for same cases at same budget", () => {
      const cases = Array.from({ length: 150 }, (_, i) => makeCase(i));
      const fullJson = serializeFormattedOutput(cases, "json");
      const buildPayload = (slice: typeof cases) => ({
        project_key: "MCP",
        total_fetched: cases.length,
        was_truncated: true,
        test_cases: slice,
      });
      const jsonTrunc = legacyBulkTruncate(cases, fullJson.length, "json");
      const compactTrunc = compactBulkTruncate(cases, buildPayload, "compact");
      assert.ok(compactTrunc.slice.length <= jsonTrunc.slice.length);
    });
  });

  describe("get_all_tcm_test_cases_by_project json truncation golden", () => {
    function goldenProjectedCases() {
      const raw = Array.from({ length: 110 }, (_, i) => ({
        id: 1000 + i,
        key: `MCP-${1000 + i}`,
        title: "Login flow validation step with extended title padding",
        priority: { name: "High" },
        automationState: { name: "Automated" },
        description: "x".repeat(8000),
      }));
      return projectTestCases(raw, "full");
    }

    it("unchanged bare-array json slice for projected bulk-by-project cases", () => {
      const projectedCases = goldenProjectedCases();
      const resultText = serializeFormattedOutput(projectedCases, "json");
      assert.ok(resultText.length > MAX_RESPONSE_BYTES, "fixture must exceed MCP safety net");

      const legacy = legacyBulkTruncate(projectedCases, resultText.length, "json");
      const viaHandler = truncateBulkItems(
        projectedCases,
        resultText.length,
        "json",
        (slice) => ({
          project_key: "MCP",
          total_fetched: projectedCases.length,
          was_truncated: true,
          test_cases: slice,
        }),
      );

      assert.deepEqual(viaHandler.slice, legacy.slice);
      assert.equal(viaHandler.bodyText, legacy.bodyText);
      assert.equal(viaHandler.wasTruncated, true);
      assert.ok(legacy.slice.length < projectedCases.length);
      assert.equal(legacy.slice[0]?.key, "MCP-1000");
      assert.ok(legacy.bodyText.trimStart().startsWith("["));
      assert.ok(!legacy.bodyText.includes('"project_key"'));
      assert.equal(
        legacy.bodyText,
        serializeFormattedOutput(legacy.slice, "json"),
      );
    });
  });
});
