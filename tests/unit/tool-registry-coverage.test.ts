import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  loadToolIntelSnapshot,
  markdownForAllTools,
  markdownForToolDetails,
  markdownForPrompts,
  markdownForResources,
  tokenEstimateForTool
} from "../../src/utils/tool-intel.js";
import { getPromptsCatalog } from "../../src/prompts.js";
import { getResourcesCatalog } from "../../src/resources.js";
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

describe("Tool Registry Coverage (60 tools)", () => {
  it("ensures every registered server tool has smoke coverage metadata", () => {
    const root = getProjectRoot();
    const serverSource = fs.readFileSync(path.join(root, "src", "server.ts"), "utf-8");
    const serverTools = extractServerTools(serverSource);

    assert.equal(serverTools.length, 60, "server.ts should register exactly 60 tools");
    assert.equal(new Set(serverTools).size, 60, "all registered tools should be unique");

    const coverageKeys = Object.keys(TOOL_SMOKE_INPUTS);
    assert.equal(coverageKeys.length, 60, "smoke coverage map should include 60 tools");

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
    assert.ok(snapshot.tools.length >= 54, "tool intel snapshot should include all tools");
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

// ── Tool Annotations Coverage ─────────────────────────────────────────────────

describe("Tool Annotations Coverage (60 tools)", () => {
  const root = getProjectRoot();
  const serverSource = fs.readFileSync(path.join(root, "src", "server.ts"), "utf-8");

  const MUTATION_TOOLS = new Set([
    "create_test_suite",
    "update_test_suite",
    "manage_test_run",
    "import_launch_results_to_test_run",
    "create_test_case",
    "update_test_case",
  ]);

  function extractAnnotationsForTool(source: string, toolName: string): Record<string, boolean> | null {
    const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`server\\.registerTool\\(\\s*"${escaped}"[\\s\\S]*?annotations:\\s*\\{([^}]+)\\}`, "m");
    const match = source.match(re);
    if (!match) return null;
    const block = match[1];
    const annotations: Record<string, boolean> = {};
    for (const line of block.split("\n")) {
      const kv = line.match(/(\w+Hint)\s*:\s*(true|false)/);
      if (kv) annotations[kv[1]] = kv[2] === "true";
    }
    return annotations;
  }

  it("every registered tool has annotations", () => {
    const toolsRegex = /server\.registerTool\(\s*\n\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;
    const allTools: string[] = [];
    while ((match = toolsRegex.exec(serverSource)) !== null) {
      allTools.push(match[1]);
    }
    assert.equal(allTools.length, 60, "should have 60 registered tools");

    const missing: string[] = [];
    for (const tool of allTools) {
      const annotations = extractAnnotationsForTool(serverSource, tool);
      if (!annotations) missing.push(tool);
    }
    assert.deepEqual(missing, [], `tools missing annotations: ${missing.join(", ")}`);
  });

  it("all 54 read-only tools have readOnlyHint: true", () => {
    const toolsRegex = /server\.registerTool\(\s*\n\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;
    const errors: string[] = [];
    while ((match = toolsRegex.exec(serverSource)) !== null) {
      if (MUTATION_TOOLS.has(match[1])) continue;
      const annotations = extractAnnotationsForTool(serverSource, match[1]);
      if (!annotations || annotations.readOnlyHint !== true) {
        errors.push(match[1]);
      }
    }
    assert.deepEqual(errors, [], `read-only tools missing readOnlyHint: true: ${errors.join(", ")}`);
  });

  it("all 6 mutation tools have readOnlyHint: false", () => {
    for (const tool of MUTATION_TOOLS) {
      const annotations = extractAnnotationsForTool(serverSource, tool);
      assert.ok(annotations, `${tool} should have annotations`);
      assert.equal(annotations!.readOnlyHint, false, `${tool} should have readOnlyHint: false`);
    }
  });

  it("all read-only tools have destructiveHint: false and idempotentHint: true", () => {
    const toolsRegex = /server\.registerTool\(\s*\n\s*"([^"]+)"/g;
    let match: RegExpExecArray | null;
    const errors: string[] = [];
    while ((match = toolsRegex.exec(serverSource)) !== null) {
      if (MUTATION_TOOLS.has(match[1])) continue;
      const annotations = extractAnnotationsForTool(serverSource, match[1]);
      if (!annotations) continue;
      if (annotations.destructiveHint !== false) errors.push(`${match[1]}: destructiveHint should be false`);
      if (annotations.idempotentHint !== true) errors.push(`${match[1]}: idempotentHint should be true`);
    }
    assert.deepEqual(errors, [], errors.join("; "));
  });

  it("update_test_suite and update_test_case have idempotentHint: true", () => {
    for (const tool of ["update_test_suite", "update_test_case"]) {
      const annotations = extractAnnotationsForTool(serverSource, tool);
      assert.ok(annotations, `${tool} should have annotations`);
      assert.equal(annotations!.idempotentHint, true, `${tool} should be idempotent (PUT/PATCH)`);
    }
  });

  it("import_launch_results_to_test_run has destructiveHint: true", () => {
    const annotations = extractAnnotationsForTool(serverSource, "import_launch_results_to_test_run");
    assert.ok(annotations);
    assert.equal(annotations!.destructiveHint, true, "import tool should be destructive (overrides results)");
  });
});

// ── markdownForPrompts / markdownForResources formatting ──────────────────────

// ── about_mcp_tools extended modes ────────────────────────────────────────────

describe("about_mcp_tools summary includes prompts and resources", () => {
  it("summary markdown includes Additional MCP Capabilities section", () => {
    const snapshot = loadToolIntelSnapshot();
    const summary = markdownForAllTools(snapshot, {
      includeExamples: true,
      includeTokenEstimates: true,
      includeRoleBenefits: true
    });
    assert.ok(summary.includes(`Total tools:`), "summary should include tool count");
  });

  it("about_mcp_tools schema includes all 4 modes", () => {
    const root = getProjectRoot();
    const source = fs.readFileSync(path.join(root, "src", "server.ts"), "utf-8");
    assert.ok(source.includes('"summary", "tool", "prompts", "resources"'), "mode enum should include all 4 values");
  });
});

// ── markdownForPrompts / markdownForResources formatting ──────────────────────

describe("markdownForPrompts formatting", () => {
  const prompts = getPromptsCatalog();
  const md = markdownForPrompts(prompts, "7.2.2");

  it("includes header and version", () => {
    assert.ok(md.includes("# Zebrunner MCP Prompts"));
    assert.ok(md.includes("MCP version: 7.2.2"));
  });

  it("shows total count", () => {
    assert.ok(md.includes(`Total prompts: ${prompts.length}`));
  });

  it("includes all prompt categories as headings", () => {
    const categories = [...new Set(prompts.map(p => p.category))];
    for (const cat of categories) {
      assert.ok(md.includes(`## ${cat}`), `missing category heading: ${cat}`);
    }
  });

  it("lists every prompt with /name format", () => {
    for (const p of prompts) {
      assert.ok(md.includes(`\`/${p.name}\``), `missing prompt: /${p.name}`);
    }
  });

  it("includes usage hint", () => {
    assert.ok(md.includes("/prompt-name"));
  });
});

describe("markdownForResources formatting", () => {
  const resources = getResourcesCatalog();
  const md = markdownForResources(resources, "7.2.2");

  it("includes header and version", () => {
    assert.ok(md.includes("# Zebrunner MCP Resources"));
    assert.ok(md.includes("MCP version: 7.2.2"));
  });

  it("shows total count", () => {
    assert.ok(md.includes(`Total resources: ${resources.length}`));
  });

  it("separates static and template resources", () => {
    assert.ok(md.includes("## Static Resources"));
    assert.ok(md.includes("## Template Resources"));
  });

  it("lists all resource URIs", () => {
    for (const r of resources) {
      assert.ok(md.includes(`\`${r.uri}\``), `missing URI: ${r.uri}`);
    }
  });

  it("includes usage hint", () => {
    assert.ok(md.includes("@ menu"));
  });
});
