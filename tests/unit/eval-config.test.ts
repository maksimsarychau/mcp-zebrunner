import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";

describe("eval-config", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "EVAL_PROVIDER",
      "EVAL_MODEL",
      "EVAL_BASE_URL",
      "EVAL_API_KEY",
      "EVAL_MIN_PASS_RATE",
      "EVAL_MIN_JUDGE_SCORE",
      "EVAL_STRICT",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
    ]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("hasEvalLlmConfig is true for EVAL_PROVIDER=local (no cloud keys)", async () => {
    process.env.EVAL_PROVIDER = "local";
    process.env.EVAL_MODEL = "qwen3.5:2b";

    const { hasEvalLlmConfig, resolveEvalProvider, getEvalConfig } = await import("../eval/eval-config.js");
    assert.equal(resolveEvalProvider(), "local");
    assert.equal(hasEvalLlmConfig(), true);

    const config = getEvalConfig();
    assert.equal(config.provider, "local");
    assert.equal(config.baseUrl, "http://localhost:11434/v1");
    assert.equal(config.relaxedMode, true);
  });

  it("auto-detects local from localhost EVAL_BASE_URL", async () => {
    process.env.EVAL_BASE_URL = "http://127.0.0.1:11434/v1";
    process.env.EVAL_MODEL = "llama3.1";

    const { resolveEvalProvider } = await import("../eval/eval-config.js");
    assert.equal(resolveEvalProvider(), "local");
  });

  it("legacy openai + localhost EVAL_BASE_URL still treated as local endpoint", async () => {
    process.env.EVAL_PROVIDER = "openai";
    process.env.EVAL_BASE_URL = "http://localhost:11434/v1";
    process.env.EVAL_MODEL = "qwen3.5:2b";

    const { getEvalConfig, isLocalEvalEndpoint } = await import("../eval/eval-config.js");
    const config = getEvalConfig();
    assert.equal(config.provider, "openai");
    assert.equal(isLocalEvalEndpoint(config), true);
    assert.equal(config.relaxedMode, true);
  });

  it("auto-detects anthropic from ANTHROPIC_API_KEY", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const { hasEvalLlmConfig, resolveEvalProvider, getEvalConfig } = await import("../eval/eval-config.js");
    assert.equal(resolveEvalProvider(), "anthropic");
    assert.equal(hasEvalLlmConfig(), true);

    const config = getEvalConfig();
    assert.equal(config.provider, "anthropic");
    assert.equal(config.apiKey, "sk-ant-test");
  });

  it("hasEvalLlmConfig is false when no provider signals", async () => {
    const { hasEvalLlmConfig } = await import("../eval/eval-config.js");
    assert.equal(hasEvalLlmConfig(), false);
  });

  it("isLocalEvalEndpoint detects localhost base URL", async () => {
    process.env.EVAL_PROVIDER = "openai";
    process.env.EVAL_BASE_URL = "http://127.0.0.1:11434/v1";
    process.env.EVAL_MODEL = "llama3.1";

    const { getEvalConfig, isLocalEvalEndpoint } = await import("../eval/eval-config.js");
    const config = getEvalConfig();
    assert.equal(isLocalEvalEndpoint(config), true);
  });

  it("uses 80% tool-selection threshold for local Ollama by default", async () => {
    process.env.EVAL_PROVIDER = "openai";
    process.env.EVAL_BASE_URL = "http://localhost:11434/v1";
    process.env.EVAL_MODEL = "qwen3.5:2b";

    const { getEvalConfig } = await import("../eval/eval-config.js");
    const config = getEvalConfig();
    assert.equal(config.thresholds.toolSelectionAccuracy, 0.8);
  });

  it("EVAL_MIN_PASS_RATE overrides local and cloud defaults", async () => {
    process.env.EVAL_PROVIDER = "openai";
    process.env.EVAL_BASE_URL = "http://localhost:11434/v1";
    process.env.EVAL_MIN_PASS_RATE = "75";

    const { getEvalConfig, parsePassRate } = await import("../eval/eval-config.js");
    assert.equal(parsePassRate("75"), 0.75);
    assert.equal(parsePassRate("0.75"), 0.75);
    assert.equal(getEvalConfig().thresholds.toolSelectionAccuracy, 0.75);
  });

  it("cloud anthropic keeps 90% threshold when EVAL_MIN_PASS_RATE unset", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";

    const { getEvalConfig } = await import("../eval/eval-config.js");
    const config = getEvalConfig();
    assert.equal(config.thresholds.toolSelectionAccuracy, 0.9);
    assert.equal(config.relaxedMode, false);
  });

  it("local Ollama enables relaxed mode and lower judge threshold by default", async () => {
    process.env.EVAL_PROVIDER = "local";

    const { getEvalConfig } = await import("../eval/eval-config.js");
    const config = getEvalConfig();
    assert.equal(config.relaxedMode, true);
    assert.equal(config.thresholds.judgeAvgScore, 1.0);
  });

  it("EVAL_STRICT=true disables relaxed mode on local provider", async () => {
    process.env.EVAL_PROVIDER = "local";
    process.env.EVAL_STRICT = "true";

    const { getEvalConfig } = await import("../eval/eval-config.js");
    assert.equal(getEvalConfig().relaxedMode, false);
  });
});
