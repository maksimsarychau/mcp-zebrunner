/**
 * Shared parsing for Zebrunner test-case references (URLs, keys, numeric ids).
 * Additive only — plain keys and ids pass through unchanged for legacy callers.
 */

export type TestCaseRefSource =
  | "url_caseId"
  | "url_caseKey"
  | "url_path"
  | "plain_key"
  | "plain_id"
  | "passthrough";

export type ParsedTestCaseRef = {
  projectKey: string;
  caseKey?: string;
  caseId?: string;
  lookupKey: string;
  host?: string;
  source: TestCaseRefSource;
};

export type NormalizeResult = ParsedTestCaseRef & {
  hostMismatchWarning?: string;
};

const PLAIN_KEY_RE = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

export function isUrlLikeTestCaseInput(input: string): boolean {
  const t = input.trim();
  return t.includes("://") || /\/projects\/[^/]+\/test-cases/i.test(t);
}

function hostnameFromWebUrl(webUrl: string): string | undefined {
  try {
    return new URL(webUrl.startsWith("http") ? webUrl : `https://${webUrl}`).hostname;
  } catch {
    return undefined;
  }
}

export function formatHostMismatchWarning(urlHost: string, configHost: string): string {
  return `⚠️ URL host (${urlHost}) differs from configured Zebrunner web URL (${configHost}). Parsed reference anyway.`;
}

export function buildTestCaseWebUrl(
  baseWebUrl: string,
  projectKey: string,
  ref: { id?: number | string; key?: string },
): string {
  const base = baseWebUrl.replace(/\/+$/, "");
  if (ref.id != null && String(ref.id).length > 0) {
    return `${base}/projects/${projectKey}/test-cases?caseId=${ref.id}`;
  }
  if (ref.key) {
    return `${base}/projects/${projectKey}/test-cases?caseKey=${encodeURIComponent(ref.key)}`;
  }
  throw new Error("buildTestCaseWebUrl requires id or key");
}

export function lookupUsesNumericId(ref: Pick<NormalizeResult, "source">): boolean {
  return ref.source === "plain_id" || ref.source === "url_caseId" || ref.source === "url_path";
}

export function parseZebrunnerTestCaseRef(input: string): ParsedTestCaseRef | null {
  const trimmed = input.trim();
  if (!trimmed || !isUrlLikeTestCaseInput(trimmed)) return null;

  let url: URL;
  try {
    url = trimmed.startsWith("/")
      ? new URL(trimmed, "https://zebrunner.local")
      : new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname !== "zebrunner.local" ? url.hostname : undefined;
  const pathProjectMatch = url.pathname.match(/\/projects\/([^/]+)\/test-cases(?:\/(\d+))?/i);
  const projectFromPath = pathProjectMatch?.[1];
  const idFromPath = pathProjectMatch?.[2];

  const caseIdParam = url.searchParams.get("caseId") ?? url.searchParams.get("caseid");
  const caseKeyParam = url.searchParams.get("caseKey") ?? url.searchParams.get("casekey");

  if (caseIdParam && /^\d+$/.test(caseIdParam)) {
    const projectKey = projectFromPath ?? "";
    return {
      projectKey,
      caseId: caseIdParam,
      lookupKey: caseIdParam,
      host,
      source: "url_caseId",
    };
  }

  if (caseKeyParam) {
    const decoded = decodeURIComponent(caseKeyParam).trim();
    const keyMatch = decoded.match(PLAIN_KEY_RE);
    const projectKey = projectFromPath ?? keyMatch?.[1] ?? "";
    return {
      projectKey,
      caseKey: decoded,
      lookupKey: decoded,
      host,
      source: "url_caseKey",
    };
  }

  if (idFromPath && /^\d+$/.test(idFromPath) && projectFromPath) {
    return {
      projectKey: projectFromPath,
      caseId: idFromPath,
      lookupKey: idFromPath,
      host,
      source: "url_path",
    };
  }

  return null;
}

export function normalizeTestCaseInput(
  input: string,
  options?: { projectKeyHint?: string; configuredWebUrl?: string },
): NormalizeResult {
  const trimmed = input.trim();
  const hint = options?.projectKeyHint?.trim();

  if (!trimmed) {
    return {
      projectKey: hint ?? "",
      lookupKey: "",
      source: "passthrough",
    };
  }

  const parsed = parseZebrunnerTestCaseRef(trimmed);
  if (parsed) {
    const projectKey = parsed.projectKey || hint || "";
    let hostMismatchWarning: string | undefined;
    if (parsed.host && options?.configuredWebUrl) {
      const configHost = hostnameFromWebUrl(options.configuredWebUrl);
      if (configHost && parsed.host.toLowerCase() !== configHost.toLowerCase()) {
        hostMismatchWarning = formatHostMismatchWarning(parsed.host, configHost);
      }
    }
    return { ...parsed, projectKey, hostMismatchWarning };
  }

  const keyMatch = trimmed.match(PLAIN_KEY_RE);
  if (keyMatch) {
    return {
      projectKey: keyMatch[1],
      caseKey: trimmed,
      lookupKey: trimmed,
      source: "plain_key",
    };
  }

  if (/^\d+$/.test(trimmed)) {
    return {
      projectKey: hint ?? "",
      caseId: trimmed,
      lookupKey: trimmed,
      source: "plain_id",
    };
  }

  return {
    projectKey: hint ?? "",
    lookupKey: trimmed,
    source: "passthrough",
  };
}

export function prependHostWarning(text: string, warning?: string): string {
  if (!warning) return text;
  return `${warning}\n\n${text}`;
}

export type TestCaseFetchClient = {
  getTestCaseByKey: (
    projectKey: string,
    key: string,
    opts?: { includeSuiteHierarchy?: boolean },
  ) => Promise<unknown>;
  getTestCaseById: (
    projectKey: string,
    id: number,
    opts?: { includeSuiteHierarchy?: boolean },
  ) => Promise<unknown>;
};

export async function fetchTestCaseByNormalizedInput<T>(
  client: TestCaseFetchClient,
  normalized: NormalizeResult,
  projectKeyFallback: string,
  opts?: { includeSuiteHierarchy?: boolean },
): Promise<T | null> {
  const projectKey = normalized.projectKey || projectKeyFallback;
  if (!projectKey) {
    throw new Error("project_key is required");
  }
  if (lookupUsesNumericId(normalized)) {
    return (await client.getTestCaseById(
      projectKey,
      parseInt(normalized.lookupKey, 10),
      opts,
    )) as T | null;
  }
  return (await client.getTestCaseByKey(projectKey, normalized.lookupKey, opts)) as T | null;
}
