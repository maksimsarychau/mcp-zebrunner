import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  appendCallMetricsFooter,
  buildCallMetricsPayload,
  formatCallMetricsFooter,
  normalizeMetricDimension,
  responseContentCharCount,
  stripCallMetricsArg,
} from "../../src/utils/response-metrics.js";

describe("response-metrics", () => {
  describe("normalizeMetricDimension()", () => {
    it("should use dash for empty values", () => {
      assert.equal(normalizeMetricDimension(undefined), "-");
      assert.equal(normalizeMetricDimension(null), "-");
      assert.equal(normalizeMetricDimension(""), "-");
    });

    it("should stringify non-empty values", () => {
      assert.equal(normalizeMetricDimension("compact"), "compact");
      assert.equal(normalizeMetricDimension(42), "42");
    });
  });

  describe("buildCallMetricsPayload()", () => {
    it("should build payload with approx tokens", () => {
      const payload = buildCallMetricsPayload("adv_list_test_suites", 120, 400, "compact", "summary");
      assert.deepEqual(payload, {
        tool: "adv_list_test_suites",
        durationMs: 120,
        responseChars: 400,
        approxTokens: 100,
        format: "compact",
        detail: "summary",
      });
    });
  });

  describe("formatCallMetricsFooter()", () => {
    it("should prefix JSON with _mcp_metrics", () => {
      const footer = formatCallMetricsFooter(
        buildCallMetricsPayload("tool", 1, 8, "json", "-"),
      );
      assert.ok(footer.startsWith("_mcp_metrics: "));
      assert.ok(footer.includes('"tool":"tool"'));
    });
  });

  describe("responseContentCharCount()", () => {
    it("should sum text block lengths", () => {
      const count = responseContentCharCount([
        { type: "text", text: "abc" },
        { type: "text", text: "de" },
        { type: "image", data: "ignored" },
      ]);
      assert.equal(count, 5);
    });
  });

  describe("appendCallMetricsFooter()", () => {
    it("should append to last text block", () => {
      const result = appendCallMetricsFooter(
        { content: [{ type: "text", text: "body" }] },
        "_mcp_metrics: {}",
      );
      assert.ok(result.content![0].text!.includes("body"));
      assert.ok(result.content![0].text!.includes("_mcp_metrics: {}"));
    });

    it("should create text block when content is empty", () => {
      const result = appendCallMetricsFooter({ content: [] }, "_mcp_metrics: {}");
      assert.equal(result.content!.length, 1);
      assert.equal(result.content![0].text, "_mcp_metrics: {}");
    });
  });

  describe("stripCallMetricsArg()", () => {
    it("should strip include_call_metrics from handler args", () => {
      const { handlerArgs, includeCallMetrics } = stripCallMetricsArg(
        { project_key: "MCP", include_call_metrics: true, format: "compact" },
        false,
      );
      assert.deepEqual(handlerArgs, { project_key: "MCP", format: "compact" });
      assert.equal(includeCallMetrics, true);
    });

    it("should enable footer when env flag is true", () => {
      const { includeCallMetrics } = stripCallMetricsArg({ format: "json" }, true);
      assert.equal(includeCallMetrics, true);
    });

    it("should not enable footer when both off", () => {
      const { includeCallMetrics } = stripCallMetricsArg({ format: "json" }, false);
      assert.equal(includeCallMetrics, false);
    });
  });
});
