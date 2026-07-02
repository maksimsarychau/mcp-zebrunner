import "dotenv/config";

export type EvalLayer = 1 | 2 | 3;
export type EvalProvider = "anthropic" | "openai" | "gemini" | "local";

/** Wire protocol for tool schemas / SDK (local uses OpenAI-compatible API). */
export type EvalWireProvider = "anthropic" | "openai" | "gemini";

export interface EvalThresholds {
  toolSelectionAccuracy: number;
  argCorrectness: number;
  judgeAvgScore: number;
}

export interface EvalConfig {
  provider: EvalProvider;
  layer: EvalLayer;
  model: string;
  judgeModel: string;
  temperature: number;
  maxTokens: number;
  thresholds: EvalThresholds;
  /** When true, per-prompt tests log soft warnings; suite fails only on aggregate thresholds. */
  relaxedMode: boolean;
  apiKey?: string;
  baseUrl?: string;
  resultsDir: string;
  concurrency: number;
  filter: string[];
}

const DEFAULT_MODELS: Record<EvalProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  local: "qwen3.5:2b",
};

/** Default Ollama OpenAI-compatible endpoint when EVAL_PROVIDER=local. */
export const DEFAULT_LOCAL_EVAL_BASE_URL = "http://localhost:11434/v1";

/** Cloud / release-gate default for tool-selection aggregate threshold. */
export const DEFAULT_CLOUD_TOOL_SELECTION_THRESHOLD = 0.9;

/** Default when EVAL_BASE_URL points at local Ollama (small models score lower). */
export const DEFAULT_LOCAL_TOOL_SELECTION_THRESHOLD = 0.8;

/** Cloud default for LLM judge average (1–5 scale). */
export const DEFAULT_CLOUD_JUDGE_THRESHOLD = 3.0;

/** Local Ollama: same tiny model often judges its own output ~1/5 — gate loosely. */
export const DEFAULT_LOCAL_JUDGE_THRESHOLD = 1.0;

function readEnv(name: string): string | undefined {
  const val = process.env[name]?.trim();
  return val || undefined;
}

function resolveApiKey(provider: EvalProvider): string | undefined {
  const unified = readEnv("EVAL_API_KEY");
  if (unified) return unified;

  switch (provider) {
    case "anthropic":
      return readEnv("ANTHROPIC_API_KEY");
    case "openai":
      return readEnv("OPENAI_API_KEY");
    case "gemini":
      return readEnv("GEMINI_API_KEY") ?? readEnv("GOOGLE_API_KEY");
    case "local":
      return "ollama";
  }
}

function isLocalOpenAiBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

export function isLocalEvalProvider(provider: EvalProvider, baseUrl?: string): boolean {
  if (provider === "local") return true;
  return provider === "openai" && isLocalOpenAiBaseUrl(baseUrl);
}

export function evalWireProvider(provider: EvalProvider): EvalWireProvider {
  return provider === "local" ? "openai" : provider;
}

/**
 * Resolve which LLM provider to use from EVAL_PROVIDER or auto-detect from env keys.
 */
export function resolveEvalProvider(): EvalProvider | null {
  const explicit = readEnv("EVAL_PROVIDER")?.toLowerCase();
  if (explicit) {
    if (explicit === "anthropic" || explicit === "openai" || explicit === "gemini" || explicit === "local") {
      return explicit;
    }
    throw new Error(
      `Invalid EVAL_PROVIDER="${explicit}". Must be anthropic, openai, gemini, or local.`,
    );
  }

  if (readEnv("ANTHROPIC_API_KEY")) return "anthropic";
  if (readEnv("GEMINI_API_KEY") || readEnv("GOOGLE_API_KEY")) return "gemini";
  if (readEnv("OPENAI_API_KEY")) return "openai";
  const baseUrl = readEnv("EVAL_BASE_URL");
  if (baseUrl && isLocalOpenAiBaseUrl(baseUrl)) return "local";
  if (baseUrl) return "openai";

  return null;
}

/**
 * Returns true when enough env is set to run eval tests (any provider).
 */
export function hasEvalLlmConfig(): boolean {
  const provider = resolveEvalProvider();
  if (!provider) return false;
  if (provider === "local") return true;
  if (provider === "openai" && readEnv("EVAL_BASE_URL")) return true;
  return !!resolveApiKey(provider);
}

function validateProviderConfig(provider: EvalProvider): void {
  if (provider === "local") return;

  const apiKey = resolveApiKey(provider);
  const baseUrl = readEnv("EVAL_BASE_URL");

  if (provider === "openai" && baseUrl) {
    return;
  }

  if (!apiKey) {
    const hints: Record<Exclude<EvalProvider, "local">, string> = {
      anthropic: "Set ANTHROPIC_API_KEY or EVAL_API_KEY",
      openai: "Set OPENAI_API_KEY or EVAL_API_KEY",
      gemini: "Set GEMINI_API_KEY, GOOGLE_API_KEY, or EVAL_API_KEY",
    };
    throw new Error(
      `LLM API key required for EVAL_PROVIDER=${provider}. ${hints[provider]}`,
    );
  }
}

export function getEvalConfig(): EvalConfig {
  const provider = resolveEvalProvider();
  if (!provider) {
    throw new Error(
      "No LLM provider configured for eval tests.\n" +
      "  Local Ollama:  EVAL_PROVIDER=local EVAL_MODEL=qwen3.5:2b\n" +
      "                 (legacy: EVAL_PROVIDER=openai EVAL_BASE_URL=http://localhost:11434/v1)\n" +
      "  Claude:        ANTHROPIC_API_KEY=sk-ant-...  (or EVAL_PROVIDER=anthropic)\n" +
      "  OpenAI cloud:  OPENAI_API_KEY=sk-...         (or EVAL_PROVIDER=openai)\n" +
      "  Gemini:        GEMINI_API_KEY=...            (or EVAL_PROVIDER=gemini)",
    );
  }

  validateProviderConfig(provider);

  const layer = parseInt(process.env.EVAL_LAYER || "3", 10) as EvalLayer;
  if (![1, 2, 3].includes(layer)) {
    throw new Error(`EVAL_LAYER must be 1, 2, or 3. Got: ${process.env.EVAL_LAYER}`);
  }

  const filter = process.env.EVAL_FILTER
    ? process.env.EVAL_FILTER.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const defaultModel = DEFAULT_MODELS[provider];
  const model = readEnv("EVAL_MODEL") || defaultModel;
  const baseUrl =
    provider === "local"
      ? readEnv("EVAL_BASE_URL") ?? DEFAULT_LOCAL_EVAL_BASE_URL
      : readEnv("EVAL_BASE_URL");

  return {
    provider,
    layer,
    model,
    judgeModel: readEnv("EVAL_JUDGE_MODEL") || model,
    temperature: 0,
    maxTokens: 2048,
    thresholds: {
      toolSelectionAccuracy: resolveToolSelectionThreshold(provider, baseUrl),
      argCorrectness: resolveArgCorrectnessThreshold(provider, baseUrl),
      judgeAvgScore: resolveJudgeThreshold(provider, baseUrl),
    },
    relaxedMode: resolveRelaxedMode(provider, baseUrl),
    apiKey: provider === "local" ? resolveApiKey("local") : resolveApiKey(provider),
    baseUrl,
    resultsDir: new URL("./results", import.meta.url).pathname,
    concurrency: 3,
    filter,
  };
}

/**
 * Check if a prompt ID matches the EVAL_FILTER patterns.
 */
export function matchesFilter(id: string, filter: string[]): boolean {
  if (filter.length === 0) return true;
  return filter.some((f) => id === f || id.includes(f));
}

export function isLocalEvalEndpoint(config: EvalConfig): boolean {
  return isLocalEvalProvider(config.provider, config.baseUrl);
}

/**
 * Parse EVAL_MIN_PASS_RATE: accepts 0–1 (0.85) or 0–100 (85).
 */
export function parsePassRate(value: string): number {
  const n = parseFloat(value.trim());
  if (Number.isNaN(n)) {
    throw new Error(`EVAL_MIN_PASS_RATE must be a number (0–1 or 0–100). Got: ${value}`);
  }
  const rate = n > 1 ? n / 100 : n;
  if (rate < 0 || rate > 1) {
    throw new Error(`EVAL_MIN_PASS_RATE must be between 0 and 100 (or 0 and 1). Got: ${value}`);
  }
  return rate;
}

function resolveToolSelectionThreshold(provider: EvalProvider, baseUrl?: string): number {
  const explicit = readEnv("EVAL_MIN_PASS_RATE");
  if (explicit) return parsePassRate(explicit);
  if (isLocalEvalProvider(provider, baseUrl)) {
    return DEFAULT_LOCAL_TOOL_SELECTION_THRESHOLD;
  }
  return DEFAULT_CLOUD_TOOL_SELECTION_THRESHOLD;
}

function resolveArgCorrectnessThreshold(provider: EvalProvider, baseUrl?: string): number {
  const explicit = readEnv("EVAL_MIN_ARG_PASS_RATE");
  if (explicit) return parsePassRate(explicit);
  return 0.85;
}

function resolveJudgeThreshold(provider: EvalProvider, baseUrl?: string): number {
  const explicit = readEnv("EVAL_MIN_JUDGE_SCORE");
  if (explicit) {
    const n = parseFloat(explicit);
    if (Number.isNaN(n)) {
      throw new Error(`EVAL_MIN_JUDGE_SCORE must be a number. Got: ${explicit}`);
    }
    return n;
  }
  if (isLocalEvalProvider(provider, baseUrl)) {
    return DEFAULT_LOCAL_JUDGE_THRESHOLD;
  }
  return DEFAULT_CLOUD_JUDGE_THRESHOLD;
}

/**
 * Relaxed mode: log per-prompt misses but fail the suite only on aggregate scorecard thresholds.
 * Default on for local Ollama; set EVAL_STRICT=true to force per-prompt assertions.
 */
export function resolveRelaxedMode(provider: EvalProvider, baseUrl?: string): boolean {
  const strict = readEnv("EVAL_STRICT")?.toLowerCase();
  if (strict === "true" || strict === "1" || strict === "yes") return false;
  if (strict === "false" || strict === "0" || strict === "no") return true;
  return isLocalEvalProvider(provider, baseUrl);
}
