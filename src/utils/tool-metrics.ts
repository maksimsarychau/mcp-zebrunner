import {
  appendCallMetricsFooter,
  buildCallMetricsPayload,
  formatCallMetricsFooter,
  normalizeMetricDimension,
  responseContentCharCount,
  stripCallMetricsArg,
  type CallMetricsPayload,
} from "./response-metrics.js";
import { isInlineMetricsEnabled } from "./mcp-output-flags.js";

export interface ToolStats {
  callCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  totalResponseChars: number;
  errorCount: number;
  lastCalledAt: string | null;
}

export interface CallDimensions {
  format?: string;
  detail?: string;
}

export interface BreakdownStats {
  tool: string;
  format: string;
  detail: string;
  callCount: number;
  totalResponseChars: number;
  avgResponseChars: number;
  totalDurationMs: number;
  avgDurationMs: number;
  errorCount: number;
}

function breakdownKey(tool: string, dims?: CallDimensions): string {
  const format = normalizeMetricDimension(dims?.format);
  const detail = normalizeMetricDimension(dims?.detail);
  return `${tool}|${format}|${detail}`;
}

export class ToolMetrics {
  private stats = new Map<string, ToolStats>();
  private breakdown = new Map<string, BreakdownStats>();

  record(
    name: string,
    durationMs: number,
    responseChars: number,
    isError: boolean,
    dims?: CallDimensions,
  ): void {
    const existing = this.stats.get(name);
    if (existing) {
      existing.callCount++;
      existing.totalDurationMs += durationMs;
      existing.avgDurationMs = existing.totalDurationMs / existing.callCount;
      existing.minDurationMs = Math.min(existing.minDurationMs, durationMs);
      existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
      existing.totalResponseChars += responseChars;
      if (isError) existing.errorCount++;
      existing.lastCalledAt = new Date().toISOString();
    } else {
      this.stats.set(name, {
        callCount: 1,
        totalDurationMs: durationMs,
        avgDurationMs: durationMs,
        minDurationMs: durationMs,
        maxDurationMs: durationMs,
        totalResponseChars: responseChars,
        errorCount: isError ? 1 : 0,
        lastCalledAt: new Date().toISOString(),
      });
    }

    const key = breakdownKey(name, dims);
    const row = this.breakdown.get(key);
    if (row) {
      row.callCount++;
      row.totalResponseChars += responseChars;
      row.avgResponseChars = row.totalResponseChars / row.callCount;
      row.totalDurationMs += durationMs;
      row.avgDurationMs = row.totalDurationMs / row.callCount;
      if (isError) row.errorCount++;
    } else {
      this.breakdown.set(key, {
        tool: name,
        format: normalizeMetricDimension(dims?.format),
        detail: normalizeMetricDimension(dims?.detail),
        callCount: 1,
        totalResponseChars: responseChars,
        avgResponseChars: responseChars,
        totalDurationMs: durationMs,
        avgDurationMs: durationMs,
        errorCount: isError ? 1 : 0,
      });
    }
  }

  getStats(): Map<string, ToolStats> {
    return this.stats;
  }

  getBreakdownStats(): BreakdownStats[] {
    return [...this.breakdown.values()].sort((a, b) => {
      if (b.callCount !== a.callCount) return b.callCount - a.callCount;
      return a.tool.localeCompare(b.tool);
    });
  }

  getSummaryMarkdown(): string {
    if (this.stats.size === 0) {
      return "No tool calls recorded in this session.";
    }

    const entries = [...this.stats.entries()].sort(
      (a, b) => b[1].callCount - a[1].callCount,
    );

    const totalCalls = entries.reduce((s, [, v]) => s + v.callCount, 0);
    const totalDuration = entries.reduce((s, [, v]) => s + v.totalDurationMs, 0);
    const totalErrors = entries.reduce((s, [, v]) => s + v.errorCount, 0);

    const lines: string[] = [
      `## MCP Tool Metrics (session)`,
      "",
      `**Total calls:** ${totalCalls} | **Total time:** ${(totalDuration / 1000).toFixed(1)}s | **Errors:** ${totalErrors}`,
      "",
      `| Tool | Calls | Avg (ms) | Min (ms) | Max (ms) | Resp (chars) | Errors |`,
      `|------|-------|----------|----------|----------|--------------|--------|`,
    ];

    for (const [name, s] of entries) {
      lines.push(
        `| ${name} | ${s.callCount} | ${Math.round(s.avgDurationMs)} | ${Math.round(s.minDurationMs)} | ${Math.round(s.maxDurationMs)} | ${s.totalResponseChars.toLocaleString()} | ${s.errorCount} |`,
      );
    }

    return lines.join("\n");
  }

  getBreakdownMarkdown(): string {
    const rows = this.getBreakdownStats();
    if (rows.length === 0) {
      return "No breakdown data recorded in this session.";
    }

    const lines: string[] = [
      `## MCP Tool Metrics by Format / Detail`,
      "",
      `| Tool | Format | Detail | Calls | Avg chars | Avg (ms) | Errors |`,
      `|------|--------|--------|-------|-----------|----------|--------|`,
    ];

    for (const r of rows) {
      lines.push(
        `| ${r.tool} | ${r.format} | ${r.detail} | ${r.callCount} | ${Math.round(r.avgResponseChars).toLocaleString()} | ${Math.round(r.avgDurationMs)} | ${r.errorCount} |`,
      );
    }

    return lines.join("\n");
  }

  getFullMetricsMarkdown(includeBreakdown = true): string {
    const parts = [this.getSummaryMarkdown()];
    if (includeBreakdown) {
      parts.push("", this.getBreakdownMarkdown());
    }
    return parts.join("\n");
  }

  reset(): void {
    this.stats.clear();
    this.breakdown.clear();
  }
}

export type { CallMetricsPayload };

export function wrapToolHandler<T extends (...args: any[]) => any>(
  name: string,
  handler: T,
  metrics: ToolMetrics,
): T {
  const wrapped = async (...args: any[]) => {
    const start = Date.now();
    const rawArgs = args[0];
    const { handlerArgs, includeCallMetrics } = stripCallMetricsArg(
      rawArgs,
      isInlineMetricsEnabled(),
    );
    if (args.length > 0) {
      args[0] = handlerArgs;
    }

    const format = handlerArgs && typeof handlerArgs === "object" ? handlerArgs.format : undefined;
    const detail = handlerArgs && typeof handlerArgs === "object" ? handlerArgs.detail : undefined;

    let result: any;
    let isError = false;

    try {
      result = await handler(...args);
      isError = result?.isError === true;
    } catch (err: any) {
      isError = true;
      metrics.record(name, Date.now() - start, 0, true, { format, detail });
      const wrappedErr = err instanceof Error ? err : new Error(String(err));
      wrappedErr.message = `[${name}] ${wrappedErr.message}`;
      throw wrappedErr;
    }

    const durationMs = Date.now() - start;
    const responseChars = responseContentCharCount(result?.content);

    metrics.record(name, durationMs, responseChars, isError, { format, detail });
    try {
      console.error(
        `[telemetry] tool=${name} format=${normalizeMetricDimension(format)} detail=${normalizeMetricDimension(detail)} responseBytes=${responseChars} approxTokens=${Math.round(responseChars / 4)}`,
      );
    } catch {
      /* telemetry must never break a response */
    }

    const bulkMetrics = result?._mcpBulkMetrics as
      | { rowsReturned: number; wasTruncated: boolean }
      | undefined;
    if (bulkMetrics && result && typeof result === "object") {
      const { _mcpBulkMetrics: _, ...rest } = result;
      result = rest;
    }

    if (includeCallMetrics && result) {
      const payload = buildCallMetricsPayload(
        name,
        durationMs,
        responseChars,
        format,
        detail,
        bulkMetrics,
      );
      const footer = formatCallMetricsFooter(payload);
      result = appendCallMetricsFooter(result, footer);
    }

    return result;
  };
  return wrapped as T;
}
