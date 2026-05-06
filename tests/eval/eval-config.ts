import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

export type EvalLayer = 1 | 2 | 3;

export interface EvalThresholds {
  toolSelectionAccuracy: number;
  argCorrectness: number;
  judgeAvgScore: number;
}

export interface EvalConfig {
  layer: EvalLayer;
  model: string;
  judgeModel: string;
  temperature: number;
  maxTokens: number;
  thresholds: EvalThresholds;
  anthropicApiKey: string;
  resultsDir: string;
  concurrency: number;
  filter: string[];
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function getEvalConfig(): EvalConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for eval tests.\n" +
      "Add it to your .env file: ANTHROPIC_API_KEY=sk-ant-api03-..."
    );
  }

  const layer = parseInt(process.env.EVAL_LAYER || "3", 10) as EvalLayer;
  if (![1, 2, 3].includes(layer)) {
    throw new Error(`EVAL_LAYER must be 1, 2, or 3. Got: ${process.env.EVAL_LAYER}`);
  }

  const filter = process.env.EVAL_FILTER
    ? process.env.EVAL_FILTER.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    layer,
    model: process.env.EVAL_MODEL || DEFAULT_MODEL,
    judgeModel: process.env.EVAL_JUDGE_MODEL || DEFAULT_MODEL,
    temperature: 0,
    maxTokens: 2048,
    thresholds: {
      toolSelectionAccuracy: 0.90,
      argCorrectness: 0.85,
      judgeAvgScore: 3.0,
    },
    anthropicApiKey: apiKey,
    resultsDir: new URL("./results", import.meta.url).pathname,
    concurrency: 3,
    filter,
  };
}

/**
 * Check if a prompt ID matches the EVAL_FILTER patterns.
 * Supports exact match and substring match.
 * Returns true (run this test) if no filter is set.
 */
export function matchesFilter(id: string, filter: string[]): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) => id === f || id.includes(f));
}

let _client: Anthropic | null = null;

export function getAnthropicClient(config: EvalConfig): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return _client;
}
