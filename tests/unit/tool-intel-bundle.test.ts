import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import bundle from "../../src/generated/tool-intel-bundle.json" with { type: "json" };
import {
  loadToolIntelSnapshot,
  loadToolIntelSnapshotFromBundle,
  markdownForAllTools,
} from "../../src/utils/tool-intel.js";

function getProjectRoot(): string {
  return path.resolve(import.meta.dirname, "../..");
}

describe("tool-intel bundle", () => {
  it("bundle file exists with metadata and tools", () => {
    assert.ok(bundle.sourceHashes?.toolsJson, "toolsJson hash should be set");
    assert.ok(Array.isArray(bundle.tools));
    assert.ok(bundle.tools.length >= 65, `expected >= 65 tools, got ${bundle.tools.length}`);
  });

  it("bundle tool count matches tools.json", () => {
    const toolsJson = JSON.parse(
      fs.readFileSync(path.join(getProjectRoot(), "tools.json"), "utf-8"),
    ) as Array<{ name: string }>;
    assert.equal(bundle.tools.length, toolsJson.length);
  });

  it("loadToolIntelSnapshot uses filesystem when tools.json is present", () => {
    const snapshot = loadToolIntelSnapshot();
    const toolsJson = JSON.parse(
      fs.readFileSync(path.join(getProjectRoot(), "tools.json"), "utf-8"),
    ) as unknown[];
    assert.equal(snapshot.tools.length, toolsJson.length);
  });

  it("loadToolIntelSnapshotFromBundle returns non-zero tools", () => {
    const snapshot = loadToolIntelSnapshotFromBundle("9.2.9");
    assert.ok(snapshot.tools.length >= 65);
    assert.ok(snapshot.roleBenefits.length > 0);
  });

  it("falls back to bundle when TOOL_INTEL_FORCE_BUNDLE=1", () => {
    const prev = process.env.TOOL_INTEL_FORCE_BUNDLE;
    process.env.TOOL_INTEL_FORCE_BUNDLE = "1";
    try {
      const snapshot = loadToolIntelSnapshot();
      assert.ok(snapshot.tools.length >= 65);
    } finally {
      if (prev === undefined) delete process.env.TOOL_INTEL_FORCE_BUNDLE;
      else process.env.TOOL_INTEL_FORCE_BUNDLE = prev;
    }
  });

  it("markdownForAllTools reports non-zero Total tools", () => {
    const snapshot = loadToolIntelSnapshotFromBundle("9.2.9");
    const md = markdownForAllTools(snapshot, {
      includeExamples: true,
      includeTokenEstimates: true,
      includeRoleBenefits: true,
    });
    const match = md.match(/Total tools: (\d+)/);
    assert.ok(match, "summary should include Total tools line");
    assert.ok(Number(match![1]) >= 65);
  });

  it("legacy alias expansion still works from bundle path", () => {
    const prev = process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES;
    process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES = "true";
    process.env.TOOL_INTEL_FORCE_BUNDLE = "1";
    try {
      const withoutLegacy = loadToolIntelSnapshotFromBundle("9.2.9");
      process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES = "false";
      const baseOnly = loadToolIntelSnapshotFromBundle("9.2.9");
      assert.ok(
        withoutLegacy.tools.length > baseOnly.tools.length,
        "legacy aliases should expand tool count",
      );
    } finally {
      if (prev === undefined) delete process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES;
      else process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES = prev;
      delete process.env.TOOL_INTEL_FORCE_BUNDLE;
    }
  });
});
