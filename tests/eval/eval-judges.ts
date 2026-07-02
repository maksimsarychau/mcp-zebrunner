import { argKeyPresent, normalizeArgKey } from "./eval-arg-aliases.js";
import type { EvalConfig } from "./eval-config.js";
import type { EvalPrompt } from "./eval-prompts.js";
import type { TokenUsage } from "./eval-report.js";
import {
  type EvalLlmClient,
  type EvalLlmResponse,
  checkRefusalFromResponse,
  firstToolCall,
  getJudgeTools,
} from "./eval-llm-client.js";

export interface JudgeScore {
  relevance: number;
  completeness: number;
  format: number;
  reasoning: string;
}

export interface JudgeResult {
  score: JudgeScore;
  tokenUsage?: TokenUsage;
}

/**
 * Use the configured LLM as a judge to score tool output quality.
 */
export async function judgeToolOutput(
  client: EvalLlmClient,
  config: EvalConfig,
  prompt: EvalPrompt,
  populatedPrompt: string,
  toolOutput: string,
): Promise<JudgeResult> {
  const expectedPatterns = prompt.expectedOutputPatterns?.length
    ? `\nExpected output patterns: ${prompt.expectedOutputPatterns.join(", ")}`
    : "";

  const response = await client.chatWithTools({
    model: config.judgeModel,
    maxTokens: 512,
    temperature: 0,
    tools: getJudgeTools(config),
    toolChoice: { name: "score_output" },
    userMessage:
      `You are an evaluation judge for a QA automation tool. Score the tool output on a 1-5 scale.\n\n` +
      `User prompt: "${populatedPrompt}"\n` +
      `Tool: ${prompt.expectedTools.join(", ")}${expectedPatterns}\n\n` +
      `Tool output (first 3000 chars):\n${toolOutput.slice(0, 3000)}`,
  });

  const tokenUsage: TokenUsage = {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
  };

  const toolUse = firstToolCall(response);
  if (!toolUse) {
    return {
      score: { relevance: 1, completeness: 1, format: 1, reasoning: "Judge failed to produce scores" },
      tokenUsage,
    };
  }

  const input = toolUse.input;
  return {
    score: {
      relevance: clampScore(input.relevance),
      completeness: clampScore(input.completeness),
      format: clampScore(input.format),
      reasoning: String(input.reasoning || ""),
    },
    tokenUsage,
  };
}

function clampScore(val: unknown): number {
  const n = Number(val);
  if (isNaN(n)) return 1;
  return Math.max(1, Math.min(5, Math.round(n)));
}

/** Canonical v9 tool name (`adv_*`). Accepts legacy names for alias-enabled servers. */
export function canonicalToolName(name: string): string {
  return name.startsWith("adv_") ? name : `adv_${name}`;
}

export function checkToolSelection(
  selectedTool: string | undefined,
  expectedTools: string[],
): boolean {
  if (!selectedTool || expectedTools.length === 0) return false;
  const selected = canonicalToolName(selectedTool);
  return expectedTools.some((e) => canonicalToolName(e) === selected);
}

export function checkArgKeys(
  args: Record<string, unknown>,
  expectedKeys: string[],
): { pass: boolean; missing: string[] } {
  const normalizedArgs = normalizeArgKeys(args);
  const missing: string[] = [];

  for (const key of expectedKeys) {
    if (!argKeyPresent(normalizedArgs, key)) {
      missing.push(key);
    }
  }

  return { pass: missing.length === 0, missing };
}

export function checkOutputPatterns(
  output: string,
  patterns: string[],
): { pass: boolean; failedPatterns: string[] } {
  const failed: string[] = [];
  for (const pat of patterns) {
    if (!new RegExp(pat, "i").test(output)) {
      failed.push(pat);
    }
  }
  return { pass: failed.length === 0, failedPatterns: failed };
}

/** @deprecated Use checkRefusalFromResponse on EvalLlmResponse */
export function checkRefusal(
  response: { content: Array<{ type: string; name?: string; [key: string]: unknown }> },
): { refused: boolean; selectedTool?: string } {
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    return { refused: true };
  }
  return { refused: false, selectedTool: toolUse.name as string | undefined };
}

export function checkRefusalResponse(response: EvalLlmResponse): { refused: boolean; selectedTool?: string } {
  return checkRefusalFromResponse(response);
}

export function checkForbiddenToolNotUsed(
  selectedTool: string | undefined,
  forbiddenTools: string[],
): { pass: boolean; violatedTool?: string } {
  if (!selectedTool) return { pass: true };
  const selected = canonicalToolName(selectedTool);
  const forbidden = forbiddenTools.some((t) => canonicalToolName(t) === selected);
  if (forbidden) {
    return { pass: false, violatedTool: selectedTool };
  }
  return { pass: true };
}

export function checkErrorOutput(mcpOutput: string): {
  hasError: boolean;
  details: string;
} {
  const errorIndicators = [
    /error/i,
    /not found/i,
    /does not exist/i,
    /no .* found/i,
    /invalid/i,
    /unauthorized/i,
    /forbidden/i,
    /failed/i,
    /unable to/i,
    /could not/i,
    /404/,
    /400/,
    /NO_CONTENT/,
    /ERROR:/,
  ];

  for (const pattern of errorIndicators) {
    if (pattern.test(mcpOutput)) {
      const match = mcpOutput.match(pattern);
      return { hasError: true, details: `Matched: ${match?.[0]}` };
    }
  }

  return { hasError: false, details: "No error indicators found in output" };
}

function normalizeArgKeys(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    result[normalizeArgKey(k)] = v;
  }
  return result;
}
