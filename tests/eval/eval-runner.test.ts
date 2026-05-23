import "dotenv/config";
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";

import {
  getEvalConfig,
  hasEvalLlmConfig,
  isLocalEvalEndpoint,
  type EvalConfig,
} from "./eval-config.js";
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
} from "./eval-mcp-client.js";
import { formatToolsForProvider } from "./eval-tool-format.js";
import {
  createEvalLlmClient,
  firstToolCall,
  type EvalLlmClient,
  type EvalLlmResponse,
} from "./eval-llm-client.js";
import {
  checkToolSelection,
  checkArgKeys,
  checkOutputPatterns,
  judgeToolOutput,
  checkRefusalResponse,
  checkForbiddenToolNotUsed,
  checkErrorOutput,
} from "./eval-judges.js";
import { EvalReporter, type EvalResult } from "./eval-report.js";
import { evalSafeStderr, redactSecretsInString } from "./eval-secrets.js";

// ── Preflight ──

if (!hasEvalLlmConfig()) {
  console.log("⚠️  Eval tests skipped — no LLM provider configured.");
  console.log("   Local Ollama: EVAL_PROVIDER=local EVAL_MODEL=qwen3.5:2b");
  console.log("   Claude:       ANTHROPIC_API_KEY=... (or EVAL_PROVIDER=anthropic)");
  console.log("   OpenAI:       OPENAI_API_KEY=... (or EVAL_PROVIDER=openai)");
  console.log("   Gemini:       GEMINI_API_KEY=... (or EVAL_PROVIDER=gemini)");
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
  let llm: EvalLlmClient;
  let ctx: EvalDiscoveryContext;
  let llmTools: unknown[];
  let reporter: EvalReporter;

  /** Per-prompt hard assert in cloud/strict mode; soft log when relaxed (local Ollama default). */
  function evalAssert(ok: boolean, message: string): void {
    if (config.relaxedMode) {
      if (!ok) evalSafeStderr(`⚠️  [eval soft] ${message}`);
      return;
    }
    assert.ok(ok, redactSecretsInString(message));
  }

  before(async () => {
    config = getEvalConfig();
    llm = createEvalLlmClient(config);
    reporter = new EvalReporter();

    const providerLabel = config.baseUrl
      ? `${config.provider} @ ${config.baseUrl}`
      : config.provider;
    console.error(`\n🧪 LLM Eval — Layer ${config.layer} — Provider: ${providerLabel} — Model: ${config.model}`);
    console.error(
      `📊 Tool selection threshold: ${(config.thresholds.toolSelectionAccuracy * 100).toFixed(0)}%` +
        (process.env.EVAL_MIN_PASS_RATE
          ? " (EVAL_MIN_PASS_RATE)"
          : isLocalEvalEndpoint(config)
            ? " (local Ollama default)"
            : ""),
    );
    if (config.relaxedMode) {
      console.error(
        "🔓 Relaxed mode — per-prompt failures are warnings; suite exits on aggregate thresholds only " +
          "(set EVAL_STRICT=true for per-prompt asserts)",
      );
    }
    if (EVAL_FILTER_PATTERNS.length > 0) {
      console.error(`🔍 Filter: ${EVAL_FILTER_PATTERNS.join(", ")}`);
    }
    console.error("");

    // Discover real data from Zebrunner
    ctx = await discoverEvalContext(config.layer);

    // Start the real MCP server and get tool schemas via tools/list
    await startMCPServer();
    const mcpSchemas = await getMCPToolSchemas();
    llmTools = formatToolsForProvider(config.provider, mcpSchemas);
    console.error(`[eval] Loaded ${llmTools.length} tools for ${config.provider}\n`);
  });

  after(() => {
    stopMCPServer();
    if (reporter) {
      const summary = reporter.report(config);

      const executed = summary.executed;
      if (executed > 0) {
        const tsOk = summary.toolSelectionAccuracy >= config.thresholds.toolSelectionAccuracy;
        const argOk =
          summary.argCorrectnessAccuracy >= config.thresholds.argCorrectness;
        const judgeOk =
          summary.judgeAvgScore === 0 ||
          summary.judgeAvgScore >= config.thresholds.judgeAvgScore;

        if (!tsOk) {
          console.error(
            `⚠️  Tool selection accuracy ${(summary.toolSelectionAccuracy * 100).toFixed(1)}% ` +
              `below threshold ${(config.thresholds.toolSelectionAccuracy * 100).toFixed(1)}%`,
          );
        }
        if (!argOk) {
          console.error(
            `⚠️  Argument correctness ${(summary.argCorrectnessAccuracy * 100).toFixed(1)}% ` +
              `below threshold ${(config.thresholds.argCorrectness * 100).toFixed(1)}%`,
          );
        }
        if (!judgeOk && summary.judgeAvgScore > 0) {
          console.error(
            `⚠️  Judge average ${summary.judgeAvgScore.toFixed(2)}/5 ` +
              `below threshold ${config.thresholds.judgeAvgScore}/5`,
          );
        }

        if (config.relaxedMode) {
          assert.ok(tsOk, "Aggregate tool selection below threshold");
          assert.ok(argOk, "Aggregate argument correctness below threshold");
          if (summary.judgeAvgScore > 0) {
            assert.ok(judgeOk, "Aggregate judge score below threshold");
          }
          console.error(
            `\n✅ Relaxed eval passed — ${summary.failures.length} soft miss(es) logged; ` +
              `aggregates: tool ${(summary.toolSelectionAccuracy * 100).toFixed(1)}%, ` +
              `args ${(summary.argCorrectnessAccuracy * 100).toFixed(1)}%`,
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
        evalAssert(
          result.toolSelectionCorrect,
          `Expected ${ep.expectedTools.join("|")}, got ${result.selectedTool || "none"}`,
        );
        if (ep.expectedArgKeys) {
          evalAssert(
            result.argsCorrect ?? false,
            `Missing args: ${result.missingArgs?.join(", ")}`,
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
        evalAssert(
          result.toolSelectionCorrect,
          `Wrong tool: expected ${ep.expectedTools.join("|")}, got ${result.selectedTool}`,
        );
        if (result.judgeScore) {
          const avg =
            (result.judgeScore.relevance +
              result.judgeScore.completeness +
              result.judgeScore.format) / 3;
          evalAssert(
            avg >= config.thresholds.judgeAvgScore,
            `Judge avg ${avg.toFixed(1)} below threshold ${config.thresholds.judgeAvgScore}`,
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
        evalAssert(
          result.toolSelectionCorrect,
          `Expected one of ${ep.expectedTools.join("|")}, LLM picked ${result.selectedTool}`,
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

  async function callEvalLlm(userMessage: string): Promise<EvalLlmResponse> {
    return llm.chatWithTools({
      model: config.model,
      system: SYSTEM_PROMPT,
      userMessage,
      tools: llmTools,
      toolChoice: "auto",
      maxTokens: config.maxTokens,
      temperature: config.temperature,
    });
  }

  function extractToolSelection(response: EvalLlmResponse): {
    selectedTool: string | undefined;
    args: Record<string, unknown>;
    tokenUsage: { inputTokens: number; outputTokens: number };
  } {
    const call = firstToolCall(response);
    return {
      selectedTool: call?.name,
      args: call?.input ?? {},
      tokenUsage: response.usage,
    };
  }

  async function runRefusalTest(ep: EvalPrompt): Promise<EvalResult> {
    const populated = ep.requiredContext
      ? populatePrompt(ep.promptTemplate, ctx)
      : ep.promptTemplate;
    const start = Date.now();

    try {
      const response = await callEvalLlm(populated);
      const refusal = checkRefusalResponse(response);

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
        tokenUsage: response.usage,
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
        error: redactSecretsInString(err.message || String(err)),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
        negativeReason: `Error: ${redactSecretsInString(err.message || String(err))}`,
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
      const response = await callEvalLlm(populated);
      const { selectedTool, tokenUsage } = extractToolSelection(response);

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
        tokenUsage,
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
        error: redactSecretsInString(err.message || String(err)),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
        negativeReason: `Error: ${redactSecretsInString(err.message || String(err))}`,
      };
    }
  }

  async function runInvalidDataTest(ep: EvalPrompt): Promise<EvalResult> {
    const populated = ep.promptTemplate;
    const start = Date.now();

    try {
      const response = await callEvalLlm(populated);
      const { selectedTool, args, tokenUsage } = extractToolSelection(response);

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
        tokenUsage,
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
        error: redactSecretsInString(err.message || String(err)),
        durationMs: Date.now() - start,
        isNegative: true,
        negativeCategory: ep.negativeCategory,
        negativePass: false,
        negativeReason: `Error: ${redactSecretsInString(err.message || String(err))}`,
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
      const response = await callEvalLlm(populated);
      const { selectedTool, args, tokenUsage } = extractToolSelection(response);

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
        tokenUsage,
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
      const response = await callEvalLlm(populated);
      tokenUsage = response.usage;

      const extracted = extractToolSelection(response);
      selectedTool = extracted.selectedTool;
      args = extracted.args;
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

        const judgeResult = await judgeToolOutput(llm, config, ep, populated, mcpOutput);
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
        error: redactSecretsInString(err.message || String(err)),
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
      const response = await callEvalLlm(populated);
      const { selectedTool, args, tokenUsage } = extractToolSelection(response);

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
        tokenUsage,
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
    const raw = err?.message || String(err);
    return {
      id: ep.id,
      category: ep.category,
      layer: ep.layer,
      prompt,
      expectedTools: ep.expectedTools,
      selectedTool: undefined,
      toolSelectionCorrect: false,
      error: redactSecretsInString(raw),
      durationMs,
    };
  }
});
