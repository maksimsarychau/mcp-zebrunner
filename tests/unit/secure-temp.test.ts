/**
 * Local artifact storage hardening: private folders, 0600 files, no symlink following,
 * no overwrites, TTL sweep limited to the default folder, and HTTP mode inline-only.
 * Every test runs under its own TMPDIR so nothing touches the real OS temp folder.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InsecureDirectoryError,
  diskWritesAllowed,
  ensureSecureDir,
  getArtifactTtlMs,
  sweepExpired,
  writeSecureFile,
} from "../../src/utils/secure-temp.js";
import { ArtifactToolHandlers, sweepDefaultArtifactDir } from "../../src/handlers/artifact-tools.js";
import { getDefaultArtifactDir } from "../../src/utils/artifacts.js";

const POSIX = process.platform !== "win32";
const SAVED_ENV = { ...process.env };
let root = "";

function mode(p: string): number {
  return lstatSync(p).mode & 0o777;
}

function age(p: string, minutes: number): void {
  const t = new Date(Date.now() - minutes * 60_000);
  utimesSync(p, t, t);
}

function statusOf(result: { content: Array<{ text: string }> }): any {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "zbr-secure-")));
  process.env.TMPDIR = root;
  delete process.env.MCP_TRANSPORT;
  delete process.env.PORT;
  delete process.env.ZEBRUNNER_ALLOW_DISK_WRITES_HTTP;
  delete process.env.ZEBRUNNER_ARTIFACT_TTL_MINUTES;
  delete process.env.ZEBRUNNER_ARTIFACT_DIRS;
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVED_ENV)) delete process.env[k];
  Object.assign(process.env, SAVED_ENV);
  rmSync(root, { recursive: true, force: true });
});

describe("ensureSecureDir", () => {
  it("creates every component below root as 0700", { skip: !POSIX }, () => {
    const dir = join(root, "a", "b");
    ensureSecureDir(dir, { root, strict: true });
    assert.equal(mode(join(root, "a")), 0o700);
    assert.equal(mode(dir), 0o700);
  });

  it("refuses a symlinked folder", () => {
    const real = join(root, "elsewhere");
    mkdirSync(real);
    symlinkSync(real, join(root, "zebrunner-artifacts"));
    assert.throws(() => ensureSecureDir(join(root, "zebrunner-artifacts"), { root, strict: true }), InsecureDirectoryError);
  });

  it("refuses a symlinked parent folder", () => {
    const real = join(root, "elsewhere");
    mkdirSync(real);
    symlinkSync(real, join(root, "mcp-zebrunner"));
    assert.throws(() => ensureSecureDir(join(root, "mcp-zebrunner", "screenshots"), { root, strict: true }), InsecureDirectoryError);
  });

  it("refuses a regular file in place of the folder", () => {
    writeFileSync(join(root, "zebrunner-artifacts"), "x");
    assert.throws(() => ensureSecureDir(join(root, "zebrunner-artifacts"), { root }), InsecureDirectoryError);
  });

  it("tightens an own group/other-writable folder", { skip: !POSIX }, () => {
    const dir = join(root, "open");
    mkdirSync(dir);
    chmodSync(dir, 0o777);
    ensureSecureDir(dir);
    assert.equal(mode(dir) & 0o022, 0);
  });

  it("strict mode tightens only the final folder, not shared parents", { skip: !POSIX }, () => {
    const parent = join(root, "mcp-zebrunner");
    mkdirSync(parent);
    chmodSync(parent, 0o755);
    ensureSecureDir(join(parent, "screenshots"), { root, strict: true });
    assert.equal(mode(parent), 0o755);
    assert.equal(mode(join(parent, "screenshots")), 0o700);
  });
});

describe("writeSecureFile", () => {
  it("creates files with mode 0600", { skip: !POSIX }, () => {
    const p = writeSecureFile(join(root, "f.txt"), "hello");
    assert.equal(mode(p), 0o600);
    assert.equal(readFileSync(p, "utf8"), "hello");
  });

  it("never overwrites an existing file", () => {
    const target = join(root, "f.txt");
    writeFileSync(target, "original");
    const p = writeSecureFile(target, "new");
    assert.notEqual(p, target);
    assert.equal(readFileSync(target, "utf8"), "original");
    assert.equal(readFileSync(p, "utf8"), "new");
  });

  it("does not follow a pre-placed symlink", () => {
    const victim = join(root, "victim.txt");
    writeFileSync(victim, "keep me");
    const link = join(root, "artifact.xml");
    symlinkSync(victim, link);
    const p = writeSecureFile(link, "attacker-controlled write");
    assert.notEqual(p, link);
    assert.equal(readFileSync(victim, "utf8"), "keep me");
    assert.ok(lstatSync(link).isSymbolicLink());
  });
});

describe("sweepExpired / TTL", () => {
  it("removes only expired regular files; keeps fresh files, symlinks and folders", () => {
    const dir = join(root, "d");
    mkdirSync(dir);
    const old = join(dir, "old.xml");
    const fresh = join(dir, "fresh.xml");
    writeFileSync(old, "o");
    writeFileSync(fresh, "f");
    age(old, 120);
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "x");
    age(outside, 120);
    symlinkSync(outside, join(dir, "link"));
    mkdirSync(join(dir, "sub"));
    const nested = join(dir, "sub", "nested.xml");
    writeFileSync(nested, "n");
    age(nested, 120);

    assert.equal(sweepExpired(dir, 60 * 60_000), 1);
    assert.ok(!existsSync(old));
    assert.ok(existsSync(fresh));
    assert.ok(existsSync(outside), "symlink target untouched");
    assert.ok(lstatSync(join(dir, "link")).isSymbolicLink());
    assert.ok(existsSync(nested), "no recursion");
  });

  it("does nothing on a symlinked folder", () => {
    const real = join(root, "real");
    mkdirSync(real);
    const f = join(real, "x");
    writeFileSync(f, "x");
    age(f, 999);
    symlinkSync(real, join(root, "link"));
    assert.equal(sweepExpired(join(root, "link"), 1), 0);
    assert.ok(existsSync(f));
  });

  it("parses ZEBRUNNER_ARTIFACT_TTL_MINUTES (default 60, 0 disables, invalid falls back)", () => {
    assert.equal(getArtifactTtlMs({}), 3_600_000);
    assert.equal(getArtifactTtlMs({ ZEBRUNNER_ARTIFACT_TTL_MINUTES: "5" }), 300_000);
    assert.equal(getArtifactTtlMs({ ZEBRUNNER_ARTIFACT_TTL_MINUTES: "0" }), 0);
    assert.equal(getArtifactTtlMs({ ZEBRUNNER_ARTIFACT_TTL_MINUTES: "-3" }), 3_600_000);
    assert.equal(getArtifactTtlMs({ ZEBRUNNER_ARTIFACT_TTL_MINUTES: "abc" }), 3_600_000);
  });

  it("sweeps the default folder but never ZEBRUNNER_ARTIFACT_DIRS", () => {
    const userDir = join(root, "mine");
    mkdirSync(userDir);
    process.env.ZEBRUNNER_ARTIFACT_DIRS = userDir;
    const userFile = join(userDir, "keep.xml");
    writeFileSync(userFile, "k");
    age(userFile, 999);
    const def = getDefaultArtifactDir();
    ensureSecureDir(def, { root, strict: true });
    const defFile = join(def, "old.xml");
    writeFileSync(defFile, "o");
    age(defFile, 999);

    assert.equal(sweepDefaultArtifactDir(), 1);
    assert.ok(!existsSync(defFile));
    assert.ok(existsSync(userFile));

    writeFileSync(defFile, "o");
    age(defFile, 999);
    process.env.ZEBRUNNER_ARTIFACT_TTL_MINUTES = "0";
    assert.equal(sweepDefaultArtifactDir(), 0);
    assert.ok(existsSync(defFile));
  });
});

describe("screenshot cache folder", () => {
  it("saves screenshots as 0600 files in a 0700 folder and clears only regular files", { skip: !POSIX }, async () => {
    const { saveScreenshotToTemp, clearAllScreenshots, getScreenshotDir } = await import("../../src/utils/screenshot-analyzer.js");
    const p = await saveScreenshotToTemp(Buffer.from("png"), "../../evil.png");
    assert.equal(mode(p), 0o600);
    assert.equal(mode(getScreenshotDir()), 0o700);
    assert.ok(p.startsWith(getScreenshotDir()));
    const outside = join(root, "outside.png");
    writeFileSync(outside, "x");
    symlinkSync(outside, join(getScreenshotDir(), "link.png"));
    assert.equal(clearAllScreenshots(), 1);
    assert.ok(existsSync(outside));
  });
});

describe("deliverBuffer storage", () => {
  const handlers = new ArtifactToolHandlers({} as any);
  const bin = Buffer.from([0, 1, 2, 3, 255]);

  it("saves binary to a 0700 default folder as a 0600 file with a uuid prefix", { skip: !POSIX }, () => {
    const s = statusOf(handlers.deliverBuffer({ buffer: bin, name: "dump.bin", uuid: "1a1c9e55-48b7-6ce0-f015-a119421211c9" }));
    assert.equal(s.status, "ok");
    assert.ok(s.savedTo.includes("zebrunner-artifacts"));
    assert.ok(s.savedTo.endsWith("1a1c9e55_dump.bin"));
    assert.equal(mode(s.savedTo), 0o600);
    assert.equal(mode(getDefaultArtifactDir()), 0o700);
  });

  it("refuses the default folder when it is a symlink, and writes nothing there", () => {
    const real = join(root, "attacker");
    mkdirSync(real);
    symlinkSync(real, getDefaultArtifactDir());
    const s = statusOf(handlers.deliverBuffer({ buffer: bin, name: "dump.bin" }));
    assert.equal(s.status, "refused");
    assert.equal(s.reason, "output_path_not_allowed");
    assert.deepEqual(readdirSync(real), []);
  });

  it("HTTP mode: refuses outputPath, writes nothing, still returns text inline", () => {
    process.env.MCP_TRANSPORT = "http";
    process.env.PORT = "3999";
    assert.equal(diskWritesAllowed(), false);

    const refused = statusOf(handlers.deliverBuffer({ buffer: Buffer.from("<a/>"), name: "p.xml", contentType: "application/xml", outputPath: "p.xml" }));
    assert.equal(refused.status, "refused");
    assert.equal(refused.reason, "disk_writes_disabled");

    const text = handlers.deliverBuffer({ buffer: Buffer.from("<a/>"), name: "p.xml", contentType: "application/xml" });
    assert.equal(statusOf(text).contentIncluded, true);
    assert.ok(text.content[1].text.includes("<a/>"));

    const binary = statusOf(handlers.deliverBuffer({ buffer: bin, name: "dump.bin" }));
    assert.equal(binary.savedTo, undefined);
    assert.equal(existsSync(getDefaultArtifactDir()), false);
  });

  it("HTTP mode with ZEBRUNNER_ALLOW_DISK_WRITES_HTTP=true can save", () => {
    process.env.MCP_TRANSPORT = "http";
    process.env.PORT = "3999";
    process.env.ZEBRUNNER_ALLOW_DISK_WRITES_HTTP = "true";
    const s = statusOf(handlers.deliverBuffer({ buffer: bin, name: "dump.bin" }));
    assert.ok(s.savedTo && existsSync(s.savedTo));
  });
});
