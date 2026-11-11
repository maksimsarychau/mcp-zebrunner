/**
 * Safe local storage for downloaded artifacts, screenshots and video frames.
 *
 * Threat model: the default folders live under the shared OS temp dir, so another local
 * user could pre-create them, plant symlinks, or read what we write. Every folder we own
 * is created 0700 and verified (real directory, owned by us, not writable by others);
 * every file is created 0600 with O_EXCL so existing files and symlinks are never
 * followed or overwritten.
 */
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveTransportMode } from "../config/transport.js";

const IS_POSIX = process.platform !== "win32";
const DEFAULT_TTL_MINUTES = 60;

export class InsecureDirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsecureDirectoryError";
  }
}

export interface EnsureSecureDirOptions {
  /**
   * Existing trusted parent (e.g. os.tmpdir()). Every path component below it is created
   * 0700 and verified, not just the last one.
   */
  root?: string;
  /**
   * Also tighten the final folder to 0700 when readable by group/others. Parents are only
   * verified (shared parents like <tmp>/mcp-zebrunner also hold the video/frame folders).
   */
  strict?: boolean;
}

function currentUid(): number | undefined {
  return IS_POSIX && typeof process.getuid === "function" ? process.getuid() : undefined;
}

function verifyDir(dir: string, strict: boolean): void {
  let st: Stats;
  try {
    st = lstatSync(dir);
  } catch (error) {
    throw new InsecureDirectoryError(`Cannot inspect folder ${dir}: ${(error as Error).message}`);
  }
  if (st.isSymbolicLink()) {
    throw new InsecureDirectoryError(`Refusing to use ${dir}: it is a symbolic link.`);
  }
  if (!st.isDirectory()) {
    throw new InsecureDirectoryError(`Refusing to use ${dir}: it is not a directory.`);
  }
  const uid = currentUid();
  if (uid === undefined) return;
  if (st.uid !== uid) {
    throw new InsecureDirectoryError(`Refusing to use ${dir}: it is owned by another user (uid ${st.uid}).`);
  }
  const tooOpen = strict ? (st.mode & 0o077) !== 0 : (st.mode & 0o022) !== 0;
  if (tooOpen) {
    chmodSync(dir, 0o700);
    const again = lstatSync(dir);
    if ((again.mode & 0o022) !== 0) {
      throw new InsecureDirectoryError(`Refusing to use ${dir}: it is writable by other users.`);
    }
  }
}

function mkdirOne(dir: string): void {
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/** Create (if needed) and verify a private folder. Throws InsecureDirectoryError when unsafe. */
export function ensureSecureDir(dir: string, options: EnsureSecureDirOptions = {}): string {
  const target = resolve(dir);
  const strict = options.strict === true;
  if (options.root) {
    const root = resolve(options.root);
    const rel = relative(root, target);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
      const parts = rel.split(sep);
      let current = root;
      parts.forEach((part, i) => {
        current = join(current, part);
        mkdirOne(current);
        verifyDir(current, strict && i === parts.length - 1);
      });
      return target;
    }
  }
  mkdirSync(target, { recursive: true, mode: 0o700 });
  verifyDir(target, strict);
  return target;
}

function withSuffix(path: string): string {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  return `${stem}_${randomBytes(3).toString("hex")}${ext}`;
}

/**
 * Write a new file with mode 0600. Never overwrites and never follows a symlink: when the
 * name is taken, a random suffix is added. Returns the path actually written.
 */
export function writeSecureFile(path: string, data: Buffer | string): string {
  const flags =
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let candidate = path;
  for (let attempt = 0; attempt < 6; attempt++) {
    let fd: number;
    try {
      fd = openSync(candidate, flags, 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ELOOP") {
        candidate = withSuffix(path);
        continue;
      }
      throw error;
    }
    try {
      let offset = 0;
      while (offset < buf.length) offset += writeSync(fd, buf, offset, buf.length - offset);
    } finally {
      closeSync(fd);
    }
    return candidate;
  }
  throw new Error(`Could not create a unique file next to ${basename(path)} in ${dirname(path)}.`);
}

/**
 * Delete top-level regular files we own that are at least `olderThanMs` old.
 * Skips symlinks, folders and foreign files; never recurses. Returns the number removed.
 */
export function sweepExpired(dir: string, olderThanMs: number, now: number = Date.now()): number {
  try {
    const st = lstatSync(dir);
    const uid = currentUid();
    if (st.isSymbolicLink() || !st.isDirectory()) return 0;
    if (uid !== undefined && st.uid !== uid) return 0;
  } catch {
    return 0;
  }
  const uid = currentUid();
  let removed = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    try {
      const st = lstatSync(full);
      if (!st.isFile() || st.isSymbolicLink()) continue;
      if (uid !== undefined && st.uid !== uid) continue;
      if (olderThanMs > 0 && now - st.mtimeMs < olderThanMs) continue;
      unlinkSync(full);
      removed++;
    } catch {
      /* raced or not permitted: leave it */
    }
  }
  return removed;
}

/** ZEBRUNNER_ARTIFACT_TTL_MINUTES in ms; 0 disables cleanup, invalid values fall back to 60 minutes. */
export function getArtifactTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ZEBRUNNER_ARTIFACT_TTL_MINUTES?.trim();
  if (raw === undefined || raw === "") return DEFAULT_TTL_MINUTES * 60_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_MINUTES * 60_000;
  return Math.round(n * 60_000);
}

/**
 * In HTTP mode files would land on the server host, shared by every connected user, so
 * disk writes are off unless an admin sets ZEBRUNNER_ALLOW_DISK_WRITES_HTTP=true.
 */
export function diskWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ZEBRUNNER_ALLOW_DISK_WRITES_HTTP?.trim().toLowerCase() === "true") return true;
  try {
    return resolveTransportMode() !== "http";
  } catch {
    return false;
  }
}

export const DISK_WRITES_DISABLED_MESSAGE =
  "Saving files is disabled because the server runs in HTTP mode (files would be written on the server host). " +
  "Content is returned inline when possible. An admin can set ZEBRUNNER_ALLOW_DISK_WRITES_HTTP=true to allow saving.";
