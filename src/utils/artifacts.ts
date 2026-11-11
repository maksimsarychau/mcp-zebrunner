/**
 * Artifact utilities: classification, collection, redaction, output-path
 * allow-list and size limits for Zebrunner test / launch artifacts.
 *
 * Artifact value formats produced by the Zebrunner agents:
 *   - file      -> "/files/<uuid>"            (uploaded via Artifact.attachToTest / attachToTestRun)
 *   - reference -> "https://..." full URL    (Artifact.attachReferenceToTest / attachReferenceToTestRun)
 *
 * Security rules implemented here (and covered by unit tests):
 *   - credentials / Authorization headers are never part of any returned value
 *   - signed query parameters on reference links are masked
 *   - saving to disk is restricted to an allow-listed directory set
 *   - size limits are enforced before bytes are returned or written
 */
import { isAbsolute, join, resolve, sep, basename, delimiter } from "node:path";
import { realpathSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

/** Single place for the Public API version path used by the files endpoints (never v2/v3). */
export const PUBLIC_API_VERSION_PATH = "/api/public/v1";

/** Default byte limit for content returned inline to the model (1 MiB). */
export const DEFAULT_RETURN_MAX_BYTES = 1024 * 1024;
/** Hard cap for content returned inline, regardless of what the caller asks for. */
export const MAX_RETURN_BYTES_CAP = 10 * 1024 * 1024;
/** Hard cap for files saved to disk (10 MiB). Larger files are refused. */
export const MAX_SAVE_BYTES = 10 * 1024 * 1024;

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ArtifactKind = "file" | "reference";
export type ArtifactScope = "test" | "launch";

export interface RawArtifact {
  name: string;
  value: string;
}

export interface ArtifactItem {
  name: string;
  kind: ArtifactKind;
  scope: ArtifactScope;
  /** File uuid (kind === "file"). */
  uuid?: string;
  /** Link with sensitive query parameters masked (kind === "reference"). */
  url?: string;
  testId?: number;
  testName?: string;
  /** Filled in when metadata was requested. */
  contentType?: string;
  sizeInBytes?: number;
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

/** Extract a file uuid from "/files/<uuid>", "https://host/files/<uuid>" or a bare uuid. */
export function extractFileUuid(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (isValidUuid(trimmed)) return trimmed.toLowerCase();
  const m = /\/files\/([^/?#\s]+)/i.exec(trimmed);
  if (m && isValidUuid(m[1])) return m[1].toLowerCase();
  return undefined;
}

/** Classify an artifact value as an uploaded file or an external reference. */
export function classifyArtifact(artifact: RawArtifact): { kind: ArtifactKind; uuid?: string; url?: string } {
  const value = (artifact.value ?? "").trim();
  if (/^https?:\/\//i.test(value)) {
    // Absolute URL pointing at this workspace's /files/<uuid> is still a file.
    const uuid = /\/files\/[0-9a-f-]{36}(?:[/?#]|$)/i.test(value) ? extractFileUuid(value) : undefined;
    if (uuid) return { kind: "file", uuid };
    return { kind: "reference", url: maskSensitiveUrl(value) };
  }
  const uuid = extractFileUuid(value);
  if (uuid) return { kind: "file", uuid };
  // Unknown shape: treat as a reference so it is still visible, never as a downloadable file.
  return { kind: "reference", url: maskSensitiveUrl(value) };
}

const SENSITIVE_QUERY_KEY = /^(x-amz-(signature|credential|security-token)|signature|sig|token|access_token|api[_-]?key|key|password|secret|x-goog-signature|x-goog-credential)$/i;

/** Mask signed / secret-bearing query parameters on a link; keeps host + path + harmless params. */
export function maskSensitiveUrl(raw: string): string {
  try {
    const url = new URL(raw);
    let masked = false;
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        url.searchParams.set(key, "REDACTED");
        masked = true;
      }
    }
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      masked = true;
    }
    return masked ? url.toString() : raw;
  } catch {
    return raw;
  }
}

function toItem(raw: RawArtifact, scope: ArtifactScope, test?: { id?: number; name?: string }): ArtifactItem | null {
  if (!raw || typeof raw.name !== "string" || typeof raw.value !== "string") return null;
  const c = classifyArtifact(raw);
  const item: ArtifactItem = { name: raw.name, kind: c.kind, scope };
  if (c.uuid) item.uuid = c.uuid;
  if (c.url) item.url = c.url;
  if (test?.id !== undefined) item.testId = test.id;
  if (test?.name) item.testName = test.name;
  return item;
}

export interface CollectArtifactsOptions {
  launchArtifacts?: RawArtifact[];
  tests?: Array<{ id: number; name?: string; artifacts?: RawArtifact[] | any[] }>;
  testId?: number;
  kind?: ArtifactKind | "all";
  nameContains?: string;
  includeLaunchLevel?: boolean;
}

/** Collect, classify and filter artifacts from a launch response and its tests. Pure function. */
export function collectArtifacts(opts: CollectArtifactsOptions): ArtifactItem[] {
  const items: ArtifactItem[] = [];
  const needle = opts.nameContains?.toLowerCase();

  if (opts.includeLaunchLevel !== false) {
    for (const a of opts.launchArtifacts ?? []) {
      const item = toItem(a, "launch");
      if (item) items.push(item);
    }
  }

  for (const t of opts.tests ?? []) {
    if (opts.testId !== undefined && t.id !== opts.testId) continue;
    for (const a of (t.artifacts ?? []) as RawArtifact[]) {
      const item = toItem(a, "test", t);
      if (item) items.push(item);
    }
  }

  return items.filter((i) => {
    if (opts.kind && opts.kind !== "all" && i.kind !== opts.kind) return false;
    if (needle && !i.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export interface CompactArtifactSummary {
  count: number;
  files: number;
  links: number;
  /** Artifact names (capped) - use adv_list_test_artifacts for uuids and links. */
  names: string[];
}

/** Compact summary used by opt-in rollout in launch/bug/flaky tools. Pure function. */
export function compactArtifactSummary(raw: unknown, maxNames = 10): CompactArtifactSummary {
  const items = collectArtifacts({ tests: [{ id: 0, artifacts: Array.isArray(raw) ? (raw as RawArtifact[]) : [] }], includeLaunchLevel: false });
  return {
    count: items.length,
    files: items.filter((i) => i.kind === "file").length,
    links: items.filter((i) => i.kind === "reference").length,
    names: items.slice(0, maxNames).map((i) => i.name),
  };
}

// ───────────────────────── content type helpers ─────────────────────────

const TEXT_EXT = /\.(xml|txt|log|json|html?|csv|yml|yaml|md|properties|ini|trace|logcat|har|svg)$/i;

export function isImageContentType(contentType: string | undefined | null): boolean {
  return !!contentType && /^image\/(png|jpe?g|gif|webp|bmp|tiff)/i.test(contentType.trim());
}

/** True for content we can safely return as text (xml, json, text/*, logs, ...). */
export function isTextualContent(contentType: string | undefined | null, name?: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.startsWith("text/")) return true;
  if (/(json|xml|yaml|javascript|x-www-form|csv|html|x-log)/.test(ct)) return true;
  if (!ct || ct === "application/octet-stream") return !!name && TEXT_EXT.test(name);
  return false;
}

export function isXmlLike(contentType: string | undefined | null, name?: string): boolean {
  return /xml/i.test(contentType ?? "") || /\.xml$/i.test(name ?? "");
}

// ───────────────────────────── redaction ─────────────────────────────

export interface RedactionResult {
  text: string;
  /** Number of emails and password nodes masked. */
  redactions: number;
}

const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Mask personal / secret data in text artifacts (page sources, logs):
 *  - email addresses
 *  - the text/value of password nodes (Android `password="true"`, iOS SecureTextField)
 */
export function redactSensitiveText(input: string): RedactionResult {
  let redactions = 0;

  // 1) Password nodes: operate per XML tag so only the matching element is touched.
  let text = input.replace(/<[^<>]*>/g, (tag) => {
    const isPasswordNode =
      /\bpassword\s*=\s*["']true["']/i.test(tag) || /XCUIElementTypeSecureTextField/i.test(tag);
    if (!isPasswordNode) return tag;
    return tag.replace(/\b(text|value|content-desc|label)\s*=\s*"([^"]*)"/gi, (m, attr: string, val: string) => {
      if (val === "" || val === "[REDACTED]") return m;
      redactions++;
      return `${attr}="[REDACTED]"`;
    });
  });

  // 2) Emails anywhere.
  text = text.replace(EMAIL_REGEX, () => {
    redactions++;
    return "[REDACTED_EMAIL]";
  });

  return { text, redactions };
}

// ──────────────────────── output path allow-list ────────────────────────

export class ArtifactPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactPathError";
  }
}

/** Default directory for saved artifacts: os.tmpdir()/zebrunner-artifacts */
export function getDefaultArtifactDir(): string {
  return join(tmpdir(), "zebrunner-artifacts");
}

/** Allowed output roots: default dir + ZEBRUNNER_ARTIFACT_DIRS (path-delimiter or comma separated). */
export function getAllowedArtifactDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = [getDefaultArtifactDir()];
  const extra = (env.ZEBRUNNER_ARTIFACT_DIRS ?? "")
    .split(new RegExp(`[,${delimiter}]`))
    .map((d) => d.trim())
    .filter(Boolean);
  for (const d of extra) {
    if (isAbsolute(d)) dirs.push(resolve(d));
  }
  return dirs;
}

function realpathOfExistingAncestor(p: string): string {
  let current = resolve(p);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = resolve(current, "..");
    if (parent === current) break;
    tail.unshift(basename(current));
    current = parent;
  }
  let real = current;
  try {
    real = realpathSync(current);
  } catch {
    /* keep unresolved */
  }
  return tail.length ? join(real, ...tail) : real;
}

function isInside(root: string, candidate: string): boolean {
  const r = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(r);
}

/** Make a file name safe to use on disk. */
export function safeFileName(name: string, fallback = "artifact"): string {
  const base = basename((name ?? "").replace(/\\/g, "/")).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "");
  return base.slice(0, 120) || fallback;
}

/**
 * Resolve and validate an output path.
 * - relative paths are placed under the default artifact dir
 * - absolute paths must be inside an allowed root (symlinks resolved)
 * - a trailing separator / existing directory means "save here under the artifact's own file name"
 */
export function resolveOutputPath(
  outputPath: string | undefined,
  fileName: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { excludeDefaultDir?: boolean } = {},
): string {
  const defaultDir = getDefaultArtifactDir();
  const roots = getAllowedArtifactDirs(env).filter((d) => !(options.excludeDefaultDir && d === defaultDir));
  const allowed = roots.map((d) => realpathOfExistingAncestor(d));

  if (options.excludeDefaultDir && (!outputPath || !outputPath.trim() || !isAbsolute(outputPath.trim()))) {
    throw new ArtifactPathError(
      `The default artifact folder ${defaultDir} is not safe to use; pass an absolute outputPath inside ZEBRUNNER_ARTIFACT_DIRS.`,
    );
  }

  let target: string;
  if (!outputPath || !outputPath.trim()) {
    target = join(defaultDir, safeFileName(fileName));
  } else {
    const trimmed = outputPath.trim();
    if (trimmed.includes("\0")) throw new ArtifactPathError("outputPath contains invalid characters.");
    const wantsDir = trimmed.endsWith("/") || trimmed.endsWith("\\");
    const abs = isAbsolute(trimmed) ? resolve(trimmed) : resolve(defaultDir, trimmed);
    target = wantsDir ? join(abs, safeFileName(fileName)) : abs;
  }

  const real = realpathOfExistingAncestor(target);
  if (!allowed.some((root) => isInside(root, real))) {
    throw new ArtifactPathError(
      `outputPath is outside the allowed directories. Allowed roots: ${roots.join(", ") || "(none)"}. ` +
        `Set ZEBRUNNER_ARTIFACT_DIRS (absolute paths, "${delimiter}" separated) to allow additional folders.`,
    );
  }

  // If target is an existing directory, place the file inside it.
  if (isExistingDirectory(real)) {
    return join(real, safeFileName(fileName));
  }
  return real;
}

function isExistingDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ───────────────────────────── size limits ─────────────────────────────

export class ArtifactTooLargeError extends Error {
  constructor(
    public readonly sizeInBytes: number,
    public readonly limitInBytes: number,
    purpose: "return" | "save",
  ) {
    super(
      `Artifact is ${sizeInBytes} bytes, which exceeds the ${purpose} limit of ${limitInBytes} bytes. ` +
        (purpose === "return"
          ? "Use outputPath to save it to disk (up to 10 MiB) or raise maxBytes (capped at 10 MiB)."
          : "Files above 10 MiB are refused; download it from the Zebrunner UI instead."),
    );
    this.name = "ArtifactTooLargeError";
  }
}

export function clampReturnBytes(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return DEFAULT_RETURN_MAX_BYTES;
  return Math.min(Math.floor(requested), MAX_RETURN_BYTES_CAP);
}

/** Pick the byte limit that applies for the requested delivery mode. */
export function effectiveLimit(opts: { save: boolean; maxBytes?: number }): number {
  if (opts.save) return MAX_SAVE_BYTES;
  return clampReturnBytes(opts.maxBytes);
}

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "unknown size";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}
