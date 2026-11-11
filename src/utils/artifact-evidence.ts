/**
 * Artifact evidence shared by all failure / results analysis tools.
 *
 * Responsibilities:
 *   - list the artifacts attached to a test (names come from the Reporting API test payload, no extra calls)
 *   - optionally fetch the failure page source (Public API v1 /files/{uuid}) and extract compact "signals"
 *   - diff signals between a failed and a last-passed execution
 *   - render markdown / Jira blocks and refine error classification
 *
 * Contract: NOTHING here throws into the analysis. Every failure becomes a warning string so the
 * analysis output is identical to the "no evidence" output plus (at most) one warning line.
 */
import type { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import {
  collectArtifacts,
  isValidUuid,
  redactSensitiveText,
  type ArtifactItem,
  type RawArtifact,
} from "./artifacts.js";

/** Max bytes of a page source fetched for analysis. */
export const PAGE_SOURCE_MAX_BYTES = 1024 * 1024;

/** Cost control: max page sources fetched per analysis call (env ARTIFACT_EVIDENCE_MAX_FILES, default 10). */
export function getEvidenceMaxFiles(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.ARTIFACT_EVIDENCE_MAX_FILES ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Simple shared budget so bulk analyses cap the number of downloads. */
export class EvidenceBudget {
  private remaining: number;
  constructor(max: number = getEvidenceMaxFiles()) {
    this.remaining = max;
  }
  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  }
  get left(): number {
    return this.remaining;
  }
}

// ───────────────────────────── signals ─────────────────────────────

export interface LocatorCheck {
  /** Candidates extracted from the failing error message. */
  checked: string[];
  found: string[];
  missing: string[];
}

export interface PageSourceSignals {
  platform: "android" | "ios" | "unknown";
  nodeCount: number;
  topPackage?: string;
  crashDialog: boolean;
  anrDialog: boolean;
  dialogTexts: string[];
  permissionDialog: boolean;
  keyboardVisible: boolean;
  loadingIndicator: boolean;
  toasts: string[];
  emptyState: boolean;
  locator?: LocatorCheck;
}

interface ParsedNode {
  tag: string;
  attrs: Record<string, string>;
}

const XML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#10;": "\n" };

function decodeEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#10);/g, (m) => XML_ENTITIES[m] ?? m);
}

function parseNodes(xml: string): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  const tagRe = /<([A-Za-z_][\w.$:-]*)\s([^<>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    const attrs: Record<string, string> = {};
    const attrRe = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let a: RegExpExecArray | null;
    while ((a = attrRe.exec(m[2])) !== null) {
      attrs[a[1]] = decodeEntities(a[2]);
    }
    nodes.push({ tag: m[1], attrs });
  }
  return nodes;
}

/** Extract locator-like candidates (ids, accessibility ids, quoted names) from an error message. */
export function extractLocatorCandidates(message: string | undefined): string[] {
  if (!message) return [];
  const out = new Set<string>();
  const add = (v: string | undefined) => {
    const t = (v ?? "").trim();
    if (t.length >= 2 && t.length <= 120) out.add(t);
  };
  for (const m of message.matchAll(/'([^'\n]{2,120})'/g)) add(m[1]);
  for (const m of message.matchAll(/"([^"\n]{2,120})"/g)) add(m[1]);
  for (const m of message.matchAll(/\b(?:id|resource-id|accessibility id|name|text)\s*[=:]\s*([\w.:/@-]{2,120})/gi)) add(m[1]);
  for (const m of message.matchAll(/\b([a-z][\w.]*:id\/[\w]+)\b/gi)) add(m[1]);
  return Array.from(out).slice(0, 8);
}

export function extractPageSourceSignals(xml: string, opts: { errorMessage?: string } = {}): PageSourceSignals {
  const nodes = parseNodes(xml);
  const isIos = nodes.some((n) => n.tag.startsWith("XCUIElementType"));
  const isAndroid = nodes.some((n) => n.attrs["resource-id"] !== undefined || (n.attrs["class"] ?? "").startsWith("android."));
  const platform: PageSourceSignals["platform"] = isIos ? "ios" : isAndroid ? "android" : "unknown";

  const pkgCount = new Map<string, number>();
  const dialogTexts = new Set<string>();
  const toasts = new Set<string>();
  let crashDialog = false;
  let anrDialog = false;
  let permissionDialog = false;
  let keyboardVisible = false;
  let loadingIndicator = false;
  let emptyState = false;

  for (const { tag, attrs } of nodes) {
    const text = (attrs["text"] ?? attrs["label"] ?? attrs["value"] ?? "").trim();
    const rid = attrs["resource-id"] ?? "";
    const cls = attrs["class"] ?? tag;
    const pkg = attrs["package"] ?? "";

    if (pkg) pkgCount.set(pkg, (pkgCount.get(pkg) ?? 0) + 1);

    // Crash / ANR
    if (/^android:id\/aerr_/.test(rid)) {
      crashDialog = true;
      if (/aerr_wait/.test(rid)) anrDialog = true;
    }
    if (/isn['’]t responding|not responding/i.test(text)) {
      anrDialog = true;
      dialogTexts.add(text);
    }
    if (/has stopped|keeps stopping|stopped working|keeps crashing|unfortunately,? .+ has stopped/i.test(text)) {
      crashDialog = true;
      dialogTexts.add(text);
    }

    // Permission dialogs
    if (
      /permissioncontroller|packageinstaller/i.test(pkg) ||
      /permission_(allow|deny|message|icon)/i.test(rid) ||
      (platform === "ios" && /would like to|wants to (access|use)/i.test(text))
    ) {
      permissionDialog = true;
      if (text) dialogTexts.add(text);
    }

    // Keyboard
    if (/inputmethod/i.test(pkg) || /inputmethod/i.test(rid) || /XCUIElementTypeKeyboard$/.test(tag)) keyboardVisible = true;

    // Loading indicators
    if (
      /ProgressBar|ActivityIndicator|ProgressIndicator/i.test(cls) ||
      /(^|[/_])(progress|loading|spinner|shimmer)([_/]|$)/i.test(rid)
    ) {
      loadingIndicator = true;
    }

    // Toasts / snackbars
    if (/android\.widget\.Toast/i.test(cls) && text) toasts.add(text);
    if (/snackbar/i.test(rid) && text) toasts.add(text);

    // Empty state
    if (/(^|[/_])(empty|no_results|no_data|empty_state)([_/]|$)/i.test(rid)) emptyState = true;
    if (!emptyState && /^(no (results|data|items|content)|nothing (here|to show))/i.test(text)) emptyState = true;
  }

  let topPackage: string | undefined;
  let topCount = 0;
  for (const [pkg, count] of pkgCount) {
    if (/^com\.android\.systemui$/.test(pkg)) continue;
    if (count > topCount) {
      topCount = count;
      topPackage = pkg;
    }
  }

  const signals: PageSourceSignals = {
    platform,
    nodeCount: nodes.length,
    topPackage,
    crashDialog,
    anrDialog,
    dialogTexts: Array.from(dialogTexts).slice(0, 5),
    permissionDialog,
    keyboardVisible,
    loadingIndicator,
    toasts: Array.from(toasts).slice(0, 5),
    emptyState,
  };

  const candidates = extractLocatorCandidates(opts.errorMessage);
  if (candidates.length > 0) {
    const found: string[] = [];
    const missing: string[] = [];
    for (const c of candidates) {
      const hit = nodes.some(({ attrs }) => {
        const rid = attrs["resource-id"] ?? "";
        return (
          rid === c ||
          rid.endsWith(`/${c}`) ||
          attrs["content-desc"] === c ||
          attrs["text"] === c ||
          attrs["name"] === c ||
          attrs["label"] === c ||
          attrs["value"] === c
        );
      });
      (hit ? found : missing).push(c);
    }
    signals.locator = { checked: candidates, found, missing };
  }
  return signals;
}

/** Signals present in the failed run but not in the last passed run. */
export function diffSignals(failed: PageSourceSignals, passed: PageSourceSignals): string[] {
  const diffs: string[] = [];
  const flag = (key: keyof PageSourceSignals, label: string) => {
    if (failed[key] && !passed[key]) diffs.push(label);
  };
  flag("crashDialog", "Crash dialog appears only in the failed run");
  flag("anrDialog", "ANR dialog appears only in the failed run");
  flag("permissionDialog", "Permission dialog appears only in the failed run");
  flag("keyboardVisible", "Soft keyboard visible only in the failed run");
  flag("loadingIndicator", "Loading indicator still visible only in the failed run");
  flag("emptyState", "Empty state shown only in the failed run");
  for (const toast of failed.toasts) {
    if (!passed.toasts.includes(toast)) diffs.push(`Toast/snackbar only in the failed run: "${toast}"`);
  }
  if (failed.topPackage && passed.topPackage && failed.topPackage !== passed.topPackage) {
    diffs.push(`Foreground app differs: failed=${failed.topPackage}, passed=${passed.topPackage}`);
  }
  if (passed.nodeCount > 0 && failed.nodeCount < passed.nodeCount * 0.5) {
    diffs.push(`Much smaller UI tree in the failed run (${failed.nodeCount} vs ${passed.nodeCount} nodes)`);
  }
  return diffs;
}

/** Artifact names present only on one side. */
export function diffArtifactNames(failed: ArtifactItem[], passed: ArtifactItem[]): { onlyFailed: string[]; onlyPassed: string[] } {
  const f = new Set(failed.map((a) => a.name));
  const p = new Set(passed.map((a) => a.name));
  return {
    onlyFailed: [...f].filter((n) => !p.has(n)),
    onlyPassed: [...p].filter((n) => !f.has(n)),
  };
}

// ───────────────────────────── loading ─────────────────────────────

export interface PageSourceEvidence {
  name: string;
  uuid: string;
  sizeInBytes?: number;
  signals: PageSourceSignals;
  redacted: boolean;
}

export interface ArtifactEvidence {
  artifacts: ArtifactItem[];
  pageSource?: PageSourceEvidence;
  warnings: string[];
}

export interface LoadEvidenceParams {
  tcm?: EnhancedZebrunnerClient;
  /** `artifacts` array from the Reporting API test payload. */
  testArtifacts: RawArtifact[] | any[] | undefined;
  testId?: number;
  testName?: string;
  errorMessage?: string;
  includeArtifacts?: boolean;
  includePageSource?: boolean;
  redact?: boolean;
  budget?: EvidenceBudget;
}

/** Pick the page source to analyze: newest failure_page_source*, else any xml with page_source in the name. */
export function selectPageSource(artifacts: ArtifactItem[]): ArtifactItem | undefined {
  const files = artifacts.filter((a) => a.kind === "file" && a.uuid);
  const failure = files.filter((a) => /^failure_page_source/i.test(a.name));
  if (failure.length > 0) return failure[failure.length - 1];
  const any = files.filter((a) => /page_?source/i.test(a.name) && /\.xml$/i.test(a.name));
  return any[any.length - 1];
}

/** Never throws. Returns null when nothing was requested. */
export async function loadArtifactEvidence(params: LoadEvidenceParams): Promise<ArtifactEvidence | null> {
  const { includeArtifacts = false, includePageSource = false } = params;
  if (!includeArtifacts && !includePageSource) return null;

  const evidence: ArtifactEvidence = { artifacts: [], warnings: [] };
  try {
    evidence.artifacts = collectArtifacts({
      tests: [{ id: params.testId ?? 0, name: params.testName, artifacts: (params.testArtifacts ?? []) as RawArtifact[] }],
      includeLaunchLevel: false,
    });
  } catch (error) {
    evidence.warnings.push(`Artifacts could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return evidence;
  }

  if (!includePageSource) return evidence;

  const selected = selectPageSource(evidence.artifacts);
  if (!selected || !selected.uuid || !isValidUuid(selected.uuid)) return evidence; // nothing to analyze, not a warning

  if (!params.tcm) {
    evidence.warnings.push("Page source not analyzed: Public API client unavailable.");
    return evidence;
  }
  if (params.budget && !params.budget.take()) {
    evidence.warnings.push(
      `Page source not analyzed${params.testId ? ` for test ${params.testId}` : ""}: per-call limit reached (ARTIFACT_EVIDENCE_MAX_FILES). Use adv_download_artifact.`,
    );
    return evidence;
  }

  try {
    const { buffer } = await params.tcm.downloadFileContent(selected.uuid, { maxBytes: PAGE_SOURCE_MAX_BYTES, purpose: "return" });
    let xml = buffer.toString("utf8");
    let redacted = false;
    if (params.redact) {
      xml = redactSensitiveText(xml).text;
      redacted = true;
    }
    const signals = extractPageSourceSignals(xml, { errorMessage: params.errorMessage });
    if (params.redact) {
      signals.toasts = signals.toasts.map((t) => redactSensitiveText(t).text);
      signals.dialogTexts = signals.dialogTexts.map((t) => redactSensitiveText(t).text);
    }
    evidence.pageSource = {
      name: selected.name,
      uuid: selected.uuid,
      sizeInBytes: buffer.length,
      signals,
      redacted,
    };
  } catch (error) {
    evidence.warnings.push(
      `Page source '${selected.name}' could not be analyzed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return evidence;
}

// ───────────────────────────── classification ─────────────────────────────

export interface Classification {
  category: string;
  confidence: string;
  reasons: string[];
}

/**
 * Refine an error classification using page-source signals. Returns the input unchanged
 * when there is no page source, so existing behaviour is preserved.
 */
export function refineClassification(base: Classification, evidence: ArtifactEvidence | null | undefined): Classification {
  const s = evidence?.pageSource?.signals;
  if (!s) return base;

  if (s.crashDialog || s.anrDialog) {
    return {
      category: "Application Crash / ANR",
      confidence: "High",
      reasons: [
        s.anrDialog ? "Page source shows an ANR (\"isn't responding\") dialog" : "Page source shows an app crash dialog",
        ...(s.dialogTexts.length > 0 ? [`Dialog text: ${s.dialogTexts[0]}`] : []),
        `Original classification: ${base.category}`,
      ],
    };
  }

  if (s.permissionDialog && ["Locator Issue", "Timing Issue", "Interaction Issue", "Unknown"].includes(base.category)) {
    return {
      category: "Test Setup Issue",
      confidence: "High",
      reasons: [
        "A system permission dialog is covering the app UI in the page source",
        "Grant permissions in test setup (or auto-accept them) before this step",
        `Original classification: ${base.category}`,
      ],
    };
  }

  const reasons = [...base.reasons];
  let { category, confidence } = base;

  if (base.category === "Locator Issue" && s.locator) {
    if (s.locator.found.length > 0) {
      category = "Timing Issue";
      confidence = "Medium";
      reasons.push(
        `Locator '${s.locator.found[0]}' IS present in the page source: the element exists but was not interactable in time (off-screen, covered, or loaded late)`,
      );
    } else if (s.locator.missing.length > 0) {
      confidence = "High";
      reasons.push(`Locator '${s.locator.missing[0]}' is NOT present in the page source: the element is genuinely missing from the screen`);
    }
  }
  if (s.loadingIndicator) reasons.push("A loading/progress indicator is still visible in the page source at failure time");
  if (s.keyboardVisible && ["Interaction Issue", "Locator Issue"].includes(category)) {
    reasons.push("The soft keyboard is visible and may be covering the target element");
  }
  if (s.toasts.length > 0) reasons.push(`Toast/snackbar at failure time: "${s.toasts[0]}"`);

  return reasons.length === base.reasons.length && category === base.category && confidence === base.confidence
    ? base
    : { category, confidence, reasons };
}

// ───────────────────────────── rendering ─────────────────────────────

function signalLines(s: PageSourceSignals): string[] {
  const lines: string[] = [];
  lines.push(`Platform: ${s.platform}, nodes: ${s.nodeCount}${s.topPackage ? `, foreground package: ${s.topPackage}` : ""}`);
  if (s.crashDialog) lines.push("Crash dialog visible");
  if (s.anrDialog) lines.push("ANR dialog visible");
  if (s.permissionDialog) lines.push("System permission dialog visible");
  if (s.keyboardVisible) lines.push("Soft keyboard visible");
  if (s.loadingIndicator) lines.push("Loading/progress indicator visible");
  if (s.emptyState) lines.push("Empty state visible");
  for (const t of s.toasts) lines.push(`Toast/snackbar: "${t}"`);
  for (const t of s.dialogTexts) lines.push(`Dialog text: "${t}"`);
  if (s.locator) {
    for (const f of s.locator.found) lines.push(`Locator '${f}' present in page source`);
    for (const m of s.locator.missing) lines.push(`Locator '${m}' NOT present in page source`);
  }
  return lines;
}

function artifactLink(a: ArtifactItem, baseUrl?: string): string {
  if (a.kind === "file" && a.uuid) return baseUrl ? `${baseUrl}/files/${a.uuid}` : `/files/${a.uuid}`;
  return a.url ?? "";
}

export type EvidenceFormat = "detailed" | "summary";

/** Markdown block. Returns "" when there is nothing to say (unless `showNone` is set). */
export function renderEvidenceMarkdown(
  evidence: ArtifactEvidence | null | undefined,
  opts: { format: EvidenceFormat; baseUrl?: string; showNone?: boolean },
): string {
  if (!evidence) return "";
  const { artifacts, pageSource, warnings } = evidence;

  if (opts.format === "summary") {
    let out = "";
    if (artifacts.length > 0) {
      const names = Array.from(new Set(artifacts.map((a) => a.name)));
      out += `**Artifacts:** ${artifacts.length} (${names.slice(0, 4).join(", ")}${names.length > 4 ? ", ..." : ""})\n`;
    }
    if (pageSource) {
      const sig = signalLines(pageSource.signals).slice(1).join("; ");
      out += `**Page Source:** ${pageSource.name}${sig ? ` — ${sig}` : " — no notable signals"}\n`;
    }
    for (const w of warnings) out += `**Artifact Warning:** ${w}\n`;
    return out ? `\n${out}` : "";
  }

  if (artifacts.length === 0 && !pageSource && warnings.length === 0) {
    return opts.showNone ? `## 📎 Artifacts\n\nNo artifacts attached to this test.\n\n` : "";
  }

  let out = `## 📎 Artifacts\n\n`;
  if (artifacts.length === 0) {
    out += `No artifacts attached to this test.\n\n`;
  } else {
    for (const a of artifacts) {
      if (a.kind === "file") {
        out += `- 📄 \`${a.name}\` — file \`${a.uuid}\` ([open](${artifactLink(a, opts.baseUrl)}))\n`;
      } else {
        out += `- 🔗 \`${a.name}\` — link: ${a.url}\n`;
      }
    }
    out += `\n💡 Read any file artifact with \`adv_download_artifact\` (uuid) or list more with \`adv_list_test_artifacts\`.\n\n`;
  }

  if (pageSource) {
    out += `### Page Source Signals (\`${pageSource.name}\`${pageSource.sizeInBytes ? `, ${pageSource.sizeInBytes} bytes` : ""}${pageSource.redacted ? ", redacted" : ""})\n\n`;
    for (const line of signalLines(pageSource.signals)) out += `- ${line}\n`;
    out += `\n`;
  }
  for (const w of warnings) out += `⚠️ ${w}\n\n`;
  return out;
}

/** Jira wiki-markup block. Empty string when there is nothing to report. */
export function renderEvidenceJira(evidence: ArtifactEvidence | null | undefined, baseUrl?: string): string {
  if (!evidence || (evidence.artifacts.length === 0 && !evidence.pageSource && evidence.warnings.length === 0)) return "";
  let out = `h3. Artifacts\n`;
  for (const a of evidence.artifacts) {
    const link = artifactLink(a, baseUrl);
    out += link ? `* [${a.name}|${link}]\n` : `* ${a.name}\n`;
  }
  if (evidence.pageSource) {
    out += `\n*Page source signals* (${evidence.pageSource.name}):\n`;
    for (const line of signalLines(evidence.pageSource.signals)) out += `* ${line}\n`;
  }
  for (const w of evidence.warnings) out += `\n(!) ${w}\n`;
  return out + `\n`;
}

/** One-line signal summary used for grouping / compact tables. */
export function signalSummary(evidence: ArtifactEvidence | null | undefined): string {
  const s = evidence?.pageSource?.signals;
  if (!s) return "";
  const parts: string[] = [];
  if (s.crashDialog) parts.push("crash dialog");
  if (s.anrDialog) parts.push("ANR");
  if (s.permissionDialog) parts.push("permission dialog");
  if (s.keyboardVisible) parts.push("keyboard");
  if (s.loadingIndicator) parts.push("loading");
  if (s.emptyState) parts.push("empty state");
  if (s.toasts.length) parts.push(`toast "${s.toasts[0]}"`);
  if (s.locator?.missing.length) parts.push(`locator missing`);
  if (s.locator?.found.length) parts.push(`locator present`);
  return parts.join(", ");
}
