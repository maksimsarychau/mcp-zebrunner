export interface FieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

/**
 * Returns only fields whose values changed between `before` and `after`.
 * Compares using JSON serialisation to handle nested objects.
 * Handles optional, missing, and extra fields gracefully.
 */
export function computeDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldDiff[] {
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: FieldDiff[] = [];

  for (const key of allKeys) {
    const beforeVal = before[key];
    const afterVal = after[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      diffs.push({ field: key, before: beforeVal, after: afterVal });
    }
  }

  return diffs;
}

/**
 * Formats a diff array into a human-readable string for tool responses.
 */
export function formatDiff(diffs: FieldDiff[]): string {
  if (diffs.length === 0) return "No fields changed.";
  return diffs
    .map(
      (d) =>
        `  ${d.field}: ${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`,
    )
    .join("\n");
}
