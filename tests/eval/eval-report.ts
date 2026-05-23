import { writeFileSync, mkdirSync, existsSync } from "fs";
import type { EvalConfig } from "./eval-config.js";
import { isLocalEvalEndpoint } from "./eval-config.js";
import type { PromptCategory, NegativeCategory } from "./eval-prompts.js";
import type { JudgeScore } from "./eval-judges.js";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TokenSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  judgeInputTokens: number;
  judgeOutputTokens: number;
  estimatedCost: { input: number; output: number; total: number };
}

export interface EvalResult {
  id: string;
  category: PromptCategory;
  layer: number;
  prompt: string;
  expectedTools: string[];
  selectedTool: string | undefined;
  selectedArgs?: Record<string, unknown>;
  toolSelectionCorrect: boolean;
  argsCorrect?: boolean;
  missingArgs?: string[];
  outputPatternMatch?: boolean;
  failedPatterns?: string[];
  judgeScore?: JudgeScore;
  mcpOutput?: string;
  error?: string;
  durationMs: number;
  skipped?: boolean;
  skipReason?: string;
  isNegative?: boolean;
  negativeCategory?: NegativeCategory;
  negativePass?: boolean;
  negativeReason?: string;
  tokenUsage?: TokenUsage;
  judgeTokenUsage?: TokenUsage;
}

export interface NegativeSummary {
  total: number;
  passed: number;
  accuracy: number;
  byCategory: Record<string, { total: number; passed: number; accuracy: number }>;
  failures: { id: string; reason: string }[];
}

export interface EvalSummary {
  timestamp: string;
  provider?: string;
  baseUrl?: string;
  model: string;
  layer: number;
  total: number;
  executed: number;
  skipped: number;
  toolSelectionAccuracy: number;
  argCorrectnessAccuracy: number;
  judgeAvgScore: number;
  byCategory: Record<string, { total: number; correct: number; accuracy: number }>;
  failures: { id: string; reason: string }[];
  negative?: NegativeSummary;
  durationMs: number;
  tokens?: TokenSummary;
}

const OPENAI_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

const GEMINI_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gemini-2.0-flash": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5.0 },
};

const ANTHROPIC_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "claude-sonnet-4-6":  { inputPer1M: 3,    outputPer1M: 15 },
  "claude-sonnet-4-5":  { inputPer1M: 3,    outputPer1M: 15 },
  "claude-haiku-3-5":   { inputPer1M: 0.80, outputPer1M: 4 },
  "claude-opus-4":      { inputPer1M: 15,   outputPer1M: 75 },
};
const DEFAULT_PRICING = { inputPer1M: 0, outputPer1M: 0 };

function lookupPricing(model: string, provider?: string): { inputPer1M: number; outputPer1M: number } {
  const tables = [
    ANTHROPIC_PRICING,
    OPENAI_PRICING,
    GEMINI_PRICING,
  ];

  for (const table of tables) {
    const match = Object.entries(table).find(([key]) => model.includes(key));
    if (match) return match[1];
  }

  if (provider === "anthropic") {
    return { inputPer1M: 3, outputPer1M: 15 };
  }

  return DEFAULT_PRICING;
}

const LEGACY_STRING_DEFAULT = { inputPer1M: 3, outputPer1M: 15 };

export function estimateCost(
  modelOrConfig: string | EvalConfig,
  inputTokens: number,
  outputTokens: number,
): { input: number; output: number; total: number } {
  if (typeof modelOrConfig !== "string") {
    if (isLocalEvalEndpoint(modelOrConfig)) {
      return { input: 0, output: 0, total: 0 };
    }
    const pricing = lookupPricing(modelOrConfig.model, modelOrConfig.provider);
    const input = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const output = (outputTokens / 1_000_000) * pricing.outputPer1M;
    return { input, output, total: input + output };
  }

  const model = modelOrConfig;
  const pricing = lookupPricing(model);
  const effective =
    pricing.inputPer1M === 0 && pricing.outputPer1M === 0
      ? LEGACY_STRING_DEFAULT
      : pricing;
  const input = (inputTokens / 1_000_000) * effective.inputPer1M;
  const output = (outputTokens / 1_000_000) * effective.outputPer1M;
  return { input, output, total: input + output };
}

export class EvalReporter {
  private results: EvalResult[] = [];
  private startTime = Date.now();

  addResult(result: EvalResult): void {
    this.results.push(result);
  }

  addSkipped(id: string, category: PromptCategory, layer: number, reason: string): void {
    this.results.push({
      id,
      category,
      layer,
      prompt: "",
      expectedTools: [],
      selectedTool: undefined,
      toolSelectionCorrect: false,
      durationMs: 0,
      skipped: true,
      skipReason: reason,
    });
  }

  summarize(config: EvalConfig): EvalSummary {
    const positiveResults = this.results.filter((r) => !r.isNegative);
    const negativeResults = this.results.filter((r) => r.isNegative);

    const executed = positiveResults.filter((r) => !r.skipped);
    const skipped = positiveResults.filter((r) => r.skipped);

    const toolCorrect = executed.filter((r) => r.toolSelectionCorrect).length;
    const argsChecked = executed.filter((r) => r.argsCorrect !== undefined);
    const argsCorrect = argsChecked.filter((r) => r.argsCorrect).length;

    const judged = executed.filter((r) => r.judgeScore);
    const judgeAvg =
      judged.length > 0
        ? judged.reduce(
            (acc, r) =>
              acc +
              (r.judgeScore!.relevance + r.judgeScore!.completeness + r.judgeScore!.format) / 3,
            0
          ) / judged.length
        : 0;

    const byCategory: EvalSummary["byCategory"] = {};
    for (const r of executed) {
      if (!byCategory[r.category]) {
        byCategory[r.category] = { total: 0, correct: 0, accuracy: 0 };
      }
      byCategory[r.category].total++;
      if (r.toolSelectionCorrect) byCategory[r.category].correct++;
    }
    for (const cat of Object.values(byCategory)) {
      cat.accuracy = cat.total > 0 ? cat.correct / cat.total : 0;
    }

    const failures = executed
      .filter((r) => isPromptMiss(r, config))
      .map((r) => ({ id: r.id, reason: promptMissReason(r, config) }));

    let negative: NegativeSummary | undefined;
    const negExecuted = negativeResults.filter((r) => !r.skipped);
    if (negExecuted.length > 0) {
      const negPassed = negExecuted.filter((r) => r.negativePass).length;
      const negByCategory: NegativeSummary["byCategory"] = {};
      for (const r of negExecuted) {
        const cat = r.negativeCategory || "unknown";
        if (!negByCategory[cat]) {
          negByCategory[cat] = { total: 0, passed: 0, accuracy: 0 };
        }
        negByCategory[cat].total++;
        if (r.negativePass) negByCategory[cat].passed++;
      }
      for (const cat of Object.values(negByCategory)) {
        cat.accuracy = cat.total > 0 ? cat.passed / cat.total : 0;
      }

      const negFailures = negExecuted
        .filter((r) => !r.negativePass)
        .map((r) => ({
          id: r.id,
          reason: r.negativeReason || "Negative test failed",
        }));

      negative = {
        total: negExecuted.length,
        passed: negPassed,
        accuracy: negExecuted.length > 0 ? negPassed / negExecuted.length : 0,
        byCategory: negByCategory,
        failures: negFailures,
      };
    }

    const allExecuted = [...executed, ...negExecuted];
    const totalInput = allExecuted.reduce((s, r) => s + (r.tokenUsage?.inputTokens ?? 0), 0);
    const totalOutput = allExecuted.reduce((s, r) => s + (r.tokenUsage?.outputTokens ?? 0), 0);
    const judgeInput = allExecuted.reduce((s, r) => s + (r.judgeTokenUsage?.inputTokens ?? 0), 0);
    const judgeOutput = allExecuted.reduce((s, r) => s + (r.judgeTokenUsage?.outputTokens ?? 0), 0);
    const grandInput = totalInput + judgeInput;
    const grandOutput = totalOutput + judgeOutput;

    const tokens: TokenSummary | undefined =
      grandInput > 0 || grandOutput > 0
        ? {
            totalInputTokens: grandInput,
            totalOutputTokens: grandOutput,
            judgeInputTokens: judgeInput,
            judgeOutputTokens: judgeOutput,
            estimatedCost: estimateCost(config, grandInput, grandOutput),
          }
        : undefined;

    return {
      timestamp: new Date().toISOString(),
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      layer: config.layer,
      total: this.results.length,
      executed: executed.length + negExecuted.length,
      skipped: skipped.length + negativeResults.filter((r) => r.skipped).length,
      toolSelectionAccuracy: executed.length > 0 ? toolCorrect / executed.length : 0,
      argCorrectnessAccuracy: argsChecked.length > 0 ? argsCorrect / argsChecked.length : 0,
      judgeAvgScore: Math.round(judgeAvg * 100) / 100,
      byCategory,
      failures,
      negative,
      durationMs: Date.now() - this.startTime,
      tokens,
    };
  }

  /**
   * Print a console scorecard and save JSON + markdown reports.
   */
  report(config: EvalConfig): EvalSummary {
    const summary = this.summarize(config);

    printScorecard(summary, config);

    if (!existsSync(config.resultsDir)) {
      mkdirSync(config.resultsDir, { recursive: true });
    }
    const ts = summary.timestamp.replace(/[:.]/g, "-").slice(0, 19);

    const jsonPath = `${config.resultsDir}/${ts}.json`;
    writeFileSync(jsonPath, JSON.stringify({ summary, results: this.results }, null, 2));
    console.error(`[eval-report] JSON saved: ${jsonPath}`);

    const mdPath = `${config.resultsDir}/${ts}.md`;
    writeFileSync(mdPath, generateMarkdown(summary, this.results, config));
    console.error(`[eval-report] Markdown saved: ${mdPath}`);

    return summary;
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function judgeAvg(r: EvalResult): number {
  if (!r.judgeScore) return 0;
  return (r.judgeScore.relevance + r.judgeScore.completeness + r.judgeScore.format) / 3;
}

function isPromptMiss(r: EvalResult, config: EvalConfig): boolean {
  if (r.error) return true;
  if (!r.toolSelectionCorrect) return true;
  if (r.argsCorrect === false) return true;
  if (r.judgeScore && judgeAvg(r) < config.thresholds.judgeAvgScore) return true;
  return false;
}

function promptMissReason(r: EvalResult, config: EvalConfig): string {
  if (r.error) return r.error;
  if (!r.toolSelectionCorrect) {
    return `Expected ${r.expectedTools.join("|")}, got ${r.selectedTool || "none"}`;
  }
  if (r.argsCorrect === false) {
    return `Missing args: ${r.missingArgs?.join(", ") || "unknown"}`;
  }
  if (r.judgeScore) {
    const avg = judgeAvg(r);
    if (avg < config.thresholds.judgeAvgScore) {
      return `Judge avg ${avg.toFixed(1)}/5 — ${r.judgeScore.reasoning.slice(0, 80)}`;
    }
  }
  return "Unknown";
}

function aggregatePass(s: EvalSummary, config: EvalConfig): boolean {
  if (s.executed === 0) return true;
  const tsOk = s.toolSelectionAccuracy >= config.thresholds.toolSelectionAccuracy;
  const argOk = s.argCorrectnessAccuracy >= config.thresholds.argCorrectness;
  const judgeOk = s.judgeAvgScore === 0 || s.judgeAvgScore >= config.thresholds.judgeAvgScore;
  return tsOk && argOk && judgeOk;
}

function printScorecard(s: EvalSummary, config: EvalConfig): void {
  const line = "═".repeat(52);
  const lines = [
    `╔${line}╗`,
    `║  LLM Eval Report — ${s.timestamp.slice(0, 10)} — ${(s.provider ?? "llm").slice(0, 8).padEnd(8)} ${s.model.slice(0, 12).padEnd(12)}  ║`,
    `╠${line}╣`,
    `║  Layer:                    ${String(s.layer).padEnd(24)}║`,
    `║  Tool Selection Accuracy:  ${formatAccuracy(s.toolSelectionAccuracy, s.executed, config.thresholds.toolSelectionAccuracy)}  ║`,
    `║  Argument Correctness:     ${formatAccuracy(s.argCorrectnessAccuracy, s.executed, config.thresholds.argCorrectness)}  ║`,
    `║  Judge Avg Score:          ${formatJudge(s.judgeAvgScore, config.thresholds.judgeAvgScore)}  ║`,
    `║  Executed / Skipped:       ${String(s.executed).padStart(3)} / ${String(s.skipped).padEnd(19)}║`,
    `╠${line}╣`,
  ];

  if (config.relaxedMode) {
    lines.push(`║  Mode: relaxed — per-prompt misses are diagnostic only${" ".repeat(4)}║`);
    lines.push(`╠${line}╣`);
  }

  lines.push(`║  By Category:${" ".repeat(38)}║`);

  for (const [cat, data] of Object.entries(s.byCategory)) {
    const catLine = `    ${cat.padEnd(14)} ${String(data.correct).padStart(2)}/${String(data.total).padStart(2)} (${pct(data.accuracy)})`;
    lines.push(`║  ${catLine.padEnd(50)}║`);
  }

  if (s.negative) {
    lines.push(`╠${line}╣`);
    const negIcon = s.negative.accuracy >= 0.9 ? "✅" : "⚠️";
    lines.push(`║  Negative Tests:         ${negIcon} ${pct(s.negative.accuracy).padEnd(7)} (n=${s.negative.total})`.padEnd(53) + `║`);
    for (const [cat, data] of Object.entries(s.negative.byCategory)) {
      const catLine = `    ${cat.padEnd(18)} ${String(data.passed).padStart(2)}/${String(data.total).padStart(2)} (${pct(data.accuracy)})`;
      lines.push(`║  ${catLine.padEnd(50)}║`);
    }
  }

  if (s.failures.length > 0) {
    lines.push(`╠${line}╣`);
    const missLabel = config.relaxedMode
      ? `Soft misses (${s.failures.length}) — not suite failures`
      : `Failures (${s.failures.length})`;
    lines.push(`║  ${missLabel.padEnd(50)}║`);
    const missIcon = config.relaxedMode ? "⚠" : "✗";
    for (const f of s.failures.slice(0, 10)) {
      const fLine = `    ${missIcon} ${f.id}: ${f.reason}`.slice(0, 50);
      lines.push(`║  ${fLine.padEnd(50)}║`);
    }
    if (s.failures.length > 10) {
      lines.push(`║  ${"    ... and " + (s.failures.length - 10) + " more".padEnd(46)}║`);
    }
  }

  if (s.negative?.failures.length) {
    lines.push(`╠${line}╣`);
    lines.push(`║  Negative Failures (${s.negative.failures.length}):${" ".repeat(28 - String(s.negative.failures.length).length)}║`);
    for (const f of s.negative.failures.slice(0, 10)) {
      const fLine = `    ✗ ${f.id}: ${f.reason}`.slice(0, 50);
      lines.push(`║  ${fLine.padEnd(50)}║`);
    }
  }

  if (s.tokens) {
    lines.push(`╠${line}╣`);
    lines.push(`║  Token Usage:${" ".repeat(38)}║`);
    const inK = (s.tokens.totalInputTokens / 1000).toFixed(1) + "k";
    const outK = (s.tokens.totalOutputTokens / 1000).toFixed(1) + "k";
    lines.push(`║    Input / Output:     ${inK.padStart(7)} / ${outK.padEnd(20)}║`);
    if (s.tokens.judgeInputTokens > 0) {
      const jInK = (s.tokens.judgeInputTokens / 1000).toFixed(1) + "k";
      const jOutK = (s.tokens.judgeOutputTokens / 1000).toFixed(1) + "k";
      lines.push(`║    (of which judge):   ${jInK.padStart(7)} / ${jOutK.padEnd(20)}║`);
    }
    const cost = `$${s.tokens.estimatedCost.total.toFixed(4)}`;
    lines.push(`║    Estimated cost:     ${cost.padEnd(28)}║`);
  }

  lines.push(`╠${line}╣`);
  const suiteOk = aggregatePass(s, config);
  const suiteLine = config.relaxedMode
    ? `Suite: ${suiteOk ? "✅ PASSED" : "❌ FAILED"} (relaxed / aggregate gate)`
    : `Suite: ${s.failures.length === 0 ? "✅ PASSED" : "❌ FAILED"} (strict)`;
  lines.push(`║  ${suiteLine.padEnd(50)}║`);
  lines.push(`║  Duration: ${(s.durationMs / 1000).toFixed(1)}s${" ".repeat(37 - String((s.durationMs / 1000).toFixed(1)).length)}║`);
  lines.push(`╚${line}╝`);

  console.error("\n" + lines.join("\n") + "\n");
}

function formatAccuracy(value: number, total: number, threshold: number): string {
  const icon = value >= threshold ? "✅" : "⚠️";
  return `${icon} ${pct(value).padEnd(7)} (n=${total})`.padEnd(22);
}

function formatJudge(value: number, threshold: number): string {
  if (value === 0) return "N/A (no Layer 3 runs)".padEnd(22);
  const icon = value >= threshold ? "✅" : "⚠️";
  return `${icon} ${value.toFixed(2)}/5.0`.padEnd(22);
}

function generateMarkdown(s: EvalSummary, results: EvalResult[], config: EvalConfig): string {
  const lines: string[] = [
    `# LLM Eval Report`,
    "",
    `- **Date:** ${s.timestamp}`,
    `- **Model:** ${s.model}`,
    `- **Layer:** ${s.layer}`,
    `- **Mode:** ${config.relaxedMode ? "relaxed (aggregate gate)" : "strict (per-prompt)"}`,
    `- **Duration:** ${(s.durationMs / 1000).toFixed(1)}s`,
    ...(s.tokens
      ? [
          `- **Tokens:** ${s.tokens.totalInputTokens.toLocaleString()} input + ${s.tokens.totalOutputTokens.toLocaleString()} output`,
          `- **Estimated cost:** $${s.tokens.estimatedCost.total.toFixed(4)}`,
        ]
      : []),
    "",
    `## Scores`,
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tool Selection Accuracy | ${pct(s.toolSelectionAccuracy)} (${s.executed} prompts) |`,
    `| Argument Correctness | ${pct(s.argCorrectnessAccuracy)} |`,
    `| Judge Avg Score | ${s.judgeAvgScore || "N/A"}/5.0 |`,
    "",
    `## By Category`,
    "",
    `| Category | Correct | Total | Accuracy |`,
    `|----------|---------|-------|----------|`,
  ];

  for (const [cat, data] of Object.entries(s.byCategory)) {
    lines.push(`| ${cat} | ${data.correct} | ${data.total} | ${pct(data.accuracy)} |`);
  }

  if (s.failures.length > 0) {
    const heading = config.relaxedMode
      ? "## Soft misses (diagnostic — suite may still pass)"
      : "## Failures";
    lines.push("", heading, "");
    for (const f of s.failures) {
      lines.push(`- **${f.id}**: ${f.reason}`);
    }
  }

  // Negative test results
  const negResults = results.filter((r) => r.isNegative && !r.skipped);
  if (negResults.length > 0) {
    lines.push("", "## Negative Tests", "");
    lines.push(`| ID | Category | Expected | Result | Details |`);
    lines.push(`|----|----------|----------|--------|---------|`);
    for (const r of negResults) {
      const verdict = r.negativePass ? "✅ PASS" : "❌ FAIL";
      const details = r.negativeReason || (r.negativePass ? "Correctly handled" : "Unexpected behavior");
      lines.push(`| ${r.id} | ${r.negativeCategory || ""} | ${r.expectedTools.length === 0 ? "refuse" : "error/select"} | ${verdict} | ${details.slice(0, 80)} |`);
    }

    const negFails = negResults.filter((r) => !r.negativePass);
    if (negFails.length > 0) {
      lines.push("", "### Negative Test Failures", "");
      for (const r of negFails) {
        lines.push(`- **${r.id}** (${r.negativeCategory}): ${r.negativeReason}`);
        if (r.selectedTool) lines.push(`  - Selected tool: \`${r.selectedTool}\``);
        if (r.mcpOutput) lines.push(`  - Output snippet: \`${r.mcpOutput.slice(0, 200)}\``);
      }
    }
  }

  // L3 Diagnostics — full trace for every Layer 3 result
  const l3Results = results.filter((r) => !r.skipped && r.layer === 3 && !r.isNegative);
  if (l3Results.length > 0) {
    lines.push("", "## Layer 3 Diagnostics", "");
    lines.push("Detailed trace for each Layer 3 execution to help distinguish prompt issues from MCP tool issues.", "");

    for (const r of l3Results) {
      const judgeAvg = r.judgeScore
        ? ((r.judgeScore.relevance + r.judgeScore.completeness + r.judgeScore.format) / 3).toFixed(1)
        : "N/A";
      const verdict = r.toolSelectionCorrect && (!r.judgeScore || parseFloat(judgeAvg) >= 3.5) ? "PASS" : "FAIL";

      lines.push(`### ${verdict === "FAIL" ? "❌" : "✅"} ${r.id} — ${verdict}`);
      lines.push("");
      lines.push(`- **Prompt:** ${r.prompt}`);
      lines.push(`- **Expected tools:** ${r.expectedTools.join(", ")}`);
      lines.push(`- **Selected tool:** ${r.selectedTool || "none"} ${r.toolSelectionCorrect ? "✅" : "❌"}`);

      if (r.selectedArgs && Object.keys(r.selectedArgs).length > 0) {
        lines.push(`- **Args:** \`${JSON.stringify(r.selectedArgs)}\``);
      }

      if (r.judgeScore) {
        lines.push(`- **Judge scores:** relevance=${r.judgeScore.relevance}/5, completeness=${r.judgeScore.completeness}/5, format=${r.judgeScore.format}/5 (avg=${judgeAvg})`);
        lines.push(`- **Judge reasoning:** ${r.judgeScore.reasoning}`);
      }

      if (r.mcpOutput) {
        const truncated = r.mcpOutput.length > 1500
          ? r.mcpOutput.slice(0, 1500) + "\n... (truncated)"
          : r.mcpOutput;
        lines.push("", "<details>", `<summary>MCP Output (${r.mcpOutput.length} chars)</summary>`, "", "```", truncated, "```", "", "</details>");
      }

      if (r.error) {
        lines.push(`- **Error:** ${r.error}`);
      }

      lines.push(`- **Duration:** ${(r.durationMs / 1000).toFixed(1)}s`);
      lines.push("");
    }
  }

  if (s.tokens) {
    lines.push("", "## Token Usage", "");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total input tokens | ${s.tokens.totalInputTokens.toLocaleString()} |`);
    lines.push(`| Total output tokens | ${s.tokens.totalOutputTokens.toLocaleString()} |`);
    if (s.tokens.judgeInputTokens > 0) {
      lines.push(`| Judge input tokens | ${s.tokens.judgeInputTokens.toLocaleString()} |`);
      lines.push(`| Judge output tokens | ${s.tokens.judgeOutputTokens.toLocaleString()} |`);
    }
    lines.push(`| Estimated cost (input) | $${s.tokens.estimatedCost.input.toFixed(4)} |`);
    lines.push(`| Estimated cost (output) | $${s.tokens.estimatedCost.output.toFixed(4)} |`);
    lines.push(`| **Estimated total cost** | **$${s.tokens.estimatedCost.total.toFixed(4)}** |`);

    const withTokens = results.filter((r) => !r.skipped && r.tokenUsage);
    if (withTokens.length > 0) {
      lines.push("", "### Per-Prompt Token Breakdown", "");
      lines.push(`| ID | Input | Output | Judge In | Judge Out |`);
      lines.push(`|----|-------|--------|----------|-----------|`);
      for (const r of withTokens) {
        const jIn = r.judgeTokenUsage?.inputTokens ?? 0;
        const jOut = r.judgeTokenUsage?.outputTokens ?? 0;
        lines.push(
          `| ${r.id} | ${r.tokenUsage!.inputTokens.toLocaleString()} | ${r.tokenUsage!.outputTokens.toLocaleString()} | ${jIn ? jIn.toLocaleString() : "-"} | ${jOut ? jOut.toLocaleString() : "-"} |`
        );
      }
    }
  }

  const skippedResults = results.filter((r) => r.skipped);
  if (skippedResults.length > 0) {
    lines.push("", "## Skipped", "");
    for (const r of skippedResults) {
      lines.push(`- **${r.id}**: ${r.skipReason}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
