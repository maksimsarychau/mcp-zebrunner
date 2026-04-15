import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";

import { ToolMetrics, wrapToolHandler } from "../../src/utils/tool-metrics.js";

describe("ToolMetrics", () => {
  let metrics: ToolMetrics;

  beforeEach(() => {
    metrics = new ToolMetrics();
  });

  describe("record()", () => {
    it("should record a single tool call", () => {
      metrics.record("list_test_suites", 150, 2000, false);
      const stats = metrics.getStats().get("list_test_suites");
      assert.ok(stats);
      assert.equal(stats.callCount, 1);
      assert.equal(stats.totalDurationMs, 150);
      assert.equal(stats.avgDurationMs, 150);
      assert.equal(stats.minDurationMs, 150);
      assert.equal(stats.maxDurationMs, 150);
      assert.equal(stats.totalResponseChars, 2000);
      assert.equal(stats.errorCount, 0);
      assert.ok(stats.lastCalledAt);
    });

    it("should accumulate multiple calls for the same tool", () => {
      metrics.record("get_test_case", 100, 500, false);
      metrics.record("get_test_case", 200, 1500, false);
      metrics.record("get_test_case", 50, 300, true);

      const stats = metrics.getStats().get("get_test_case")!;
      assert.equal(stats.callCount, 3);
      assert.equal(stats.totalDurationMs, 350);
      assert.equal(Math.round(stats.avgDurationMs), 117);
      assert.equal(stats.minDurationMs, 50);
      assert.equal(stats.maxDurationMs, 200);
      assert.equal(stats.totalResponseChars, 2300);
      assert.equal(stats.errorCount, 1);
    });

    it("should track multiple tools independently", () => {
      metrics.record("tool_a", 100, 500, false);
      metrics.record("tool_b", 200, 1000, false);

      assert.equal(metrics.getStats().size, 2);
      assert.equal(metrics.getStats().get("tool_a")!.callCount, 1);
      assert.equal(metrics.getStats().get("tool_b")!.callCount, 1);
    });
  });

  describe("getSummaryMarkdown()", () => {
    it("should return empty message when no calls recorded", () => {
      const md = metrics.getSummaryMarkdown();
      assert.ok(md.includes("No tool calls recorded"));
    });

    it("should produce a markdown table with headers", () => {
      metrics.record("list_projects", 120, 800, false);
      metrics.record("get_test_case", 250, 3000, false);

      const md = metrics.getSummaryMarkdown();
      assert.ok(md.includes("## MCP Tool Metrics"));
      assert.ok(md.includes("| Tool |"));
      assert.ok(md.includes("list_projects"));
      assert.ok(md.includes("get_test_case"));
      assert.ok(md.includes("Total calls:** 2"));
    });

    it("should sort by call count descending", () => {
      metrics.record("rare_tool", 100, 100, false);
      metrics.record("popular_tool", 50, 50, false);
      metrics.record("popular_tool", 60, 60, false);
      metrics.record("popular_tool", 70, 70, false);

      const md = metrics.getSummaryMarkdown();
      const popularIdx = md.indexOf("popular_tool");
      const rareIdx = md.indexOf("rare_tool");
      assert.ok(popularIdx < rareIdx, "popular_tool should appear before rare_tool");
    });
  });

  describe("reset()", () => {
    it("should clear all stats", () => {
      metrics.record("tool_a", 100, 500, false);
      assert.equal(metrics.getStats().size, 1);
      metrics.reset();
      assert.equal(metrics.getStats().size, 0);
    });
  });
});

describe("wrapToolHandler()", () => {
  it("should record successful call metrics", async () => {
    const metrics = new ToolMetrics();
    const handler = async () => ({
      content: [{ type: "text" as const, text: "hello world" }],
    });

    const wrapped = wrapToolHandler("test_tool", handler, metrics);
    await wrapped({});

    const stats = metrics.getStats().get("test_tool")!;
    assert.equal(stats.callCount, 1);
    assert.equal(stats.totalResponseChars, 11);
    assert.equal(stats.errorCount, 0);
    assert.ok(stats.totalDurationMs >= 0);
  });

  it("should record isError from result", async () => {
    const metrics = new ToolMetrics();
    const handler = async () => ({
      content: [{ type: "text" as const, text: "error occurred" }],
      isError: true,
    });

    const wrapped = wrapToolHandler("error_tool", handler, metrics);
    await wrapped({});

    const stats = metrics.getStats().get("error_tool")!;
    assert.equal(stats.errorCount, 1);
  });

  it("should record metrics and rethrow on exception", async () => {
    const metrics = new ToolMetrics();
    const handler = async () => {
      throw new Error("boom");
    };

    const wrapped = wrapToolHandler("crash_tool", handler, metrics);

    await assert.rejects(() => wrapped({}), { message: "[crash_tool] boom" });

    const stats = metrics.getStats().get("crash_tool")!;
    assert.equal(stats.callCount, 1);
    assert.equal(stats.errorCount, 1);
  });

  it("should pass through arguments and return value", async () => {
    const metrics = new ToolMetrics();
    const handler = async (args: any) => ({
      content: [{ type: "text" as const, text: `Got: ${args.name}` }],
    });

    const wrapped = wrapToolHandler("pass_tool", handler, metrics);
    const result = await wrapped({ name: "test" });

    assert.equal(result.content[0].text, "Got: test");
  });

  it("should handle empty content array", async () => {
    const metrics = new ToolMetrics();
    const handler = async () => ({ content: [] });

    const wrapped = wrapToolHandler("empty_tool", handler, metrics);
    await wrapped({});

    const stats = metrics.getStats().get("empty_tool")!;
    assert.equal(stats.totalResponseChars, 0);
  });
});
