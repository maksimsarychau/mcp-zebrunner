import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  loadToolIntelSnapshot,
  markdownForAllTools,
  markdownForToolDetails,
  tokenEstimateForTool
} from "../../src/utils/tool-intel.js";
import { TOOL_SMOKE_INPUTS } from "../helpers/tool-coverage-matrix.js";

function getProjectRoot() {
  return path.resolve(process.cwd());
}

function extractServerTools(serverSource: string): string[] {
  const regex = /server\.registerTool\(\s*"([^"]+)"/g;
  const tools: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(serverSource)) !== null) {
    tools.push(match[1]);
  }
  return tools;
}

describe("Tool Registry Coverage (53 tools)", () => {
  it("ensures every registered server tool has smoke coverage metadata", () => {
    const root = getProjectRoot();
    const serverSource = fs.readFileSync(path.join(root, "src", "server.ts"), "utf-8");
    const serverTools = extractServerTools(serverSource);

    assert.equal(serverTools.length, 53, "server.ts should register exactly 53 tools");
    assert.equal(new Set(serverTools).size, 53, "all registered tools should be unique");

    const coverageKeys = Object.keys(TOOL_SMOKE_INPUTS);
    assert.equal(coverageKeys.length, 53, "smoke coverage map should include 53 tools");

    const missingCoverage = serverTools.filter(tool => !(tool in TOOL_SMOKE_INPUTS));
    assert.deepEqual(missingCoverage, [], `missing smoke coverage for: ${missingCoverage.join(", ")}`);

    const extraCoverage = coverageKeys.filter(tool => !serverTools.includes(tool));
    assert.deepEqual(extraCoverage, [], `coverage has unknown tools: ${extraCoverage.join(", ")}`);
  });

  it("ensures tools.json stays in sync with server registrations", () => {
    const root = getProjectRoot();
    const serverSource = fs.readFileSync(path.join(root, "src", "server.ts"), "utf-8");
    const serverTools = extractServerTools(serverSource).sort();
    const toolsCatalog = JSON.parse(fs.readFileSync(path.join(root, "tools.json"), "utf-8")) as Array<{ name: string }>;
    const toolsJsonNames = toolsCatalog.map(t => t.name).sort();

    assert.deepEqual(
      toolsJsonNames,
      serverTools,
      "tools.json names must exactly match server.tool registrations"
    );
  });
});

describe("Critical Tool Intelligence Checks", () => {
  it("loads snapshot and includes newly added about tool", () => {
    const snapshot = loadToolIntelSnapshot();
    assert.ok(snapshot.mcpVersion && snapshot.mcpVersion !== "unknown", "snapshot should include MCP version");
    assert.ok(snapshot.tools.length >= 53, "tool intel snapshot should include all tools");
    assert.ok(snapshot.tools.some(tool => tool.name === "about_mcp_tools"), "about_mcp_tools should be present in snapshot");
  });

  it("provides non-empty token estimates for critical tools", () => {
    const critical = [
      "analyze_test_failure",
      "detailed_analyze_launch_failures",
      "analyze_test_execution_video",
      "generate_weekly_regression_stability_report",
      "about_mcp_tools"
    ];
    for (const tool of critical) {
      const estimate = tokenEstimateForTool(tool);
      assert.ok(typeof estimate === "string" && estimate.length > 0, `${tool} should have token estimate`);
    }
  });

  it("keeps category counts aligned with rendered rows", () => {
    const snapshot = loadToolIntelSnapshot();
    const markdown = markdownForAllTools(snapshot, {
      includeExamples: true,
      includeTokenEstimates: true,
      includeRoleBenefits: true
    });
    assert.ok(markdown.includes(`MCP version: ${snapshot.mcpVersion}`), "summary should include MCP version");

    const lines = markdown.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const heading = lines[i].match(/^###\s+(.+)\s+\((\d+)\s+tools\)$/);
      if (!heading) continue;
      const expected = Number(heading[2]);
      let rows = 0;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith("### ")) break;
        if (lines[j].startsWith("| `")) rows++;
      }
      assert.equal(rows, expected, `count mismatch for category "${heading[1]}"`);
    }
  });

  it("includes MCP version in tool-detail output", () => {
    const snapshot = loadToolIntelSnapshot();
    const markdown = markdownForToolDetails(snapshot, "about_mcp_tools", {
      includeExamples: true,
      includeTokenEstimates: true,
      includeRoleBenefits: true
    });
    assert.ok(markdown.includes(`MCP version: ${snapshot.mcpVersion}`), "tool details should include MCP version");
  });
});
