import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { estimateCost, type TokenUsage, type TokenSummary } from "../../tests/eval/eval-report.js";

describe("Eval Token Tracking", () => {
  describe("estimateCost()", () => {
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
      assert.equal(cost.input, 3);
      assert.equal(cost.output, 15);
      assert.equal(cost.total, 18);
    });

    it("should match model names with partial includes", () => {
      const cost = estimateCost("anthropic.claude-sonnet-4-5-v2:0", 1_000_000, 0);
      assert.equal(cost.input, 3);
    });

    it("should return zero for zero tokens", () => {
      const cost = estimateCost("claude-sonnet-4-6", 0, 0);
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
