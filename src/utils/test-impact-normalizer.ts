/** Minimum token length after normalization. */
export const MIN_PHRASE_LENGTH = 3;

/** Max title-search phrases per single impact analysis call. */
export const MAX_SEARCH_PHRASES = 8;

/** Max title-search phrases when merging change_batches. */
export const MAX_BATCH_SEARCH_PHRASES = 24;

/** Max PR/change batches per call. */
export const MAX_CHANGE_BATCHES = 20;

const GENERIC_DEV_TERMS = new Set([
  "manager",
  "repository",
  "service",
  "controller",
  "helper",
  "utils",
  "implementation",
  "provider",
  "factory",
  "adapter",
  "handler",
  "viewmodel",
  "view",
  "model",
  "fragment",
  "activity",
]);

export interface ChangeContextInput {
  change_summary?: string;
  features?: string[];
  behaviors?: string[];
  changed_symbols?: string[];
  changed_files?: string[];
  keywords?: string[];
}

/** One PR or change slice for batch impact analysis (client-derived metadata only). */
export interface ChangeContextBatch extends ChangeContextInput {
  id?: string;
  label?: string;
  source_url?: string;
  merged_at?: string;
}

export interface MergedBatchContext {
  merged: NormalizedChangeContext;
  batchLabels: string[];
  batchCount: number;
}

export interface NormalizedChangeContext {
  changeSummary?: string;
  features: string[];
  behaviors: string[];
  symbols: string[];
  files: string[];
  keywords: string[];
  searchPhrases: string[];
  allText: string;
}

function splitIdentifier(id: string): string[] {
  const parts: string[] = [];
  const snake = id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  for (const w of snake.toLowerCase().split(/\s+/)) {
    if (w.length >= MIN_PHRASE_LENGTH) parts.push(w);
  }
  return parts;
}

function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const n = normalizePhrase(item);
    if (!n || n.length < MIN_PHRASE_LENGTH || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function stripGenericTerms(phrases: string[], featureWords: Set<string>): string[] {
  return phrases.filter((p) => {
    const words = p.split(/\s+/);
    if (words.length === 1 && GENERIC_DEV_TERMS.has(words[0]) && !featureWords.has(words[0])) {
      return false;
    }
    return true;
  });
}

function fileBaseName(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.(kt|java|swift|ts|tsx|js|jsx|py|go|rs)$/i, "");
}

/** Rank and cap search phrases: behaviors > features > symbol-derived > keywords > summary tokens. */
export function rankSearchPhrases(
  ctx: NormalizedChangeContext,
  maxPhrases: number = MAX_SEARCH_PHRASES,
): string[] {
  const scored: Array<{ phrase: string; score: number }> = [];
  const add = (phrase: string, score: number) => {
    const n = normalizePhrase(phrase);
    if (n.length < MIN_PHRASE_LENGTH) return;
    scored.push({ phrase: n, score });
  };

  for (const b of ctx.behaviors) add(b, 100 + b.split(/\s+/).length * 10);
  for (const f of ctx.features) add(f, 80 + f.split(/\s+/).length * 8);
  for (const s of ctx.symbols) {
    add(s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "), 60);
    for (const part of splitIdentifier(s)) add(part, 40);
  }
  for (const k of ctx.keywords) add(k, 50);
  for (const file of ctx.files) {
    const base = fileBaseName(file);
    add(base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "), 35);
  }
  if (ctx.changeSummary) {
    for (const w of ctx.changeSummary.split(/\s+/)) {
      if (w.length >= MIN_PHRASE_LENGTH) add(w, 20);
    }
  }

  scored.sort((a, b) => b.score - a.score || a.phrase.localeCompare(b.phrase));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { phrase } of scored) {
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    out.push(phrase);
    if (out.length >= maxPhrases) break;
  }
  return out;
}

export function batchSourceLabel(batch: ChangeContextBatch, index: number): string {
  if (batch.label?.trim()) return batch.label.trim();
  if (batch.id?.trim()) {
    const id = batch.id.trim();
    return /^PR#/i.test(id) ? id : `PR#${id}`;
  }
  if (batch.source_url?.trim()) {
    const m = batch.source_url.match(/\/pull\/(\d+)/i);
    if (m) return `PR#${m[1]}`;
    return batch.source_url.trim();
  }
  return `batch-${index + 1}`;
}

/** Merge multiple change batches into one normalized context for a single retrieval pass. */
export function mergeBatchChangeContexts(
  batches: ChangeContextBatch[],
  maxPhrases: number = MAX_BATCH_SEARCH_PHRASES,
): MergedBatchContext {
  const capped = batches.slice(0, MAX_CHANGE_BATCHES);
  const mergedInput: ChangeContextInput = {
    change_summary: capped
      .map((b) => b.change_summary?.trim())
      .filter(Boolean)
      .join("; "),
    features: capped.flatMap((b) => b.features ?? []),
    behaviors: capped.flatMap((b) => b.behaviors ?? []),
    changed_symbols: capped.flatMap((b) => b.changed_symbols ?? []),
    changed_files: capped.flatMap((b) => b.changed_files ?? []),
    keywords: capped.flatMap((b) => b.keywords ?? []),
  };

  const merged = normalizeChangeContext(mergedInput);
  merged.searchPhrases = rankSearchPhrases(merged, maxPhrases);

  return {
    merged,
    batchLabels: capped.map((b, i) => batchSourceLabel(b, i)),
    batchCount: capped.length,
  };
}

export function normalizeChangeContext(
  input: ChangeContextInput,
  maxPhrases: number = MAX_SEARCH_PHRASES,
): NormalizedChangeContext {
  const features = dedupeStrings(input.features ?? []);
  const behaviors = dedupeStrings(input.behaviors ?? []);
  const symbols = dedupeStrings(input.changed_symbols ?? []);
  const files = dedupeStrings((input.changed_files ?? []).map(fileBaseName));
  const keywords = dedupeStrings(input.keywords ?? []);
  const changeSummary = input.change_summary?.trim()
    ? normalizePhrase(input.change_summary)
    : undefined;

  const featureWords = new Set<string>();
  for (const f of features) {
    for (const w of f.split(/\s+/)) featureWords.add(w);
  }

  const merged = stripGenericTerms(
    dedupeStrings([...behaviors, ...features, ...keywords, ...symbols, ...files]),
    featureWords,
  );

  const ctx: NormalizedChangeContext = {
    changeSummary,
    features,
    behaviors,
    symbols,
    files,
    keywords,
    searchPhrases: [],
    allText: "",
  };
  ctx.searchPhrases = rankSearchPhrases(ctx, maxPhrases);
  ctx.allText = [
    changeSummary,
    ...features,
    ...behaviors,
    ...symbols,
    ...files,
    ...keywords,
    ...merged,
  ]
    .filter(Boolean)
    .join(" ");

  return ctx;
}

export function hasMeaningfulChangeContext(input: ChangeContextInput): boolean {
  const parts = [
    input.change_summary,
    ...(input.features ?? []),
    ...(input.behaviors ?? []),
    ...(input.changed_symbols ?? []),
    ...(input.changed_files ?? []),
    ...(input.keywords ?? []),
  ];
  return parts.some((p) => typeof p === "string" && p.trim().length >= MIN_PHRASE_LENGTH);
}

export function hasMeaningfulBatchContexts(batches: ChangeContextBatch[] | undefined): boolean {
  if (!batches?.length) return false;
  return batches.some((b) => hasMeaningfulChangeContext(b));
}

/** Word-boundary match for infra keyword detection. */
export function matchesInfraKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  const re = new RegExp(`\\b${escaped.replace(/\s+/g, "\\s+")}\\b`, "i");
  return re.test(text);
}
