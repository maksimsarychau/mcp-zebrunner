import Anthropic from "@anthropic-ai/sdk";
import type { EvalConfig } from "./eval-config.js";
import type { EvalPrompt } from "./eval-prompts.js";
import type { TokenUsage } from "./eval-report.js";

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

const JUDGE_TOOL = {
  name: "score_output",
  description: "Score the quality of the MCP tool output",
  input_schema: {
    type: "object" as const,
    properties: {
      relevance: {
        type: "number",
        description: "1-5: Does the output answer the user's question?",
      },
      completeness: {
        type: "number",
        description: "1-5: Are all expected data points present?",
      },
      format: {
        type: "number",
        description: "1-5: Is the output well-structured and readable?",
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of the scores",
      },
    },
    required: ["relevance", "completeness", "format", "reasoning"],
  },
};

/**
 * Use Claude as a judge to score tool output quality.
 * Returns both the score and the token usage from the judge LLM call.
 */
export async function judgeToolOutput(
  client: Anthropic,
  config: EvalConfig,
  prompt: EvalPrompt,
  populatedPrompt: string,
  toolOutput: string
): Promise<JudgeResult> {
  const expectedPatterns = prompt.expectedOutputPatterns?.length
    ? `\nExpected output patterns: ${prompt.expectedOutputPatterns.join(", ")}`
    : "";

  const response = await client.messages.create({
    model: config.judgeModel,
    max_tokens: 512,
    temperature: 0,
    tools: [JUDGE_TOOL],
    tool_choice: { type: "tool" as const, name: "score_output" },
    messages: [
      {
        role: "user",
        content:
          `You are an evaluation judge for a QA automation tool. Score the tool output on a 1-5 scale.\n\n` +
          `User prompt: "${populatedPrompt}"\n` +
          `Tool: ${prompt.expectedTools.join(", ")}${expectedPatterns}\n\n` +
          `Tool output (first 3000 chars):\n${toolOutput.slice(0, 3000)}`,
      },
    ],
  });

  const tokenUsage: TokenUsage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return {
      score: { relevance: 1, completeness: 1, format: 1, reasoning: "Judge failed to produce scores" },
      tokenUsage,
    };
  }

  const input = toolUse.input as Record<string, unknown>;
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

/**
 * Check if a tool name is in the expected list.
 */
export function checkToolSelection(
  selectedTool: string | undefined,
  expectedTools: string[]
): boolean {
  if (!selectedTool) return false;
  return expectedTools.includes(selectedTool);
}

/**
 * Check if the tool arguments contain the expected keys.
 * Uses case-insensitive matching and common aliases (project_key/projectKey).
 */
export function checkArgKeys(
  args: Record<string, unknown>,
  expectedKeys: string[]
): { pass: boolean; missing: string[] } {
  const normalizedArgs = normalizeArgKeys(args);
  const missing: string[] = [];

  for (const key of expectedKeys) {
    const normalized = normalizeKey(key);
    if (!(normalized in normalizedArgs)) {
      missing.push(key);
    }
  }

  return { pass: missing.length === 0, missing };
}

/**
 * Check if output text matches expected patterns (regex).
 */
export function checkOutputPatterns(
  output: string,
  patterns: string[]
): { pass: boolean; failedPatterns: string[] } {
  const failed: string[] = [];
  for (const pat of patterns) {
    if (!new RegExp(pat, "i").test(output)) {
      failed.push(pat);
    }
  }
  return { pass: failed.length === 0, failedPatterns: failed };
}

/**
 * Check that the LLM did NOT select any tool (expected for out-of-scope, ambiguous, prompt injection).
 * Returns true if the LLM correctly refused to use a tool.
 */
export function checkRefusal(
  response: { content: Array<{ type: string; [key: string]: any }> }
): { refused: boolean; selectedTool?: string } {
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse) {
    return { refused: true };
  }
  return { refused: false, selectedTool: toolUse.name };
}

/**
 * Check that the LLM did NOT select any of the forbidden tools.
 * For tool confusion tests where the LLM should pick the RIGHT tool, not the confused one.
 */
export function checkForbiddenToolNotUsed(
  selectedTool: string | undefined,
  forbiddenTools: string[]
): { pass: boolean; violatedTool?: string } {
  if (!selectedTool) return { pass: true };
  if (forbiddenTools.includes(selectedTool)) {
    return { pass: false, violatedTool: selectedTool };
  }
  return { pass: true };
}

/**
 * Check that the MCP tool output indicates an error (for invalid data tests).
 * The tool should return an error message, not successful data.
 */
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

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

function normalizeArgKeys(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    result[normalizeKey(k)] = v;
  }
  return result;
}
