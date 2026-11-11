/**
 * Read-only MCP tool handlers for Zebrunner test / launch artifacts.
 *
 *   adv_list_test_artifacts  -> listTestArtifacts
 *   adv_get_file_metadata    -> getFileMetadataTool
 *   adv_download_artifact    -> downloadArtifact
 *
 * Data sources:
 *   - Reporting API (launch + tests responses carry `artifacts: [{name, value}]`)
 *   - Public API v1 files endpoints (/files/{uuid}/metadata, /files/{uuid}) via the TCM client
 *
 * Nothing in this module writes to Zebrunner; files are only written to the local disk
 * inside the allow-listed artifact directories.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ZebrunnerReportingClient } from "../api/reporting-client.js";
import type { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import type { FileMetadata } from "../types/core.js";
import {
  ArtifactPathError,
  ArtifactTooLargeError,
  MAX_SAVE_BYTES,
  clampReturnBytes,
  collectArtifacts,
  extractFileUuid,
  formatBytes,
  isImageContentType,
  isTextualContent,
  isValidUuid,
  redactSensitiveText,
  resolveOutputPath,
  safeFileName,
  type ArtifactItem,
  type ArtifactKind,
} from "../utils/artifacts.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function textResult(text: string): ToolResult {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(payload: unknown): ToolResult {
  return textResult(JSON.stringify(payload, null, 2));
}

/** Error text that can never contain credentials (messages only, no request config). */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface ListArtifactsInput {
  projectKey?: string;
  projectId?: number;
  launchId: number;
  testId?: number;
  kind?: ArtifactKind | "all";
  nameContains?: string;
  includeLaunchLevel?: boolean;
  includeMetadata?: boolean;
  limit?: number;
}

export interface DownloadArtifactInput {
  uuid?: string;
  projectKey?: string;
  projectId?: number;
  launchId?: number;
  testId?: number;
  name?: string;
  outputPath?: string;
  returnContent?: boolean;
  maxBytes?: number;
  redact?: boolean;
}

export interface DeliverBufferInput {
  buffer: Buffer;
  name?: string;
  contentType?: string;
  uuid?: string;
  outputPath?: string;
  returnContent?: boolean;
  maxBytes?: number;
  redact?: boolean;
  /** Extra fields to merge into the status payload (e.g. test/launch context). */
  context?: Record<string, unknown>;
}

export class ArtifactToolHandlers {
  constructor(
    private reportingClient: ZebrunnerReportingClient,
    private tcmClient?: EnhancedZebrunnerClient,
  ) {}

  private requireTcm(): EnhancedZebrunnerClient {
    if (!this.tcmClient) {
      throw new Error("The Public API client is not available, so file endpoints cannot be used.");
    }
    return this.tcmClient;
  }

  private async resolveProjectId(input: { projectKey?: string; projectId?: number }): Promise<number> {
    if (input.projectId) return input.projectId;
    if (!input.projectKey) throw new Error("Either projectKey or projectId must be provided");
    return this.reportingClient.getProjectId(input.projectKey);
  }

  // ───────────────────────────── adv_list_test_artifacts ─────────────────────────────

  async listTestArtifacts(input: ListArtifactsInput): Promise<ToolResult> {
    try {
      const {
        launchId,
        testId,
        kind = "all",
        nameContains,
        includeLaunchLevel = true,
        includeMetadata = false,
        limit = 200,
      } = input;
      const projectId = await this.resolveProjectId(input);

      const launch = await this.reportingClient.getLaunch(launchId, projectId);
      const tests = testId
        ? [await this.reportingClient.getTestById(launchId, testId, projectId)]
        : (await this.reportingClient.getAllTestRuns(launchId, projectId)).items;

      let items = collectArtifacts({
        launchArtifacts: launch.artifacts,
        tests,
        testId,
        kind,
        nameContains,
        includeLaunchLevel,
      });
      const total = items.length;
      items = items.slice(0, limit);

      let metadataNote: string | undefined;
      if (includeMetadata) {
        const uuids = items.filter((i) => i.kind === "file" && i.uuid).map((i) => i.uuid!);
        if (uuids.length > 0) {
          try {
            const metas = await this.requireTcm().getBulkFileMetadata(uuids);
            const byUuid = new Map(metas.map((m) => [m.uuid.toLowerCase(), m]));
            for (const item of items) {
              const m = item.uuid ? byUuid.get(item.uuid) : undefined;
              if (m) {
                if (m.contentType) item.contentType = m.contentType;
                if (m.sizeInBytes != null) item.sizeInBytes = m.sizeInBytes;
              }
            }
          } catch (error) {
            metadataNote = `Metadata could not be loaded: ${safeErrorMessage(error)}`;
          }
        }
      }

      const payload: Record<string, unknown> = {
        launchId,
        projectId,
        ...(testId ? { testId } : {}),
        total,
        returned: items.length,
        ...(total > items.length ? { truncated: true, hint: "Increase limit or narrow with testId / nameContains / kind." } : {}),
        artifacts: items.map(slimItem),
      };
      if (metadataNote) payload.warning = metadataNote;
      if (total === 0) {
        payload.hint = testId
          ? "No artifacts on this test. Artifacts appear only when automation attaches them (Artifact.attachToTest / attachReferenceToTest)."
          : "No artifacts matched. Try kind: 'all', includeLaunchLevel: true or a different nameContains.";
      } else {
        payload.nextStep =
          "Use adv_download_artifact with uuid (kind=file) to read content; kind=reference items are links only.";
      }
      return jsonResult(payload);
    } catch (error) {
      return textResult(`Error listing artifacts: ${safeErrorMessage(error)}`);
    }
  }

  // ───────────────────────────── adv_get_file_metadata ─────────────────────────────

  async getFileMetadataTool(input: { uuid: string }): Promise<ToolResult> {
    try {
      const uuid = extractFileUuid(input.uuid) ?? input.uuid;
      if (!isValidUuid(uuid)) {
        throw new Error("uuid must be a file UUID (e.g. 1a1c9e55-48b7-6ce0-f015-a119421211c9) or a /files/<uuid> value");
      }
      const metadata = await this.requireTcm().getFileMetadata(uuid);
      return jsonResult(slimMetadata(metadata));
    } catch (error) {
      return textResult(`Error getting file metadata: ${safeErrorMessage(error)}`);
    }
  }

  // ───────────────────────────── adv_download_artifact ─────────────────────────────

  /** Resolve an artifact reference (uuid or launch/test/name) into a file uuid. */
  async resolveArtifactUuid(input: DownloadArtifactInput): Promise<{ uuid: string; context: Record<string, unknown> }> {
    if (input.uuid) {
      const uuid = extractFileUuid(input.uuid) ?? input.uuid;
      if (!isValidUuid(uuid)) {
        throw new Error("uuid must be a file UUID or a /files/<uuid> value");
      }
      return { uuid: uuid.toLowerCase(), context: {} };
    }

    if (!input.launchId || !input.name) {
      throw new Error("Provide either uuid, or launchId + name (plus testId for test-level artifacts).");
    }
    const projectId = await this.resolveProjectId(input);
    const launch = await this.reportingClient.getLaunch(input.launchId, projectId);
    const tests = input.testId
      ? [await this.reportingClient.getTestById(input.launchId, input.testId, projectId)]
      : (await this.reportingClient.getAllTestRuns(input.launchId, projectId)).items;

    const wanted = input.name.toLowerCase();
    const candidates = collectArtifacts({
      launchArtifacts: launch.artifacts,
      tests,
      testId: input.testId,
      kind: "file",
      includeLaunchLevel: !input.testId,
    }).filter((a) => a.name.toLowerCase() === wanted && a.uuid);

    if (candidates.length === 0) {
      throw new Error(
        `No file artifact named '${input.name}' found in launch ${input.launchId}` +
          (input.testId ? ` for test ${input.testId}` : "") +
          ". Use adv_list_test_artifacts to see available names.",
      );
    }
    const chosen = candidates[0];
    return {
      uuid: chosen.uuid!,
      context: {
        launchId: input.launchId,
        ...(chosen.testId ? { testId: chosen.testId } : {}),
        name: chosen.name,
        ...(candidates.length > 1 ? { note: `${candidates.length} artifacts share this name; the first one was used.` } : {}),
      },
    };
  }

  async downloadArtifact(input: DownloadArtifactInput): Promise<ToolResult> {
    try {
      const { uuid, context } = await this.resolveArtifactUuid(input);
      return await this.downloadByUuid(uuid, input, context);
    } catch (error) {
      return textResult(`Error downloading artifact: ${safeErrorMessage(error)}`);
    }
  }

  /** Download a file by uuid, enforce limits, then deliver (return and/or save). */
  async downloadByUuid(
    uuid: string,
    opts: Pick<DownloadArtifactInput, "outputPath" | "returnContent" | "maxBytes" | "redact">,
    context: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    const tcm = this.requireTcm();
    const save = !!opts.outputPath;
    // Download as much as either delivery mode needs; each mode is re-checked in deliverBuffer.
    const limit = Math.max(save ? MAX_SAVE_BYTES : 0, clampReturnBytes(opts.maxBytes));

    try {
      const { buffer, contentType, fileName } = await tcm.downloadFileContent(uuid, {
        maxBytes: limit,
        purpose: save ? "save" : "return",
      });
      return this.deliverBuffer({
        buffer,
        uuid,
        name: fileName,
        contentType,
        outputPath: opts.outputPath,
        returnContent: opts.returnContent,
        maxBytes: opts.maxBytes,
        redact: opts.redact,
        context,
      });
    } catch (error) {
      if (error instanceof ArtifactTooLargeError) {
        return jsonResult({
          status: "refused",
          reason: "too_large",
          uuid,
          sizeInBytes: error.sizeInBytes > limit ? undefined : error.sizeInBytes,
          limitInBytes: error.limitInBytes,
          message: error.message,
          ...context,
        });
      }
      throw error;
    }
  }

  /**
   * Deliver already-downloaded bytes: save to an allow-listed path and/or return text content.
   * Shared by adv_download_artifact and the non-image fallback of adv_download_test_screenshot.
   */
  deliverBuffer(input: DeliverBufferInput): ToolResult {
    const { buffer, uuid, contentType, context = {} } = input;
    const name = input.name || (uuid ? `${uuid}.bin` : "artifact.bin");
    const textual = isTextualContent(contentType, name);

    const status: Record<string, unknown> = {
      status: "ok",
      ...(uuid ? { uuid } : {}),
      name,
      contentType: contentType ?? "unknown",
      sizeInBytes: buffer.length,
      ...context,
    };
    const extra: string[] = [];

    // Default delivery: text -> return inline, anything else -> save to the default artifact dir.
    const saveRequested = !!input.outputPath;
    const returnRequested = input.returnContent ?? (!saveRequested && textual);
    const saveToDefault = !saveRequested && !returnRequested;
    const shouldSave = saveRequested || saveToDefault;

    let body = buffer;
    let redactions = 0;
    const doRedact = input.redact === true && textual;
    if (doRedact) {
      const r = redactSensitiveText(buffer.toString("utf8"));
      body = Buffer.from(r.text, "utf8");
      redactions = r.redactions;
      status.redacted = true;
      status.redactions = redactions;
    } else if (input.redact === true) {
      status.redacted = false;
      extra.push("redact was ignored: content is not text.");
    }

    if (shouldSave) {
      if (body.length > MAX_SAVE_BYTES) {
        return jsonResult({
          ...status,
          status: "refused",
          reason: "too_large",
          message: new ArtifactTooLargeError(body.length, MAX_SAVE_BYTES, "save").message,
        });
      }
      try {
        const target = resolveOutputPath(input.outputPath, safeFileName(name));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
        status.savedTo = target;
        status.savedBytes = body.length;
      } catch (error) {
        if (error instanceof ArtifactPathError) {
          return jsonResult({ ...status, status: "refused", reason: "output_path_not_allowed", message: error.message });
        }
        throw error;
      }
    }

    const blocks: ToolResult["content"] = [];
    if (returnRequested) {
      const returnLimit = clampReturnBytes(input.maxBytes);
      if (!textual) {
        status.contentIncluded = false;
        extra.push(
          isImageContentType(contentType)
            ? "Image content is not returned inline by this tool; use adv_analyze_screenshot or save with outputPath."
            : "Binary content cannot be returned inline; save it with outputPath instead.",
        );
      } else if (body.length > returnLimit) {
        status.contentIncluded = false;
        status.limitInBytes = returnLimit;
        extra.push(
          `Content (${formatBytes(body.length)}) exceeds maxBytes (${formatBytes(returnLimit)}); ` +
            (shouldSave ? "it was saved to disk instead." : "use outputPath to save it to disk or raise maxBytes (max 10 MiB)."),
        );
      } else {
        status.contentIncluded = true;
        const lang = /xml/i.test(contentType ?? "") || /\.xml$/i.test(name) ? "xml" : /json/i.test(contentType ?? "") ? "json" : "";
        blocks.push({ type: "text", text: "```" + lang + "\n" + body.toString("utf8") + "\n```" });
      }
    }

    if (extra.length > 0) status.notes = extra;
    return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }, ...blocks] };
  }
}

function slimItem(item: ArtifactItem): Record<string, unknown> {
  const out: Record<string, unknown> = { scope: item.scope, name: item.name, kind: item.kind };
  if (item.testId !== undefined) out.testId = item.testId;
  if (item.testName) out.testName = item.testName;
  if (item.uuid) out.uuid = item.uuid;
  if (item.url) out.url = item.url;
  if (item.contentType) out.contentType = item.contentType;
  if (item.sizeInBytes !== undefined) out.sizeInBytes = item.sizeInBytes;
  return out;
}

function slimMetadata(m: FileMetadata): Record<string, unknown> {
  return {
    uuid: m.uuid,
    name: m.name,
    type: m.type,
    contentType: m.contentType ?? undefined,
    sizeInBytes: m.sizeInBytes ?? undefined,
    uploadedAt: m.uploadedAt ?? undefined,
    uploadedBy: m.uploadedBy ?? undefined,
  };
}
