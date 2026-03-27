/**
 * Generic field-path filtering for Zebrunner test cases.
 *
 * Supports dot-notation paths for any field depth:
 *   - Top-level: "title", "key", "deprecated", "draft"
 *   - Nested:    "priority.name", "automationState.name", "testSuite.id"
 *   - User:      "createdBy.username", "lastModifiedBy.email"
 *   - Custom:    "customField.manualOnly", "customField.caseStatus"
 *
 * Custom field keys vary between projects — the resolver tries multiple
 * case variants (camelCase, snake_case, PascalCase, case-insensitive).
 *
 * SAFETY: Every function is defensive against null, undefined, missing fields,
 * unexpected types, and malformed objects. A single bad item in a batch never
 * crashes the whole filter — it is silently excluded.
 */

export type FieldMatchMode = "exact" | "contains" | "regex" | "exists";

export interface FieldFilter {
  fieldPath: string;
  fieldValue?: string;
  matchMode: FieldMatchMode;
}

/**
 * Resolve a dot-notation path to a value inside an object.
 * Returns undefined for any missing/null intermediate segment.
 */
export function resolveFieldPath(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined || typeof obj !== "object") return undefined;
  if (!path || typeof path !== "string") return undefined;

  const segments = path.split(".");
  let current: unknown = obj;

  for (let i = 0; i < segments.length; i++) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    if (Array.isArray(current)) return undefined;

    const segment = segments[i];
    if (!segment) return undefined;

    const record = current as Record<string, unknown>;

    if (segment in record) {
      current = record[segment];
      continue;
    }

    const resolved = fuzzyResolveKey(record, segment);
    if (resolved !== undefined) {
      current = record[resolved];
      continue;
    }

    return undefined;
  }

  return current;
}

/**
 * Try multiple case variants to resolve a key in a record:
 *   camelCase, snake_case, PascalCase, and case-insensitive match.
 */
function fuzzyResolveKey(record: Record<string, unknown>, displayName: string): string | undefined {
  if (!displayName) return undefined;

  try {
    const words = displayName.replace(/[^a-zA-Z0-9 _-]/g, "").split(/[\s_-]+/).filter(Boolean);

    if (words.length > 1) {
      const camelCase = words
        .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1).toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
        .join("");
      if (camelCase in record) return camelCase;

      const snakeCase = words.map((w) => w.toLowerCase()).join("_");
      if (snakeCase in record) return snakeCase;

      const pascalCase = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("");
      if (pascalCase in record) return pascalCase;
    }

    const lower = displayName.toLowerCase();
    for (const key of Object.keys(record)) {
      if (key.toLowerCase() === lower) return key;
    }
  } catch {
    // Defensive: never crash on weird input
  }

  return undefined;
}

/**
 * Test whether a single object matches a field filter.
 * Always returns false (never throws) for null/undefined/malformed objects.
 */
export function matchesField(
  obj: unknown,
  filter: FieldFilter
): boolean {
  try {
    if (obj === null || obj === undefined || typeof obj !== "object") return false;
    if (!filter || !filter.fieldPath) return false;

    const rawValue = resolveFieldPath(obj, filter.fieldPath);

    if (filter.matchMode === "exists") {
      return rawValue !== undefined && rawValue !== null;
    }

    if (rawValue === undefined || rawValue === null) return false;

    // Coerce to string safely — handles numbers, booleans, nested objects
    let strValue: string;
    if (typeof rawValue === "string") {
      strValue = rawValue;
    } else if (typeof rawValue === "number" || typeof rawValue === "boolean") {
      strValue = String(rawValue);
    } else {
      // Objects/arrays — stringify for matching but don't crash
      try {
        strValue = JSON.stringify(rawValue);
      } catch {
        return false;
      }
    }

    const target = filter.fieldValue ?? "";

    switch (filter.matchMode) {
      case "exact":
        return strValue.toLowerCase() === target.toLowerCase();
      case "contains":
        return strValue.toLowerCase().includes(target.toLowerCase());
      case "regex": {
        try {
          return new RegExp(target, "i").test(strValue);
        } catch {
          return strValue.toLowerCase().includes(target.toLowerCase());
        }
      }
      default:
        return false;
    }
  } catch {
    // Absolute last line of defense — never throw from a filter predicate
    return false;
  }
}

/**
 * Filter an array of objects by a field filter.
 * Skips null/undefined/non-object items silently.
 */
export function filterByField<T>(
  items: T[],
  filter: FieldFilter
): T[] {
  if (!Array.isArray(items)) return [];
  if (!filter || !filter.fieldPath) return [];

  return items.filter((item) => {
    if (item === null || item === undefined) return false;
    return matchesField(item as Record<string, unknown>, filter);
  });
}

/**
 * List all available field paths on an object for discovery.
 * Walks recursively up to maxDepth levels. Safe against cycles and nulls.
 */
export function discoverFieldPaths(
  obj: unknown,
  prefix = "",
  depth = 0,
  maxDepth = 3
): string[] {
  if (depth >= maxDepth) return [];
  if (obj === null || obj === undefined || typeof obj !== "object" || Array.isArray(obj)) return [];

  const paths: string[] = [];

  try {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      paths.push(fullPath);

      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        paths.push(...discoverFieldPaths(value, fullPath, depth + 1, maxDepth));
      }
    }
  } catch {
    // Defensive against non-enumerable or proxy objects
  }

  return paths;
}
