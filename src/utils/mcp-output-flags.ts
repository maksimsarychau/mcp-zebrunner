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
