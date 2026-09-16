/**
 * Public API test-run create/update payload helpers (Zebrunner environment contract).
 */

export type EnvironmentRefInput = {
  id?: number;
  name?: string;
  key?: string;
};

export type EnvironmentCatalogItem = {
  id: number;
  name: string;
  description?: string | null;
};

export type ResolvedEnvironmentRef = {
  ref: { id: number } | { name: string };
  matchedBy:
    | "id"
    | "name_exact"
    | "legacy_key_exact"
    | "name_case_insensitive"
    | "legacy_key_case_insensitive"
    | "passthrough_name"
    | "passthrough_legacy_key";
  requestedLabel?: string;
  canonicalName?: string;
};

/** Normalize for case-insensitive environment name matching (NFKC + collapsed whitespace). */
export function normalizeEnvironmentLabel(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLowerCase();
}

export function usedLegacyEnvironmentKey(input: EnvironmentRefInput): boolean {
  return (
    input.key !== undefined &&
    input.key.length > 0 &&
    input.id === undefined &&
    (input.name === undefined || input.name.length === 0)
  );
}

/**
 * Resolve tool/skill input to Public API `{ id }` or `{ name }` (never `key` on the wire).
 * When `catalog` is provided, matches names case-insensitively and returns canonical `name`.
 */
export function resolveEnvironmentForPublicApi(
  input: EnvironmentRefInput,
  catalog?: EnvironmentCatalogItem[],
): ResolvedEnvironmentRef {
  if (input.id !== undefined) {
    const hit = catalog?.find((e) => e.id === input.id);
    return {
      ref: { id: input.id },
      matchedBy: "id",
      canonicalName: hit?.name,
    };
  }

  const raw = (input.name ?? input.key)?.trim();
  if (!raw) {
    throw new Error("environment requires { id }, { name }, or legacy { key }");
  }

  const isLegacyKey = usedLegacyEnvironmentKey(input);

  if (catalog && catalog.length > 0) {
    const exact = catalog.find((e) => e.name === raw);
    if (exact) {
      return {
        ref: { name: exact.name },
        matchedBy: isLegacyKey ? "legacy_key_exact" : "name_exact",
        canonicalName: exact.name,
        requestedLabel: raw,
      };
    }

    const norm = normalizeEnvironmentLabel(raw);
    const ci = catalog.find((e) => normalizeEnvironmentLabel(e.name) === norm);
    if (ci) {
      return {
        ref: { name: ci.name },
        matchedBy: isLegacyKey ? "legacy_key_case_insensitive" : "name_case_insensitive",
        canonicalName: ci.name,
        requestedLabel: raw,
      };
    }
  }

  return {
    ref: { name: raw },
    matchedBy: isLegacyKey ? "passthrough_legacy_key" : "passthrough_name",
    requestedLabel: raw,
  };
}

/** Outbound environment reference (no catalog). Prefer `resolveEnvironmentForPublicApi` when catalog is available. */
export function environmentRefForPublicApi(
  input: EnvironmentRefInput,
): { id: number } | { name: string } {
  return resolveEnvironmentForPublicApi(input).ref;
}

export function environmentResolutionPreviewLines(resolved: ResolvedEnvironmentRef): string[] {
  const lines: string[] = [`  environment      → ${JSON.stringify(resolved.ref)}`];

  if (
    resolved.matchedBy === "legacy_key_exact" ||
    resolved.matchedBy === "legacy_key_case_insensitive" ||
    resolved.matchedBy === "passthrough_legacy_key"
  ) {
    lines.push(
      "  ℹ Legacy environment.key mapped to environment.name in API payload — value must match a project environment name.",
    );
  }

  if (
    resolved.matchedBy === "name_case_insensitive" ||
    resolved.matchedBy === "legacy_key_case_insensitive"
  ) {
    lines.push(
      `  ℹ Resolved "${resolved.requestedLabel}" → canonical name "${resolved.canonicalName}" (case-insensitive catalog match).`,
    );
  }

  return lines;
}
