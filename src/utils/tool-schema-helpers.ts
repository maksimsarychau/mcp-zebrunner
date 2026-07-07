import { z } from "zod";

/** Shared data-family format values (TCM reads). */
export const DATA_FORMAT_ENUM = z.enum(["dto", "json", "compact", "string", "markdown"]);

/** Launch / widget raw vs formatted vs compact. */
export const RAW_FORMATTED_COMPACT_ENUM = z.enum(["raw", "formatted", "compact"]);

const CALL_METRICS_FIELD = {
  include_call_metrics: z
    .boolean()
    .optional()
    .describe(
      "Append per-call metrics (duration, response size, format, detail) to this response.",
    ),
};

/** Add optional include_call_metrics to every tool input schema. */
export function withCallMetricsSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;

  if (
    "extend" in schema &&
    typeof (schema as z.ZodObject<z.ZodRawShape>).extend === "function"
  ) {
    return (schema as z.ZodObject<z.ZodRawShape>).extend(CALL_METRICS_FIELD);
  }

  // MCP registerTool uses a raw shape object { field: z.*, ... }, not z.object().
  if (!(schema instanceof z.ZodType)) {
    return { ...(schema as Record<string, unknown>), ...CALL_METRICS_FIELD };
  }

  return schema;
}
