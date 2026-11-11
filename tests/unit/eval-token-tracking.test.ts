import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { estimateCost, type TokenUsage, type TokenSummary } from "../../tests/eval/eval-report.js";
import type { EvalConfig } from "../../tests/eval/eval-config.js";

describe("Eval Token Tracking", () => {
  describe("estimateCost()", () => {
    it("should calculate cost for claude-sonnet-5 (default anthropic eval model)", () => {
      const cost = estimateCost("claude-sonnet-5", 100_000, 10_000);
      assert.equal(cost.input, (100_000 / 1_000_000) * 2);
      assert.equal(cost.output, (10_000 / 1_000_000) * 10);
      assert.equal(cost.total, cost.input + cost.output);
    });

    it("should calculate cost for claude-sonnet-5-5 (current default anthropic eval model)", () => {
      const cost = estimateCost("claude-sonnet-5-5", 100_000, 10_000);
      assert.equal(cost.input, (100_000 / 1_000_000) * 2);
      assert.equal(cost.output, (10_000 / 1_000_000) * 10);
      assert.equal(cost.total, cost.input + cost.output);
    });

    it("claude-sonnet-5-5 resolves to its own pricing row, not the claude-sonnet-5 prefix row", async () => {
      // Pricing is looked up with `includes()` and the first hit wins; both rows are $2/$10 today, so
      // pin the ORDER (specific before prefix) in the source so a future price change cannot misroute.
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(new URL("../eval/eval-report.ts", import.meta.url), "utf8");
      assert.ok(
        src.indexOf('"claude-sonnet-5-5"') > -1 && src.indexOf('"claude-sonnet-5-5"') < src.indexOf('"claude-sonnet-5":'),
        "claude-sonnet-5-5 must be listed before claude-sonnet-5",
      );
    });

    it("should calculate cost for claude-sonnet-4-6", () => {
      const cost = estimateCost("claude-sonnet-4-6", 100_000, 10_000);
      assert.equal(cost.input, (100_000 / 1_000_000) * 3);
      assert.equal(cost.output, (10_000 / 1_000_000) * 15);
      assert.equal(cost.total, cost.input + cost.output);
    });

    it("should calculate cost for claude-haiku-3-5", () => {
      const cost = estimateCost("claude-haiku-3-5", 100_000, 10_000);
      assert.equal(cost.input, (100_000 / 1_000_000) * 0.80);
      assert.equal(cost.output, (10_000 / 1_000_000) * 4);
    });

    it("should calculate cost for claude-opus-4", () => {
      const cost = estimateCost("claude-opus-4", 100_000, 10_000);
      assert.equal(cost.input, (100_000 / 1_000_000) * 15);
      assert.equal(cost.output, (10_000 / 1_000_000) * 75);
    });

    it("should use default pricing for unknown models", () => {
      const cost = estimateCost("some-unknown-model", 1_000_000, 1_000_000);
      assert.equal(cost.input, 2);
      assert.equal(cost.output, 10);
      assert.equal(cost.total, 12);
    });

    it("should match model names with partial includes", () => {
      const cost = estimateCost("anthropic.claude-sonnet-4-5-v2:0", 1_000_000, 0);
      assert.equal(cost.input, 3);
    });

    it("should return zero for zero tokens", () => {
      const cost = estimateCost("claude-sonnet-5", 0, 0);
      assert.equal(cost.total, 0);
    });

    it("should return zero cost for local Ollama endpoint", () => {
      const config: EvalConfig = {
        provider: "openai",
        layer: 1,
        model: "llama3.1:8b",
        judgeModel: "llama3.1:8b",
        temperature: 0,
        maxTokens: 2048,
        thresholds: { toolSelectionAccuracy: 0.9, argCorrectness: 0.85, judgeAvgScore: 3 },
        relaxedMode: true,
        baseUrl: "http://localhost:11434/v1",
        resultsDir: "/tmp",
        concurrency: 3,
        filter: [],
        suite: "default",
      };
      const cost = estimateCost(config, 1_000_000, 1_000_000);
      assert.equal(cost.total, 0);
    });
  });

  describe("TokenUsage interface", () => {
    it("should have inputTokens and outputTokens fields", () => {
      const usage: TokenUsage = { inputTokens: 1500, outputTokens: 200 };
      assert.equal(usage.inputTokens, 1500);
      assert.equal(usage.outputTokens, 200);
    });
  });

  describe("TokenSummary interface", () => {
    it("should have all required fields", () => {
      const summary: TokenSummary = {
        totalInputTokens: 50000,
        totalOutputTokens: 5000,
        judgeInputTokens: 10000,
        judgeOutputTokens: 1000,
        estimatedCost: { input: 0.15, output: 0.075, total: 0.225 },
      };
      assert.equal(summary.totalInputTokens, 50000);
      assert.equal(summary.judgeInputTokens, 10000);
      assert.equal(summary.estimatedCost.total, 0.225);
    });
  });
});
