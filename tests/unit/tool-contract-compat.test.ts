/**
 * Tool-contract compatibility test.
 *
 * Compares the live tool surface (names, input names, required-ness, types,
 * defaults, annotations) against the committed 9.4.4 baseline captured BEFORE
 * the 9.4.5 changes. Allowed evolution:
 *   - new tools listed in EXPECTED_NEW_TOOLS
 *   - new OPTIONAL inputs on existing tools
 *   - enum widening
 * Anything else must be added to ALLOWED_CHANGES with a reason, so every
 * contract change is deliberate and reviewable.
 *
 * Refresh the baseline for a future release with:
 *   npx tsx scripts/snapshot-tool-contracts.ts --out tests/baselines/tool-contracts-<version>.json
 */
import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureToolContracts,
  type ToolContract,
  type ToolContractSnapshot,
} from "../../scripts/snapshot-tool-contracts.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_FILE = join(HERE, "..", "baselines", "tool-contracts-9.4.4.json");

/** Tools that are intentionally new in the current release (canonical adv_ names). */
const EXPECTED_NEW_TOOLS = new Set<string>([
  "adv_list_test_artifacts",
  "adv_get_file_metadata",
  "adv_download_artifact",
]);

/**
 * Deliberate, reviewed changes to EXISTING inputs: "<tool>.<input>" -> reason.
 * Keep empty unless a change is truly intended and documented in change-logs.md.
 */
const ALLOWED_CHANGES: Record<string, string> = {};

function legacyName(name: string): string {
  return name.replace(/^adv_/, "");
}

function enumValues(type: string): string[] | null {
  const m = /^enum\[(.*)\]$/.exec(type);
  return m ? (m[1] === "" ? [] : m[1].split(",")) : null;
}

describe("tool contract compatibility vs 9.4.4 baseline", () => {
  let baseline: ToolContractSnapshot;
  let current: ToolContractSnapshot;
  let currentByName: Map<string, ToolContract>;

  before(async () => {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
    current = await captureToolContracts();
    currentByName = new Map(current.tools.map((t) => [t.name, t]));
  });

  it("baseline is the 9.4.4 snapshot with canonical + legacy names", () => {
    assert.equal(baseline.version, "9.4.4");
    assert.equal(baseline.toolCount, 152);
  });

  it("every baseline tool still exists (no removed or renamed tools)", () => {
    const missing = baseline.tools.map((t) => t.name).filter((n) => !currentByName.has(n));
    assert.deepEqual(missing, []);
  });

  it("no unexpected new tools (new tools must be listed in EXPECTED_NEW_TOOLS and the docs)", () => {
    const baselineNames = new Set(baseline.tools.map((t) => t.name));
    const expected = new Set<string>();
    for (const n of EXPECTED_NEW_TOOLS) {
      expected.add(n);
      expected.add(legacyName(n));
    }
    const unexpected = current.tools.map((t) => t.name).filter((n) => !baselineNames.has(n) && !expected.has(n));
    assert.deepEqual(unexpected, []);

    const present = [...expected].filter((n) => currentByName.has(n));
    assert.equal(
      present.length,
      expected.size,
      `Expected new tools missing from the server: ${[...expected].filter((n) => !currentByName.has(n)).join(", ")}`,
    );
  });

  it("existing inputs are preserved: not removed, not newly required, same type/default, enums only widened", () => {
    const problems: string[] = [];

    for (const base of baseline.tools) {
      const cur = currentByName.get(base.name);
      if (!cur) continue; // reported by the missing-tools test

      for (const [inputName, baseSig] of Object.entries(base.inputs)) {
        const key = `${base.name}.${inputName}`;
        if (ALLOWED_CHANGES[key]) continue;
        const curSig = cur.inputs[inputName];

        if (!curSig) {
          problems.push(`${key}: input removed`);
          continue;
        }
        if (curSig.required && !baseSig.required) {
          problems.push(`${key}: became required`);
        }
        if (curSig.default !== baseSig.default) {
          problems.push(`${key}: default changed ${baseSig.default} -> ${curSig.default}`);
        }
        if (curSig.type !== baseSig.type) {
          const be = enumValues(baseSig.type);
          const ce = enumValues(curSig.type);
          const widened = be && ce && be.every((v) => ce.includes(v));
          if (!widened) problems.push(`${key}: type changed ${baseSig.type} -> ${curSig.type}`);
        }
      }

      for (const [inputName, curSig] of Object.entries(cur.inputs)) {
        const key = `${base.name}.${inputName}`;
        if (base.inputs[inputName] || ALLOWED_CHANGES[key]) continue;
        if (curSig.required) problems.push(`${key}: new input must be optional`);
      }

      if (JSON.stringify(base.annotations) !== JSON.stringify(cur.annotations) && !ALLOWED_CHANGES[`${base.name}.annotations`]) {
        problems.push(`${base.name}: annotations changed`);
      }
    }

    assert.deepEqual(problems, []);
  });

  it("new tools are read-only", () => {
    for (const name of EXPECTED_NEW_TOOLS) {
      const tool = currentByName.get(name);
      assert.ok(tool, `${name} should be registered`);
      assert.equal(tool!.annotations.readOnlyHint, true, `${name} must declare readOnlyHint`);
    }
  });
});
