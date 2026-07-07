import type { OutputFormat } from "../types/api.js";
import { serializeFormattedOutput } from "./formatter.js";

/** Hard safety net before MCP ~1 MB client limits. */
export const MAX_RESPONSE_BYTES = 900_000;

export interface CapCasesResult<T> {
  slice: T[];
  wasTruncated: boolean;
}

/** Optional metadata handlers attach for per-call metrics footer enrichment. */
export interface McpBulkMetrics {
  rowsReturned: number;
  wasTruncated: boolean;
}

export type McpHandlerResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  _mcpBulkMetrics?: McpBulkMetrics;
};

/** Measure payload size using compact JSON (format-agnostic row budgeting). */
export function measurePayloadBytes(payload: unknown): number {
  return serializeFormattedOutput(payload, "compact").length;
}

/**
 * Find the largest prefix of `cases` whose `buildPayload(slice)` fits in `maxBytes`
 * when serialized as compact JSON.
 */
export function capCasesForByteBudget<T>(
  cases: T[],
  buildPayload: (slice: T[]) => unknown,
  maxBytes: number = MAX_RESPONSE_BYTES,
): CapCasesResult<T> {
  if (cases.length === 0) {
    return { slice: [], wasTruncated: false };
  }

  if (measurePayloadBytes(buildPayload(cases)) <= maxBytes) {
    return { slice: cases, wasTruncated: false };
  }

  let lo = 1;
  let hi = cases.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const size = measurePayloadBytes(buildPayload(cases.slice(0, mid)));
    if (size <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  const safeCount = Math.max(1, lo);
  return {
    slice: cases.slice(0, safeCount),
    wasTruncated: safeCount < cases.length,
  };
}

/** Legacy truncation: avg item size from formatted full response (json path unchanged). */
export function legacyBulkTruncate<T>(
  items: T[],
  formattedFullLength: number,
  format: OutputFormat,
): { slice: T[]; bodyText: string } {
  const avgItemSize = formattedFullLength / Math.max(items.length, 1);
  const safeCount = Math.floor(MAX_RESPONSE_BYTES / avgItemSize * 0.9);
  const slice = items.slice(0, Math.max(safeCount, 1));
  return {
    slice,
    bodyText: serializeFormattedOutput(slice, format),
  };
}

export function compactBulkTruncate<T>(
  items: T[],
  buildPayload: (slice: T[]) => unknown,
  format: OutputFormat,
  maxBytes: number = MAX_RESPONSE_BYTES,
): { slice: T[]; bodyText: string; wasTruncated: boolean } {
  const capped = capCasesForByteBudget(items, buildPayload, maxBytes);
  return {
    slice: capped.slice,
    bodyText: serializeFormattedOutput(buildPayload(capped.slice), format),
    wasTruncated: capped.wasTruncated,
  };
}

export function isCompactFormat(format: unknown): boolean {
  return format === "compact";
}

export function attachBulkMetrics<T extends McpHandlerResult>(
  result: T,
  rowsReturned: number,
  wasTruncated: boolean,
): T & { _mcpBulkMetrics: McpBulkMetrics } {
  return {
    ...result,
    _mcpBulkMetrics: { rowsReturned, wasTruncated },
  };
}

/** Truncate when full formatted response exceeds budget; compact uses wrapper + fair row cap. */
export function truncateBulkItems<T>(
  items: T[],
  formattedFullLength: number,
  format: OutputFormat,
  buildCompactPayload: (slice: T[]) => unknown,
): { slice: T[]; bodyText: string; wasTruncated: boolean } {
  if (isCompactFormat(format)) {
    const capped = compactBulkTruncate(items, buildCompactPayload, format);
    return {
      slice: capped.slice,
      bodyText: capped.bodyText,
      wasTruncated: true,
    };
  }
  const legacy = legacyBulkTruncate(items, formattedFullLength, format);
  return {
    slice: legacy.slice,
    bodyText: legacy.bodyText,
    wasTruncated: legacy.slice.length < items.length,
  };
}
