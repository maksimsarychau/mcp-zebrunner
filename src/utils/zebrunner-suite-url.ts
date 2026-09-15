export type ParsedSuiteUrl = {
  projectKey: string;
  suiteId: number;
  host?: string;
};

const SUITE_PATH_RE = /\/projects\/([^/]+)\/test-cases\/?$/i;

export function parseZebrunnerSuiteUrl(input: string): ParsedSuiteUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = trimmed.startsWith("/")
      ? new URL(trimmed, "https://zebrunner.local")
      : new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (!SUITE_PATH_RE.test(url.pathname)) {
    return null;
  }

  const projectMatch = url.pathname.match(/\/projects\/([^/]+)\/test-cases/i);
  const projectKey = projectMatch?.[1]?.trim();
  if (!projectKey) return null;

  const suiteIdParam = url.searchParams.get("suiteId") ?? url.searchParams.get("suiteid");
  if (!suiteIdParam || !/^\d+$/.test(suiteIdParam)) {
    return null;
  }

  const suiteId = parseInt(suiteIdParam, 10);
  if (!Number.isFinite(suiteId) || suiteId <= 0) return null;

  const host = url.hostname !== "zebrunner.local" ? url.hostname : undefined;

  return { projectKey, suiteId, host };
}

export function buildZebrunnerSuiteUrl(
  baseWebUrl: string,
  projectKey: string,
  suiteId: number,
): string {
  const base = baseWebUrl.replace(/\/+$/, "");
  return `${base}/projects/${projectKey}/test-cases?suiteId=${suiteId}`;
}
