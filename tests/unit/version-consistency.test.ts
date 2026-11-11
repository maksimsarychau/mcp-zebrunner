/**
 * Version consistency: every file that carries the package version must agree,
 * and the release must be documented. Catches a half-done version bump.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");
const json = (rel: string) => JSON.parse(read(rel));

const pkg = json("package.json");
const VERSION: string = pkg.version;

describe(`version consistency (package.json = ${VERSION})`, () => {
  it("package.json has a semver version", () => {
    assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("package-lock.json (root and packages[''])", () => {
    const lock = json("package-lock.json");
    assert.equal(lock.version, VERSION, "package-lock.json version");
    assert.equal(lock.packages[""].version, VERSION, 'package-lock.json packages[""].version');
  });

  it("server.json (top level, package entry and remote entry)", () => {
    const text = read("server.json");
    const versions = Array.from(text.matchAll(/"version":\s*"([^"]+)"/g)).map((m) => m[1]);
    assert.ok(versions.length >= 3, `expected at least 3 version fields, found ${versions.length}`);
    assert.deepEqual(Array.from(new Set(versions)), [VERSION]);
  });

  for (const file of ["mcp-catalog.yaml", "custom-catalog.yaml"]) {
    it(`${file}`, () => {
      const m = /^\s*version:\s*"?([\d.]+)"?\s*$/m.exec(read(file));
      assert.ok(m, `${file} has a version field`);
      assert.equal(m![1], VERSION);
    });
  }

  it("change-logs.md documents this version", () => {
    assert.match(read("change-logs.md"), new RegExp(`^## v${VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "m"));
  });

  it("README banner references this version", () => {
    assert.ok(read("README.md").includes(`**v${VERSION}**`), `README banner must mention v${VERSION}`);
  });

  it("release notes exist for this version", () => {
    assert.ok(read(`docs/releases/v${VERSION}.md`).includes(VERSION));
  });
});
