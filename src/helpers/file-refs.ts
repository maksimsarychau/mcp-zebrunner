import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ZebrunnerMutationClient } from "../api/mutation-client.js";

const FILE_UUID_PATTERN = /\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function extractFileUuidsFromText(text: string): string[] {
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(FILE_UUID_PATTERN.source, "gi");
  while ((match = re.exec(text)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

export function replaceFileUuidsInText(
  text: string,
  uuidMap: Map<string, string>,
): string {
  return text.replace(
    new RegExp(FILE_UUID_PATTERN.source, "gi"),
    (fullMatch, uuid) => {
      const newUuid = uuidMap.get(uuid.toLowerCase());
      return newUuid ? `/files/${newUuid}` : fullMatch;
    },
  );
}

export function collectAllFileUuids(payload: Record<string, unknown>): {
  attachmentUuids: string[];
  inlineUuids: string[];
  locations: Map<string, string[]>;
} {
  const attachmentUuids: string[] = [];
  const inlineUuids: string[] = [];
  const locations = new Map<string, string[]>();

  const trackInline = (text: string, location: string) => {
    const uuids = extractFileUuidsFromText(text);
    for (const u of uuids) {
      inlineUuids.push(u);
      const list = locations.get(u) ?? [];
      list.push(location);
      locations.set(u, list);
    }
  };

  if (typeof payload.description === "string") trackInline(payload.description, "description");
  if (typeof payload.preConditions === "string") trackInline(payload.preConditions, "pre_conditions");
  if (typeof payload.postConditions === "string") trackInline(payload.postConditions, "post_conditions");

  if (Array.isArray(payload.attachments)) {
    for (const att of payload.attachments) {
      if (att && typeof att === "object" && "fileUuid" in att) {
        attachmentUuids.push((att as { fileUuid: string }).fileUuid);
        const list = locations.get((att as { fileUuid: string }).fileUuid) ?? [];
        list.push("attachments");
        locations.set((att as { fileUuid: string }).fileUuid, list);
      }
    }
  }

  if (Array.isArray(payload.steps)) {
    (payload.steps as Array<Record<string, unknown>>).forEach((step, idx) => {
      if (typeof step.action === "string") trackInline(step.action, `steps[${idx}].action`);
      if (typeof step.expectedResult === "string") trackInline(step.expectedResult, `steps[${idx}].expectedResult`);
      if (Array.isArray(step.attachments)) {
        for (const att of step.attachments) {
          if (att && typeof att === "object" && "fileUuid" in att) {
            attachmentUuids.push((att as { fileUuid: string }).fileUuid);
            const list = locations.get((att as { fileUuid: string }).fileUuid) ?? [];
            list.push(`steps[${idx}].attachments`);
            locations.set((att as { fileUuid: string }).fileUuid, list);
          }
        }
      }
    });
  }

  // Custom fields of type TEXT/STRING also support markdown file refs
  if (payload.customField && typeof payload.customField === "object") {
    for (const [key, val] of Object.entries(payload.customField as Record<string, unknown>)) {
      if (typeof val === "string") trackInline(val, `customField.${key}`);
    }
  }

  return { attachmentUuids, inlineUuids, locations };
}

export interface ReUploadResult {
  uuidMap: Map<string, string>;
  failures: string[];
}

export async function reUploadFiles(
  sourceUuids: string[],
  mutationClient: ZebrunnerMutationClient,
): Promise<ReUploadResult> {
  const uuidMap = new Map<string, string>();
  const failures: string[] = [];
  const uniqueUuids = [...new Set(sourceUuids)];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-zeb-files-"));

  try {
    for (const uuid of uniqueUuids) {
      try {
        const downloaded = await mutationClient.downloadFile(uuid);
        const tmpFile = path.join(tmpDir, downloaded.name || `${uuid}.bin`);
        fs.writeFileSync(tmpFile, downloaded.buffer);

        const uploaded = await mutationClient.uploadFile(tmpFile);
        uuidMap.set(uuid.toLowerCase(), uploaded.data.uuid);

        fs.unlinkSync(tmpFile);
      } catch {
        failures.push(uuid);
      }
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return { uuidMap, failures };
}

export function applyUuidMapping(
  payload: Record<string, unknown>,
  uuidMap: Map<string, string>,
): Record<string, unknown> {
  const result = { ...payload };

  const remap = (text: string) => replaceFileUuidsInText(text, uuidMap);

  if (typeof result.description === "string") result.description = remap(result.description);
  if (typeof result.preConditions === "string") result.preConditions = remap(result.preConditions);
  if (typeof result.postConditions === "string") result.postConditions = remap(result.postConditions);

  if (Array.isArray(result.attachments)) {
    result.attachments = (result.attachments as Array<{ fileUuid: string }>).map((att) => {
      const newUuid = uuidMap.get(att.fileUuid?.toLowerCase());
      return newUuid ? { fileUuid: newUuid } : att;
    });
  }

  if (Array.isArray(result.steps)) {
    result.steps = (result.steps as Array<Record<string, unknown>>).map((step) => {
      const s = { ...step };
      if (typeof s.action === "string") s.action = remap(s.action);
      if (typeof s.expectedResult === "string") s.expectedResult = remap(s.expectedResult);
      if (Array.isArray(s.attachments)) {
        s.attachments = (s.attachments as Array<{ fileUuid: string }>).map((att) => {
          const newUuid = uuidMap.get(att.fileUuid?.toLowerCase());
          return newUuid ? { fileUuid: newUuid } : att;
        });
      }
      return s;
    });
  }

  if (result.customField && typeof result.customField === "object") {
    const cf = { ...(result.customField as Record<string, unknown>) };
    for (const [key, val] of Object.entries(cf)) {
      if (typeof val === "string") cf[key] = remap(val);
    }
    result.customField = cf;
  }

  return result;
}

export function stripFailedFileRefs(
  payload: Record<string, unknown>,
  failedUuids: string[],
): { cleanedPayload: Record<string, unknown>; warnings: string[] } {
  const result = { ...payload };
  const warnings: string[] = [];
  const failedSet = new Set(failedUuids.map((u) => u.toLowerCase()));

  const stripFromText = (text: string, location: string): string => {
    const re = new RegExp(FILE_UUID_PATTERN.source, "gi");
    return text.replace(re, (fullMatch, uuid) => {
      if (failedSet.has(uuid.toLowerCase())) {
        warnings.push(`  ${location}: /files/${uuid} (stripped)`);
        return "";
      }
      return fullMatch;
    });
  };

  if (typeof result.description === "string") result.description = stripFromText(result.description, "description");
  if (typeof result.preConditions === "string") result.preConditions = stripFromText(result.preConditions, "pre_conditions");
  if (typeof result.postConditions === "string") result.postConditions = stripFromText(result.postConditions, "post_conditions");

  if (Array.isArray(result.attachments)) {
    const origLen = (result.attachments as Array<{ fileUuid: string }>).length;
    result.attachments = (result.attachments as Array<{ fileUuid: string }>).filter((att) => {
      if (failedSet.has(att.fileUuid?.toLowerCase())) {
        warnings.push(`  attachments: fileUuid ${att.fileUuid} (removed)`);
        return false;
      }
      return true;
    });
    if ((result.attachments as unknown[]).length === 0 && origLen > 0) delete result.attachments;
  }

  if (Array.isArray(result.steps)) {
    result.steps = (result.steps as Array<Record<string, unknown>>).map((step, idx) => {
      const s = { ...step };
      if (typeof s.action === "string") s.action = stripFromText(s.action, `steps[${idx}].action`);
      if (typeof s.expectedResult === "string") s.expectedResult = stripFromText(s.expectedResult, `steps[${idx}].expectedResult`);
      if (Array.isArray(s.attachments)) {
        s.attachments = (s.attachments as Array<{ fileUuid: string }>).filter((att) => {
          if (failedSet.has(att.fileUuid?.toLowerCase())) {
            warnings.push(`  steps[${idx}].attachments: fileUuid ${att.fileUuid} (removed)`);
            return false;
          }
          return true;
        });
        if ((s.attachments as unknown[]).length === 0) delete s.attachments;
      }
      return s;
    });
  }

  if (result.customField && typeof result.customField === "object") {
    const cf = { ...(result.customField as Record<string, unknown>) };
    for (const [key, val] of Object.entries(cf)) {
      if (typeof val === "string") cf[key] = stripFromText(val, `customField.${key}`);
    }
    result.customField = cf;
  }

  return { cleanedPayload: result, warnings };
}

export function buildFileTransferReport(
  totalUuids: number,
  uuidMap: Map<string, string>,
  failures: string[],
  locations: Map<string, string[]>,
): string {
  const succeeded = uuidMap.size;
  const lines: string[] = [];

  if (succeeded > 0) {
    lines.push(`Attachments re-uploaded: ${succeeded} of ${totalUuids} file(s) transferred to target project`);
    for (const [oldUuid, newUuid] of uuidMap.entries()) {
      const locs = locations.get(oldUuid)?.join(", ") ?? "unknown";
      lines.push(`  ${locs}: ${oldUuid} → ${newUuid}`);
    }
  }

  if (failures.length > 0) {
    lines.push(`\n⚠️ Attachment warnings:`);
    lines.push(`  ${failures.length} file(s) could not be transferred (download/re-upload failed):`);
    for (const uuid of failures) {
      const locs = locations.get(uuid)?.join(", ") ?? "unknown";
      lines.push(`  ${locs}: /files/${uuid} (stripped)`);
    }
  }

  return lines.join("\n");
}

export async function processFilePathAttachments(
  attachments: Array<{ fileUuid?: string; file_path?: string }>,
  mutationClient: ZebrunnerMutationClient,
): Promise<{ resolved: Array<{ fileUuid: string }>; uploadReport: string[]; warnings: string[] }> {
  const resolved: Array<{ fileUuid: string }> = [];
  const uploadReport: string[] = [];
  const warnings: string[] = [];

  for (const att of attachments) {
    if (att.fileUuid) {
      resolved.push({ fileUuid: att.fileUuid });
    } else if (att.file_path) {
      const filePath = att.file_path;
      try {
        if (!fs.existsSync(filePath)) {
          warnings.push(`  ⚠️ File not found, skipped: ${filePath}`);
          continue;
        }
        const stat = fs.statSync(filePath);
        if (stat.size > 1_073_741_824) {
          warnings.push(`  ⚠️ File exceeds 1GB limit, skipped: ${filePath}`);
          continue;
        }
        const uploaded = await mutationClient.uploadFile(filePath);
        resolved.push({ fileUuid: uploaded.data.uuid });
        uploadReport.push(`  ${path.basename(filePath)} (${formatBytes(stat.size)}) → uploaded as ${uploaded.data.uuid}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`  ⚠️ Upload failed for ${path.basename(filePath)}: ${msg}`);
      }
    }
  }

  return { resolved, uploadReport, warnings };
}

export function describeFilePathAttachments(
  attachments: Array<{ fileUuid?: string; file_path?: string }>,
): string[] {
  const lines: string[] = [];
  for (const att of attachments) {
    if (att.file_path) {
      try {
        const stat = fs.statSync(att.file_path);
        lines.push(`  ${att.file_path} (${formatBytes(stat.size)}) → will be uploaded`);
      } catch {
        lines.push(`  ${att.file_path} → ⚠️ file not found`);
      }
    }
  }
  return lines;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
