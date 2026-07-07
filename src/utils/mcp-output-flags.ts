/**
 * Feature flags for MCP output shaping (token/cost optimization).
 * Defaults remain backward-compatible until explicitly enabled via env.
 */

export function isCompactDefaultsEnabled(): boolean {
  return process.env.MCP_COMPACT_DEFAULTS === 'true';
}

export function isSummaryDefaultsEnabled(): boolean {
  return process.env.MCP_SUMMARY_DEFAULTS === 'true';
}

/** Resolve data-format default: json unless MCP_COMPACT_DEFAULTS=true → compact. */
export function defaultDataFormat(): 'json' | 'compact' {
  return isCompactDefaultsEnabled() ? 'compact' : 'json';
}

/** Resolve detail default for bulk/list reads. */
export function defaultDetailLevel(): 'summary' | 'full' {
  return isSummaryDefaultsEnabled() ? 'summary' : 'full';
}

/** Append per-call _mcp_metrics footer to tool responses when true. */
export function isInlineMetricsEnabled(): boolean {
  return process.env.MCP_INLINE_METRICS === 'true';
}

/**
 * When MCP_MAX_RESULTS is a positive integer, use it as the zod default for tools
 * with max_results. Unset or invalid → per-tool schema fallback (5000 / 500).
 * Explicit tool args always override at call time.
 */
export function defaultMaxResults(fallback: number): number {
  const raw = process.env.MCP_MAX_RESULTS?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
