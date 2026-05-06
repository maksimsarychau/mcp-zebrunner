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

export class ToolMetrics {
  private stats = new Map<string, ToolStats>();

  record(name: string, durationMs: number, responseChars: number, isError: boolean): void {
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
  }

  getStats(): Map<string, ToolStats> {
    return this.stats;
  }

  getSummaryMarkdown(): string {
    if (this.stats.size === 0) {
      return "No tool calls recorded in this session.";
    }

    const entries = [...this.stats.entries()].sort(
      (a, b) => b[1].callCount - a[1].callCount
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
        `| ${name} | ${s.callCount} | ${Math.round(s.avgDurationMs)} | ${Math.round(s.minDurationMs)} | ${Math.round(s.maxDurationMs)} | ${s.totalResponseChars.toLocaleString()} | ${s.errorCount} |`
      );
    }

    return lines.join("\n");
  }

  reset(): void {
    this.stats.clear();
  }
}

export function wrapToolHandler<T extends (...args: any[]) => any>(
  name: string,
  handler: T,
  metrics: ToolMetrics
): T {
  const wrapped = async (...args: any[]) => {
    const start = Date.now();
    let result: any;
    let isError = false;

    try {
      result = await handler(...args);
      isError = result?.isError === true;
    } catch (err: any) {
      isError = true;
      metrics.record(name, Date.now() - start, 0, true);
      const wrapped = err instanceof Error ? err : new Error(String(err));
      wrapped.message = `[${name}] ${wrapped.message}`;
      throw wrapped;
    }

    const content = result?.content;
    const responseChars = Array.isArray(content)
      ? content.reduce((sum: number, block: any) => sum + (typeof block?.text === "string" ? block.text.length : 0), 0)
      : 0;

    metrics.record(name, Date.now() - start, responseChars, isError);
    return result;
  };
  return wrapped as T;
}
