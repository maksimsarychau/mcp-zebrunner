import "dotenv/config";
import { resolveEvalSuite, type EvalSuite } from "./eval-cloud-suite.js";

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
  suite: EvalSuite;
}

const DEFAULT_MODELS: Record<EvalProvider, string> = {
  anthropic: "claude-sonnet-5",
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

/** Local Ollama: argument checks are noisy on 2B models (often omit optional keys). */
export const DEFAULT_LOCAL_ARG_CORRECTNESS_THRESHOLD = 0.7;

/** Cloud default for LLM judge average (1–5 scale). */
export const DEFAULT_CLOUD_JUDGE_THRESHOLD = 3.0;

/** Local Ollama: same tiny model often judges its own output ~1/5 — gate loosely. */
export const DEFAULT_LOCAL_JUDGE_THRESHOLD = 1.0;

function readEnv(name: string): string | undefined {
  const val = process.env[name]?.trim();
  return val || undefined;
}

function isLocalPlaceholderApiKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "ollama" || lower === "local" || lower === "lm-studio";
}

function readProviderApiKey(provider: EvalProvider): string | undefined {
  switch (provider) {
    case "anthropic":
      return readEnv("ANTHROPIC_API_KEY");
    case "openai":
      return readEnv("OPENAI_API_KEY");
    case "gemini":
      return readEnv("GEMINI_API_KEY") ?? readEnv("GOOGLE_API_KEY");
    case "local":
      return undefined;
  }
}

function resolveApiKey(provider: EvalProvider): string | undefined {
  if (provider === "local") {
    return readEnv("EVAL_API_KEY") ?? "ollama";
  }

  const providerKey = readProviderApiKey(provider);
  const unified = readEnv("EVAL_API_KEY");

  // Provider-specific cloud key wins over EVAL_API_KEY=ollama left in .env for local runs.
  if (providerKey) return providerKey;
  if (unified && !isLocalPlaceholderApiKey(unified)) return unified;
  return undefined;
}

/** Ollama model tags use name:quant (e.g. qwen3.5:2b); cloud APIs use different IDs. */
export function isLikelyOllamaModelName(model: string): boolean {
  if (model.includes(":")) return true;
  const lower = model.toLowerCase();
  return /^(qwen|llama|mistral|phi|gemma|deepseek|codellama)/.test(lower);
}

function resolveEvalModel(provider: EvalProvider, baseUrl?: string): string {
  const explicit = readEnv("EVAL_MODEL");
  const defaultModel = DEFAULT_MODELS[provider];
  if (!explicit) return defaultModel;
  if (provider === "local" || isLocalEvalProvider(provider, baseUrl)) {
    return explicit;
  }
  if (isLikelyOllamaModelName(explicit)) return defaultModel;
  return explicit;
}

function resolveEvalBaseUrl(provider: EvalProvider): string | undefined {
  const raw = readEnv("EVAL_BASE_URL");
  if (provider === "local") {
    return raw ?? DEFAULT_LOCAL_EVAL_BASE_URL;
  }
  // Anthropic/Gemini ignore base URL; OpenAI cloud only when not localhost.
  if (provider === "anthropic" || provider === "gemini") {
    return undefined;
  }
  if (raw && isLocalOpenAiBaseUrl(raw)) {
    return raw;
  }
  return raw;
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

export function validateCloudSuiteConfig(config: EvalConfig): void {
  if (config.suite !== "cloud") return;
  if (!isLocalEvalProvider(config.provider, config.baseUrl)) return;
  if (isLikelyOllamaModelName(config.model)) return;

  throw new Error(
    `Cloud eval suite cannot use ${config.provider} with model "${config.model}" — ` +
      "Ollama/LM Studio does not host that model (instant 404).\n" +
      "  Release gate:  npm run test:eval:cloud  (sets EVAL_PROVIDER=anthropic)\n" +
      "  Local smoke:   EVAL_SUITE=cloud EVAL_PROVIDER=local EVAL_MODEL=qwen3.5:2b npm run test:eval",
  );
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

  const baseUrl = resolveEvalBaseUrl(provider);
  const model = resolveEvalModel(provider, baseUrl);

  const config: EvalConfig = {
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
    suite: resolveEvalSuite(),
  };

  validateCloudSuiteConfig(config);
  return config;
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

/** Ollama native API root from OpenAI-compatible base URL (e.g. .../v1 → origin). */
export function ollamaApiRoot(baseUrl?: string): string {
  const raw = baseUrl ?? DEFAULT_LOCAL_EVAL_BASE_URL;
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/v1\/?$/, "");
    return `${u.origin}${path === "/" ? "" : path}`;
  } catch {
    return "http://localhost:11434";
  }
}

function ollamaHasModel(available: string[], wanted: string): boolean {
  if (available.includes(wanted)) return true;
  const wantedBase = wanted.split(":")[0];
  return available.some(
    (name) =>
      name === wanted ||
      name.startsWith(`${wanted}:`) ||
      wanted.startsWith(`${name}:`) ||
      name.split(":")[0] === wantedBase,
  );
}

/**
 * Fail fast when local Ollama/LM Studio is down or the configured model is missing.
 * Skipped for cloud providers.
 */
export async function assertLocalEvalLlmReachable(
  config: EvalConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!isLocalEvalEndpoint(config)) return;

  const tagsUrl = `${ollamaApiRoot(config.baseUrl)}/api/tags`;
  let res: Response;
  try {
    res = await fetchImpl(tagsUrl, { signal: AbortSignal.timeout(8_000) });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Local eval LLM unreachable at ${tagsUrl} (${detail}).\n` +
        "  Start Ollama:  ollama serve\n" +
        `  Pull model:    ollama pull ${config.model}\n` +
        "  Cloud gate:    npm run test:eval:cloud",
    );
  }

  if (!res.ok) {
    throw new Error(
      `Local eval LLM returned HTTP ${res.status} from ${tagsUrl}.\n` +
        "  Check Ollama is running: ollama serve",
    );
  }

  const body = (await res.json()) as { models?: Array<{ name: string }> };
  const names = (body.models ?? []).map((m) => m.name).filter(Boolean);
  if (names.length === 0) {
    throw new Error(
      `No models loaded in Ollama at ${tagsUrl}.\n` +
        `  Pull model: ollama pull ${config.model}`,
    );
  }

  if (!ollamaHasModel(names, config.model)) {
    const sample = names.slice(0, 6).join(", ");
    throw new Error(
      `Model "${config.model}" not found in Ollama (available: ${sample}${names.length > 6 ? ", ..." : ""}).\n` +
        `  Pull it: ollama pull ${config.model}`,
    );
  }
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
  if (isLocalEvalProvider(provider, baseUrl)) {
    return DEFAULT_LOCAL_ARG_CORRECTNESS_THRESHOLD;
  }
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

/**
 * Warn when .env still has local Ollama settings but a cloud provider was selected.
 */
export function getEvalConfigWarnings(config: EvalConfig): string[] {
  const warnings: string[] = [];
  const rawBase = readEnv("EVAL_BASE_URL");
  const rawModel = readEnv("EVAL_MODEL");
  const rawApiKey = readEnv("EVAL_API_KEY");

  if (
    (config.provider === "anthropic" || config.provider === "gemini") &&
    rawBase &&
    isLocalOpenAiBaseUrl(rawBase)
  ) {
    warnings.push(
      `EVAL_BASE_URL=${rawBase} is ignored for EVAL_PROVIDER=${config.provider}. ` +
        "Unset it in .env or use EVAL_PROVIDER=local for Ollama.",
    );
  }

  if (
    rawApiKey &&
    isLocalPlaceholderApiKey(rawApiKey) &&
    config.provider !== "local" &&
    !isLocalEvalProvider(config.provider, rawBase)
  ) {
    const used = config.provider === "anthropic"
      ? "ANTHROPIC_API_KEY"
      : config.provider === "openai"
        ? "OPENAI_API_KEY"
        : "GEMINI_API_KEY";
    warnings.push(
      `EVAL_API_KEY=[REDACTED] is for local Ollama only — using ${used} for EVAL_PROVIDER=${config.provider}.`,
    );
  }

  if (rawModel && rawModel !== config.model && config.provider !== "local") {
    warnings.push(
      `EVAL_MODEL=${rawModel} looks like a local model — using ${config.model} for EVAL_PROVIDER=${config.provider}.`,
    );
  }

  return warnings;
}
