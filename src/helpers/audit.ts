import fs from "fs";
import path from "path";
import os from "os";

const AUDIT_LOG_PATH = path.join(os.homedir(), ".mcp-zebrunner-audit.jsonl");

export interface AuditEntry {
  timestamp: string;
  tool: string;
  method: "POST" | "PUT" | "PATCH";
  url: string;
  projectKey?: string;
  payload: unknown;
}

/**
 * Append an audit entry to the JSONL log file.
 * Called BEFORE every mutating API call so the intent is recorded
 * even if the call fails. Never throws — audit failures are logged
 * to stderr only.
 */
export function writeAuditLog(entry: AuditEntry): void {
  const line = JSON.stringify(entry) + "\n";
  try {
    fs.appendFileSync(AUDIT_LOG_PATH, line, { encoding: "utf-8" });
  } catch (err) {
    process.stderr.write(`[audit] Failed to write audit log: ${err}\n`);
  }
}

export { AUDIT_LOG_PATH };
