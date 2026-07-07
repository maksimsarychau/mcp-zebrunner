/** Per-call metrics surfaced to LLMs (opt-in footer on tool responses). */

export interface CallMetricsPayload {
  tool: string;
  durationMs: number;
  responseChars: number;
  approxTokens: number;
  format: string;
  detail: string;
}

export function normalizeMetricDimension(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

export function buildCallMetricsPayload(
  tool: string,
  durationMs: number,
  responseChars: number,
  format?: unknown,
  detail?: unknown,
): CallMetricsPayload {
  return {
    tool,
    durationMs,
    responseChars,
    approxTokens: Math.round(responseChars / 4),
    format: normalizeMetricDimension(format),
    detail: normalizeMetricDimension(detail),
  };
}

export function formatCallMetricsFooter(payload: CallMetricsPayload): string {
  return `_mcp_metrics: ${JSON.stringify(payload)}`;
}

export function responseContentCharCount(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.reduce(
    (sum: number, block: unknown) =>
      sum +
      (typeof (block as { text?: string })?.text === "string"
        ? (block as { text: string }).text.length
        : 0),
    0,
  );
}

export function appendCallMetricsFooter(
  result: { content?: Array<{ type: string; text?: string }> },
  footer: string,
): typeof result {
  if (!result?.content || result.content.length === 0) {
    return { ...result, content: [{ type: "text", text: footer }] };
  }

  const content = [...result.content];
  let lastTextIdx = -1;
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i]?.type === "text" && typeof content[i].text === "string") {
      lastTextIdx = i;
      break;
    }
  }

  if (lastTextIdx >= 0) {
    const block = content[lastTextIdx];
    content[lastTextIdx] = { ...block, text: `${block.text}\n\n${footer}` };
  } else {
    content.push({ type: "text", text: footer });
  }

  return { ...result, content };
}

/** Strip include_call_metrics before handler / API; return flag for footer. */
export function stripCallMetricsArg<T extends Record<string, unknown> | undefined>(
  args: T,
  inlineMetricsEnv: boolean,
): { handlerArgs: T; includeCallMetrics: boolean } {
  if (!args || typeof args !== "object") {
    return { handlerArgs: args, includeCallMetrics: inlineMetricsEnv };
  }
  const { include_call_metrics, ...rest } = args as T & { include_call_metrics?: boolean };
  const includeCallMetrics =
    include_call_metrics === true || inlineMetricsEnv;
  return { handlerArgs: rest as T, includeCallMetrics };
}
