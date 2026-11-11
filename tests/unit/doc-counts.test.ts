/**
 * Doc-count consistency: the tool inventory quoted in docs and manifests must match
 * what the server really registers (and tools.json lists).
 */
import { describe, it, before } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureToolContracts } from "../../scripts/snapshot-tool-contracts.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf-8");

let registeredAdvTools = 0;
const toolsJson = JSON.parse(read("tools.json")) as Array<{ name: string }>;

before(async () => {
  const snapshot = await captureToolContracts();
  registeredAdvTools = snapshot.tools.filter((t) => t.name.startsWith("adv_")).length;
});

describe("tool inventory counts", () => {
  it("tools.json matches the registered adv_ tools", () => {
    assert.equal(toolsJson.length, registeredAdvTools);
    assert.equal(new Set(toolsJson.map((t) => t.name)).size, toolsJson.length, "tools.json names are unique");
  });

  const quoted: Array<[string, RegExp]> = [
    ["custom-catalog.yaml", /(\d+) adv_\* tools/],
    ["mcp-catalog.yaml", /(\d+) adv_\* tools/],
    ["server.json", /(\d+) adv_\* tools/],
    ["TOOLS_CATALOG.md", /catalog covers \*\*(\d+)\*\* `adv_\*` tools/],
    ["README.md", /highlights all \*\*(\d+)\*\* `adv_\*` tools/],
    ["README.md", /Complete catalog of all \*\*(\d+)\*\* `adv_\*` tools/],
    ["docs/EXECUTIVE_SUMMARY.md", /\*\*(\d+)\*\* `adv_\*` tools in/],
    ["docs/EVALUATION_FRAMEWORK.md", /exposes \*\*(\d+)\*\* registered `adv_\*` tools/],
    ["docs/RESOURCES_AND_PROMPTS.md", /existing \*\*(\d+)\*\* `adv_\*` tools/],
    ["docs/TEST_PROMPTS.md", /all \*\*(\d+)\*\* registered `adv_\*` tools with brief/],
  ];
  for (const [file, re] of quoted) {
    it(`${file} quotes the real tool count (${re.source.slice(0, 40)}...)`, () => {
      const m = re.exec(read(file));
      assert.ok(m, `${file}: pattern ${re} not found; update the doc or this test`);
      assert.equal(Number(m![1]), registeredAdvTools);
    });
  }

  it("TOOLS_CATALOG.md documents every tool in tools.json", () => {
    const catalog = read("TOOLS_CATALOG.md");
    const missing = toolsJson.filter((t) => !catalog.includes(`### \`${t.name}\``)).map((t) => t.name);
    assert.deepEqual(missing, [], `tools missing from TOOLS_CATALOG.md: ${missing.join(", ")}`);
  });

  it("the three artifact tools are documented everywhere they should be", () => {
    for (const tool of ["adv_list_test_artifacts", "adv_get_file_metadata", "adv_download_artifact"]) {
      assert.ok(toolsJson.some((t) => t.name === tool), `${tool} in tools.json`);
      assert.ok(read("README.md").includes(tool), `${tool} in README.md`);
      assert.ok(read("docs/TEST_PROMPTS.md").includes(tool), `${tool} in TEST_PROMPTS.md`);
      assert.ok(read("change-logs.md").includes(tool), `${tool} in change-logs.md`);
    }
  });
});
