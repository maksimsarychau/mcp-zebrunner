/**
 * Unit tests for src/utils/artifacts.ts: classification, link masking, collection,
 * redaction, output-path allow-list and size limits.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactPathError,
  DEFAULT_RETURN_MAX_BYTES,
  MAX_RETURN_BYTES_CAP,
  MAX_SAVE_BYTES,
  PUBLIC_API_VERSION_PATH,
  classifyArtifact,
  clampReturnBytes,
  collectArtifacts,
  compactArtifactSummary,
  effectiveLimit,
  extractFileUuid,
  getDefaultArtifactDir,
  isImageContentType,
  isTextualContent,
  maskSensitiveUrl,
  redactSensitiveText,
  resolveOutputPath,
  safeFileName,
} from "../../src/utils/artifacts.js";
import { PublicTestRunTestCaseResourceSchema, PublicTestRunRequirementSchema } from "../../src/types/core.js";

const UUID = "1a1c9e55-48b7-6ce0-f015-a119421211c9";

describe("artifact classification", () => {
  it("treats /files/<uuid> values as downloadable files", () => {
    assert.deepEqual(classifyArtifact({ name: "x.xml", value: `/files/${UUID}` }), { kind: "file", uuid: UUID });
  });

  it("treats workspace /files/<uuid> absolute URLs as files", () => {
    const c = classifyArtifact({ name: "x", value: `https://ws.zebrunner.com/files/${UUID}` });
    assert.equal(c.kind, "file");
    assert.equal(c.uuid, UUID);
  });

  it("treats other URLs as references and never as files", () => {
    const c = classifyArtifact({ name: "build", value: "https://ci.example.test/build/1" });
    assert.equal(c.kind, "reference");
    assert.equal(c.uuid, undefined);
  });

  it("keeps unknown shapes visible as references", () => {
    assert.equal(classifyArtifact({ name: "n", value: "not-a-link" }).kind, "reference");
  });

  it("extracts uuids from several shapes and rejects junk", () => {
    assert.equal(extractFileUuid(UUID.toUpperCase()), UUID);
    assert.equal(extractFileUuid(`https://h/files/${UUID}?x=1`), UUID);
    assert.equal(extractFileUuid("/files/not-a-uuid"), undefined);
    assert.equal(extractFileUuid(undefined), undefined);
  });
});

describe("signed link masking", () => {
  it("masks signature-bearing query parameters", () => {
    const masked = maskSensitiveUrl("https://bucket.s3.amazonaws.com/a.png?X-Amz-Signature=abc123&X-Amz-Credential=AKIA&size=3");
    assert.ok(!masked.includes("abc123"));
    assert.ok(!masked.includes("AKIA"));
    assert.ok(masked.includes("size=3"));
  });

  it("strips embedded credentials", () => {
    const masked = maskSensitiveUrl("https://user:secretpw@host.test/path");
    assert.ok(!masked.includes("secretpw"));
  });

  it("leaves harmless links unchanged", () => {
    assert.equal(maskSensitiveUrl("https://example.test/a?b=1"), "https://example.test/a?b=1");
  });

  it("never exposes a signed link through collectArtifacts", () => {
    const items = collectArtifacts({
      tests: [{ id: 1, artifacts: [{ name: "signed", value: "https://b.test/x?X-Amz-Signature=topsecret" }] }],
    });
    assert.ok(!JSON.stringify(items).includes("topsecret"));
  });
});

describe("collectArtifacts / compactArtifactSummary", () => {
  const launchArtifacts = [{ name: "launch link", value: "https://example.test/l" }];
  const tests = [
    { id: 1, name: "t1", artifacts: [{ name: "failure_page_source.xml", value: `/files/${UUID}` }] },
    { id: 2, name: "t2", artifacts: [{ name: "link", value: "https://example.test/x" }] },
    { id: 3, name: "t3" },
  ];

  it("collects launch + test level artifacts and filters", () => {
    const all = collectArtifacts({ launchArtifacts, tests });
    assert.equal(all.length, 3);
    assert.equal(collectArtifacts({ launchArtifacts, tests, includeLaunchLevel: false }).length, 2);
    assert.equal(collectArtifacts({ launchArtifacts, tests, testId: 2, includeLaunchLevel: false }).length, 1);
    assert.equal(collectArtifacts({ launchArtifacts, tests, kind: "file" }).length, 1);
    assert.equal(collectArtifacts({ launchArtifacts, tests, nameContains: "PAGE_SOURCE" }).length, 1);
  });

  it("skips malformed entries without throwing", () => {
    assert.deepEqual(collectArtifacts({ tests: [{ id: 1, artifacts: [null, { name: 1 }, {}] as any }] }), []);
  });

  it("builds a compact summary", () => {
    const s = compactArtifactSummary([
      { name: "a.xml", value: `/files/${UUID}` },
      { name: "link", value: "https://example.test/x" },
    ]);
    assert.deepEqual(s, { count: 2, files: 1, links: 1, names: ["a.xml", "link"] });
    assert.deepEqual(compactArtifactSummary(undefined), { count: 0, files: 0, links: 0, names: [] });
  });
});

describe("content type helpers", () => {
  it("separates images from text", () => {
    assert.ok(isImageContentType("image/png"));
    assert.ok(!isImageContentType("application/xml"));
    assert.ok(isTextualContent("application/xml"));
    assert.ok(isTextualContent("application/octet-stream", "page.xml"));
    assert.ok(!isTextualContent("application/octet-stream", "blob.bin"));
  });
});

describe("redaction (opt-in)", () => {
  it("masks emails and password node values", () => {
    const xml = `<n class="android.widget.EditText" password="true" text="hunter2"/><n text="mail me at jane.doe@example.com"/>`;
    const r = redactSensitiveText(xml);
    assert.ok(!r.text.includes("hunter2"));
    assert.ok(!r.text.includes("jane.doe@example.com"));
    assert.equal(r.redactions, 2);
  });

  it("masks iOS secure text fields and leaves other nodes alone", () => {
    const xml = `<XCUIElementTypeSecureTextField value="pw123"/><XCUIElementTypeButton label="Login"/>`;
    const r = redactSensitiveText(xml);
    assert.ok(!r.text.includes("pw123"));
    assert.ok(r.text.includes('label="Login"'));
  });
});

describe("output path allow-list", () => {
  it("defaults under the artifact temp dir", () => {
    const p = resolveOutputPath(undefined, "failure.xml", {});
    assert.ok(p.startsWith(realpathSync(tmpdir())) || p.startsWith(getDefaultArtifactDir()));
    assert.ok(p.endsWith("failure.xml"));
  });

  it("rejects absolute paths outside the allowed roots", () => {
    assert.throws(() => resolveOutputPath("/etc/passwd", "x", {}), ArtifactPathError);
  });

  it("rejects traversal out of the default dir", () => {
    assert.throws(() => resolveOutputPath("../../../etc/evil.xml", "x", {}), ArtifactPathError);
  });

  it("rejects NUL bytes", () => {
    assert.throws(() => resolveOutputPath("a\0b", "x", {}), ArtifactPathError);
  });

  it("allows folders added through ZEBRUNNER_ARTIFACT_DIRS", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "zbr-allow-")));
    const p = resolveOutputPath(join(dir, "ok.xml"), "x", { ZEBRUNNER_ARTIFACT_DIRS: dir });
    assert.equal(p, join(dir, "ok.xml"));
  });

  it("rejects symlink escapes from an allowed root", () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "zbr-outside-")));
    const allowed = realpathSync(mkdtempSync(join(tmpdir(), "zbr-root-")));
    symlinkSync(outside, join(allowed, "link"));
    assert.throws(
      () => resolveOutputPath(join(allowed, "link", "x.xml"), "x", { ZEBRUNNER_ARTIFACT_DIRS: allowed }),
      ArtifactPathError,
    );
  });

  it("sanitizes file names", () => {
    assert.equal(safeFileName("../../evil name?.xml"), "evil_name_.xml");
    assert.equal(safeFileName(""), "artifact");
  });
});

describe("size limits", () => {
  it("defaults to 1 MiB inline and caps at 10 MiB", () => {
    assert.equal(DEFAULT_RETURN_MAX_BYTES, 1024 * 1024);
    assert.equal(clampReturnBytes(undefined), DEFAULT_RETURN_MAX_BYTES);
    assert.equal(clampReturnBytes(-5), DEFAULT_RETURN_MAX_BYTES);
    assert.equal(clampReturnBytes(5 * 1024 * 1024), 5 * 1024 * 1024);
    assert.equal(clampReturnBytes(999 * 1024 * 1024), MAX_RETURN_BYTES_CAP);
    assert.equal(MAX_SAVE_BYTES, 10 * 1024 * 1024);
  });

  it("uses the save limit when saving", () => {
    assert.equal(effectiveLimit({ save: true }), MAX_SAVE_BYTES);
    assert.equal(effectiveLimit({ save: false, maxBytes: 2048 }), 2048);
  });
});

describe("API version and enum fixes", () => {
  it("keeps the v1 version path in one place", () => {
    assert.equal(PUBLIC_API_VERSION_PATH, "/api/public/v1");
  });

  it("accepts AZURE_DEVOPS issue references", () => {
    const parsed = PublicTestRunTestCaseResourceSchema.safeParse({
      testCase: { id: 1, key: "FIX-1", title: "t" },
      result: { status: { id: 1, name: "FAILED", status: { id: 1, name: "FAILED" } }, issue: { type: "AZURE_DEVOPS", id: "AB#12" } },
    });
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
    assert.ok(PublicTestRunRequirementSchema.safeParse({ source: "AZURE_DEVOPS", reference: "AB#1" }).success);
  });
});
