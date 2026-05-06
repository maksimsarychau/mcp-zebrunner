import "dotenv/config";
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

import { getEvalConfig, getAnthropicClient, type EvalConfig } from "./eval-config.js";
import { discoverEvalContext, type EvalDiscoveryContext } from "./eval-discovery.js";
import {
  EVAL_PROMPTS,
  populatePrompt,
  getAvailablePrompts,
  getNegativePrompts,
  type EvalPrompt,
} from "./eval-prompts.js";
import {
  startMCPServer,
  stopMCPServer,
  getMCPToolSchemas,
  callMCPTool,
  toAnthropicTools,
} from "./eval-mcp-client.js";
import {
  checkToolSelection,
  checkArgKeys,
  checkOutputPatterns,
  judgeToolOutput,
  checkRefusal,
  checkForbiddenToolNotUsed,
  checkErrorOutput,
} from "./eval-judges.js";
import { EvalReporter, type EvalResult } from "./eval-report.js";
import type Anthropic from "@anthropic-ai/sdk";

// ── Preflight ──

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("⚠️  Eval tests skipped — ANTHROPIC_API_KEY not set in .env");
  process.exit(0);
}

if (
  !process.env.ZEBRUNNER_URL ||
  !process.env.ZEBRUNNER_LOGIN ||
  !process.env.ZEBRUNNER_TOKEN
) {
  console.log("⚠️  Eval tests skipped — Zebrunner credentials not set in .env");
  process.exit(0);
}

const SYSTEM_PROMPT =
  "You are a QA automation assistant with access to Zebrunner MCP tools. " +
  "When the user asks a question, select the most appropriate tool and provide the required arguments. " +
  "Use exactly one tool per request unless the question clearly requires multiple tools.";

const EVAL_FILTER_PATTERNS = process.env.EVAL_FILTER
  ? process.env.EVAL_FILTER.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

function shouldRun(id: string): boolean {
  if (EVAL_FILTER_PATTERNS.length === 0) return true;
  return EVAL_FILTER_PATTERNS.some((f) => id === f || id.includes(f));
}

describe("LLM Evaluation Tests", () => {
  let config: EvalConfig;
  let client: Anthropic;
  let ctx: EvalDiscoveryContext;
  let anthropicTools: any[];
  let reporter: EvalReporter;

  before(async () => {
    config = getEvalConfig();
    client = getAnthropicClient(config);
    reporter = new EvalReporter();

    console.error(`\n🧪 LLM Eval — Layer ${config.layer} — Model: ${config.model}`);
    if (EVAL_FILTER_PATTERNS.length > 0) {
      console.error(`🔍 Filter: ${EVAL_FILTER_PATTERNS.join(", ")}`);
    }
    console.error("");

    // Discover real data from Zebrunner
    ctx = await discoverEvalContext(config.layer);

    // Start the real MCP server and get tool schemas via tools/list
    await startMCPServer();
    const mcpSchemas = await getMCPToolSchemas();
    anthropicTools = toAnthropicTools(mcpSchemas);
    console.error(`[eval] Loaded ${anthropicTools.length} tools for Claude\n`);
  });

  after(() => {
    stopMCPServer();
    if (reporter) {
      const summary = reporter.report(config);

      // Assert thresholds
      const executed = summary.executed;
      if (executed > 0) {
        const tsOk = summary.toolSelectionAccuracy >= config.thresholds.toolSelectionAccuracy;
        if (!tsOk) {
          console.error(
            `⚠️  Tool selection accuracy ${(summary.toolSelectionAccuracy * 100).toFixed(1)}% ` +
            `below threshold ${(config.thresholds.toolSelectionAccuracy * 100).toFixed(1)}%`
          );
        }
      }
    }
  });

  // ── Layers 1+2: Tool Selection + Argument Validation (single API call per prompt) ──

  describe("Layers 1+2: Tool Selection & Arguments", () => {
    const prompts = EVAL_PROMPTS.filter(
      (p) => p.layer <= 2 && !p.isMultiTool && !p.isNegative && shouldRun(p.id)
    );

    for (const ep of prompts) {
      it(`[${ep.id}] selects correct tool${ep.expectedArgKeys ? " with correct arguments" : ""}`, async () => {
        const result = await runArgValidation(ep);
        reporter.addResult(result);

        if (result.skipped) return;
        assert.ok(
          result.toolSelectionCorrect,
          `Expected ${ep.expectedTools.join("|")}, got ${result.selectedTool || "none"}`
        );
        if (ep.expectedArgKeys) {
          assert.ok(
            result.argsCorrect,
            `Missing args: ${result.missingArgs?.join(", ")}`
          );
        }
      });
    }
  });

  // ── Layer 3: Real Execution + Judge ──

  describe("Layer 3: Real Execution", () => {
    const layer3Prompts = EVAL_PROMPTS.filter(
      (p) => p.layer === 3 && !p.isMultiTool && !p.isNegative && shouldRun(p.id)
    );

    for (const ep of layer3Prompts) {
      it(`[${ep.id}] executes correctly and produces quality output`, async () => {
        if (config.layer < 3) {
          reporter.addSkipped(ep.id, ep.category, ep.layer, "Layer 3 not enabled");
          return;
        }

        const result = await runFullExecution(ep);
        reporter.addResult(result);

        if (result.skipped) return;
        assert.ok(
          result.toolSelectionCorrect,
          `Wrong tool: expected ${ep.expectedTools.join("|")}, got ${result.selectedTool}`
        );
        if (result.judgeScore) {
          const avg =
            (result.judgeScore.relevance +
              result.judgeScore.completeness +
              result.judgeScore.format) / 3;
          assert.ok(
            avg >= config.thresholds.judgeAvgScore,
            `Judge avg ${avg.toFixed(1)} below threshold ${config.thresholds.judgeAvgScore}`
          );
        }
      });
    }
  });

  // ── Layer 3: Multi-tool E2E Metrics ──

  describe("Layer 3: Multi-tool E2E", () => {
    const e2ePrompts = EVAL_PROMPTS.filter((p) => p.isMultiTool && !p.isNegative && shouldRun(p.id));

    for (const ep of e2ePrompts) {
      it(`[${ep.id}] chains tools correctly`, async () => {
        if (config.layer < 3) {
          reporter.addSkipped(ep.id, ep.category, ep.layer, "Layer 3 not enabled");
          return;
        }

        const result = await runMultiToolEval(ep);
        reporter.addResult(result);

        if (result.skipped) return;
        assert.ok(
          result.toolSelectionCorrect,
          `Expected one of ${ep.expectedTools.join("|")}, LLM picked ${result.selectedTool}`
        );
      });
    }
  });

  // ── Negative Tests ──

  describe("Negative: Refusal Tests", () => {
    const refusalPrompts = EVAL_PROMPTS.filter(
      (p) =>
        p.isNegative &&
        p.expectedBehavior === "should_refuse" &&
        p.layer <= 1 &&
        shouldRun(p.id)
    );

    for (const ep of refusalPrompts) {
      it(`[${ep.id}] LLM correctly refuses`, async () => {
        const result = await runRefusalTest(ep);
        reporter.addResult(result);
        assert.ok(result.negativePass, result.negativeReason || "LLM should have refused");
      });
    }
  });

  describe("Negative: Tool Confusion", () => {
    const confusionPrompts = EVAL_PROMPTS.filter(
      (p) => p.isNegative && p.negativeCategory === "tool_confusion" && shouldRun(p.id)
    );

    for (const ep of confusionPrompts) {
      it(`[${ep.id}] LLM picks correct tool, avoids forbidden`, async () => {
        const result = await runToolConfusionTest(ep);
        reporter.addResult(result);
        assert.ok(result.negativePass, result.negativeReason || "LLM used a forbidden tool");
      });
    }
  });

  describe("Negative: Invalid Data (L3)", () => {
    const invalidDataPrompts = EVAL_PROMPTS.filter(
      (p) => p.isNegative && p.negativeCategory === "invalid_data" && shouldRun(p.id)
    );

    for (const ep of invalidDataPrompts) {
      it(`[${ep.id}] MCP tool returns error for bad input`, async () => {
        if (config.layer < 3) {
          reporter.addSkipped(ep.id, ep.category, ep.layer, "Layer 3 not enabled");
          return;
        }

        const result = await runInvalidDataTest(ep);
        reporter.addResult(result);
        assert.ok(result.negativePass, result.negativeReason || "Expected error output from MCP");
      });
    }
  });

  // ── Helpers ──

  async function runRefusalTest(ep: EvalPrompt): Promise<EvalResult> {
    const populated = ep.requiredContext
      ? populatePrompt(ep.promptTemplate, ctx)
      : ep.promptTemplate;
    const start = Date.now();

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: populated }],
      });

      const refusal = checkRefusal(response);

      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: [],
        selectedTool: refusal.selectedTool,
        toolSelectionCorrect: refusal.refused,
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: refusal.refused,
        negativeReason: refusal.refused
          ? "Correctly refused (no tool called)"
          : `Should have refused but called ${refusal.selectedTool}`,
        tokenUsage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: [],
        selectedTool: undefined,
        toolSelectionCorrect: false,
        error: err.message || String(err),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
        negativeReason: `Error: ${err.message}`,
      };
    }
  }

  async function runToolConfusionTest(ep: EvalPrompt): Promise<EvalResult> {
    if (!isReady(ep)) {
      return {
        ...skipResult(ep, "Missing required context"),
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
      };
    }

    const populated = populatePrompt(ep.promptTemplate, ctx);
    const start = Date.now();

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: populated }],
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      const selectedTool = toolUse?.type === "tool_use" ? toolUse.name : undefined;

      const toolCorrect = checkToolSelection(selectedTool, ep.expectedTools);
      const forbiddenCheck = ep.forbiddenTools
        ? checkForbiddenToolNotUsed(selectedTool, ep.forbiddenTools)
        : { pass: true };

      const pass = toolCorrect && forbiddenCheck.pass;

      let reason: string;
      if (pass) {
        reason = `Correctly selected ${selectedTool}, avoided forbidden tools`;
      } else if (!toolCorrect) {
        reason = `Expected ${ep.expectedTools.join("|")}, got ${selectedTool || "none"}`;
      } else {
        reason = `Used forbidden tool: ${forbiddenCheck.violatedTool}`;
      }

      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool,
        toolSelectionCorrect: toolCorrect,
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: pass,
        negativeReason: reason,
        tokenUsage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool: undefined,
        toolSelectionCorrect: false,
        error: err.message || String(err),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
        negativeReason: `Error: ${err.message}`,
      };
    }
  }

  async function runInvalidDataTest(ep: EvalPrompt): Promise<EvalResult> {
    const populated = ep.promptTemplate;
    const start = Date.now();

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: populated }],
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      const selectedTool = toolUse?.type === "tool_use" ? toolUse.name : undefined;
      const args = (toolUse?.type === "tool_use" ? toolUse.input : {}) as Record<string, unknown>;

      let mcpOutput = "";
      let errorCheck = { hasError: false, details: "" };

      if (selectedTool) {
        mcpOutput = await callMCPTool(selectedTool, args);
        errorCheck = checkErrorOutput(mcpOutput);
      }

      const pass = selectedTool != null && errorCheck.hasError;

      let reason: string;
      if (!selectedTool) {
        reason = "LLM refused to call a tool (acceptable but not ideal)";
      } else if (errorCheck.hasError) {
        reason = `Tool returned error as expected: ${errorCheck.details}`;
      } else {
        reason = `Tool returned success instead of error. Output: ${mcpOutput.slice(0, 150)}`;
      }

      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool,
        selectedArgs: args,
        toolSelectionCorrect: selectedTool != null,
        mcpOutput: mcpOutput.slice(0, 5000),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: pass,
        negativeReason: reason,
        tokenUsage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool: undefined,
        toolSelectionCorrect: false,
        error: err.message || String(err),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
        negativeReason: `Error: ${err.message}`,
      };
    }
  }

  async function runArgValidation(ep: EvalPrompt): Promise<EvalResult> {
    if (!isReady(ep)) {
      return skipResult(ep, "Missing required context");
    }

    const populated = populatePrompt(ep.promptTemplate, ctx);
    const start = Date.now();

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: populated }],
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      const selectedTool = toolUse?.type === "tool_use" ? toolUse.name : undefined;
      const args = (toolUse?.type === "tool_use" ? toolUse.input : {}) as Record<string, unknown>;

      const argCheck = ep.expectedArgKeys
        ? checkArgKeys(args, ep.expectedArgKeys)
        : { pass: true, missing: [] as string[] };

      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool,
        toolSelectionCorrect: checkToolSelection(selectedTool, ep.expectedTools),
        argsCorrect: argCheck.pass,
        missingArgs: argCheck.missing,
        durationMs: Date.now() - start,
        tokenUsage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      return errorResult(ep, populated, err, Date.now() - start);
    }
  }

  async function runFullExecution(ep: EvalPrompt): Promise<EvalResult> {
    if (!isReady(ep)) {
      return skipResult(ep, "Missing required context");
    }

    const populated = populatePrompt(ep.promptTemplate, ctx);
    const start = Date.now();

    let selectedTool: string | undefined;
    let args: Record<string, unknown> = {};
    let tokenUsage = { inputTokens: 0, outputTokens: 0 };

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: populated }],
      });

      tokenUsage = {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };

      const toolUse = response.content.find((b) => b.type === "tool_use");
      selectedTool = toolUse?.type === "tool_use" ? toolUse.name : undefined;
      args = (toolUse?.type === "tool_use" ? toolUse.input : {}) as Record<string, unknown>;
    } catch (err: any) {
      return errorResult(ep, populated, err, Date.now() - start);
    }

    const toolCorrect = checkToolSelection(selectedTool, ep.expectedTools);

    const argCheck = ep.expectedArgKeys
      ? checkArgKeys(args, ep.expectedArgKeys)
      : { pass: true, missing: [] as string[] };

    let mcpOutput = "";
    let judgeScore;
    let judgeTokenUsage;
    let patternMatch;

    try {
      if (selectedTool) {
        mcpOutput = await callMCPTool(selectedTool, args);

        if (ep.expectedOutputPatterns?.length) {
          patternMatch = checkOutputPatterns(mcpOutput, ep.expectedOutputPatterns);
        }

        const judgeResult = await judgeToolOutput(client, config, ep, populated, mcpOutput);
        judgeScore = judgeResult.score;
        judgeTokenUsage = judgeResult.tokenUsage;
      }
    } catch (err: any) {
      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool,
        selectedArgs: args,
        toolSelectionCorrect: toolCorrect,
        argsCorrect: argCheck.pass,
        missingArgs: argCheck.missing,
        error: err.message || String(err),
        durationMs: Date.now() - start,
        tokenUsage,
      };
    }

    return {
      id: ep.id,
      category: ep.category,
      layer: ep.layer,
      prompt: populated,
      expectedTools: ep.expectedTools,
      selectedTool,
      selectedArgs: args,
      toolSelectionCorrect: toolCorrect,
      argsCorrect: argCheck.pass,
      missingArgs: argCheck.missing,
      outputPatternMatch: patternMatch?.pass,
      failedPatterns: patternMatch?.failedPatterns,
      judgeScore,
      mcpOutput: mcpOutput.slice(0, 5000),
      durationMs: Date.now() - start,
      tokenUsage,
      judgeTokenUsage,
    };
  }

  async function runMultiToolEval(ep: EvalPrompt): Promise<EvalResult> {
    if (!isReady(ep)) {
      return skipResult(ep, "Missing required context");
    }

    const populated = populatePrompt(ep.promptTemplate, ctx);
    const start = Date.now();

    try {
      const response = await client.messages.create({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: SYSTEM_PROMPT,
        tools: anthropicTools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: populated }],
      });

      const toolUse = response.content.find((b) => b.type === "tool_use");
      const selectedTool = toolUse?.type === "tool_use" ? toolUse.name : undefined;
      const args = (toolUse?.type === "tool_use" ? toolUse.input : {}) as Record<string, unknown>;

      const toolCorrect = checkToolSelection(selectedTool, ep.expectedTools);

      return {
        id: ep.id,
        category: ep.category,
        layer: ep.layer,
        prompt: populated,
        expectedTools: ep.expectedTools,
        selectedTool,
        selectedArgs: args,
        toolSelectionCorrect: toolCorrect,
        durationMs: Date.now() - start,
        tokenUsage: {
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
        },
      };
    } catch (err: any) {
      return errorResult(ep, populated, err, Date.now() - start);
    }
  }

  function isReady(ep: EvalPrompt): boolean {
    if (!ep.requiredContext) return true;
    return ep.requiredContext.every((field) => ctx[field] != null);
  }

  function skipResult(ep: EvalPrompt, reason: string): EvalResult {
    reporter.addSkipped(ep.id, ep.category, ep.layer, reason);
    return {
      id: ep.id,
      category: ep.category,
      layer: ep.layer,
      prompt: "",
      expectedTools: ep.expectedTools,
      selectedTool: undefined,
      toolSelectionCorrect: false,
      durationMs: 0,
      skipped: true,
      skipReason: reason,
    };
  }

  function errorResult(ep: EvalPrompt, prompt: string, err: any, durationMs: number): EvalResult {
    return {
      id: ep.id,
      category: ep.category,
      layer: ep.layer,
      prompt,
      expectedTools: ep.expectedTools,
      selectedTool: undefined,
      toolSelectionCorrect: false,
      error: err.message || String(err),
      durationMs,
    };
  }
});
