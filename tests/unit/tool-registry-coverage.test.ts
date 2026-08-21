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
  const regex = /server\.registerTool\(\s*['"]([^'"]+)['"]/g;
  const tools: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(serverSource)) !== null) {
    tools.push(match[1]);
  }
  return tools;
}

function extractAllRegisteredTools(root: string): string[] {
    const files = [
    path.join(root, "src", "server.ts"),
    path.join(root, "src", "handlers", "widget-hub-tools.ts"),
    path.join(root, "src", "handlers", "widget-authoring-trend-tool.ts"),
  ];
  return files.flatMap(f => extractServerTools(fs.readFileSync(f, "utf-8")));
}

function extractHandlerModuleTools(root: string): string[] {
  const handlerFiles = [
    path.join(root, "src", "handlers", "scaffold-test-case-tool.ts"),
    path.join(root, "src", "handlers", "analyze-test-impact-tool.ts"),
  ];
  return handlerFiles.flatMap((f) => extractServerTools(fs.readFileSync(f, "utf-8")));
}

describe("Tool Registry Coverage (69 tools)", () => {
  it("ensures every registered server tool has smoke coverage metadata", () => {
    const root = getProjectRoot();
    const serverTools = extractAllRegisteredTools(root);

    assert.equal(serverTools.length, 69, "registered tools should total exactly 69");
    assert.equal(new Set(serverTools).size, 69, "all registered tools should be unique");

    const coverageKeys = Object.keys(TOOL_SMOKE_INPUTS);
    assert.equal(coverageKeys.length, 69, "smoke coverage map should include 69 tools");

    const missingCoverage = serverTools.filter(tool => !( `adv_${tool}` in TOOL_SMOKE_INPUTS));
    assert.deepEqual(missingCoverage, [], `missing smoke coverage for: ${missingCoverage.join(", ")}`);

    const advServerTools = serverTools.map(t => `adv_${t}`);
    const extraCoverage = coverageKeys.filter(tool => !advServerTools.includes(tool));
    assert.deepEqual(extraCoverage, [], `coverage has unknown tools: ${extraCoverage.join(", ")}`);
  });

  it("ensures tools.json stays in sync with server registrations", () => {
    const root = getProjectRoot();
    // The scaffold wizard lives in its own DI module (shared config/handler style)
    // and is not part of the inline-registration smoke/annotation coverage above,
    // but it IS a real registered tool documented in tools.json — include it here.
    const handlerModuleTools = extractHandlerModuleTools(root);
    const serverTools = [...extractAllRegisteredTools(root), ...handlerModuleTools].map((t) => `adv_${t}`).sort();
    const toolsCatalog = JSON.parse(fs.readFileSync(path.join(root, "tools.json"), "utf-8")) as Array<{ name: string }>;
    const toolsJsonNames = toolsCatalog.map(t => t.name).sort();

    assert.deepEqual(
      toolsJsonNames,
      serverTools,
      "tools.json names must match adv_<server registration> names"
    );
  });
});

describe("Critical Tool Intelligence Checks", () => {
  it("loads snapshot and includes newly added about tool under adv_ form", () => {
    const snapshot = loadToolIntelSnapshot();
    assert.ok(snapshot.mcpVersion && snapshot.mcpVersion !== "unknown", "snapshot should include MCP version");
    assert.ok(snapshot.tools.length >= 54, "tool intel snapshot should include all tools");
    assert.ok(
      snapshot.tools.some(tool => tool.name === "adv_about_mcp_tools"),
      "adv_about_mcp_tools should be present in snapshot (v9.0.0 adv_ prefix is mandatory)"
    );
  });

  it("provides non-empty token estimates for critical tools (both adv_ and legacy forms)", () => {
    const critical = [
      "adv_analyze_test_failure",
      "adv_detailed_analyze_launch_failures",
      "adv_analyze_test_execution_video",
      "adv_generate_weekly_regression_stability_report",
      "adv_about_mcp_tools",
      // legacy-name lookups still resolve thanks to tokenEstimateForTool's
      // automatic adv_ prefix stripping, in case prompts pass the old form.
      "analyze_test_failure",
      "about_mcp_tools",
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
    const markdown = markdownForToolDetails(snapshot, "adv_about_mcp_tools", {
      includeExamples: true,
      includeTokenEstimates: true,
      includeRoleBenefits: true
    });
    assert.ok(markdown.includes(`MCP version: ${snapshot.mcpVersion}`), "tool details should include MCP version");
  });
});

// ── Tool Annotations Coverage ─────────────────────────────────────────────────

describe("Tool Annotations Coverage (69 tools)", () => {
  const root = getProjectRoot();
  const registrationSource = [
    fs.readFileSync(path.join(root, "src", "server.ts"), "utf-8"),
    fs.readFileSync(path.join(root, "src", "handlers", "widget-hub-tools.ts"), "utf-8"),
    fs.readFileSync(path.join(root, "src", "handlers", "widget-authoring-trend-tool.ts"), "utf-8"),
  ].join("\n");

  const MUTATION_TOOLS = new Set([
    "create_test_suite",
    "update_test_suite",
    "manage_test_run",
    "import_launch_results_to_test_run",
    "rerun_launch_failures",
    "start_launch",
    "create_test_case",
    "update_test_case",
  ]);

  function extractAnnotationsForTool(source: string, toolName: string): Record<string, boolean> | null {
    const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`server\\.registerTool\\(\\s*['"]${escaped}['"][\\s\\S]*?annotations:\\s*\\{([^}]+)\\}`, "m");
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
    const toolsRegex = /server\.registerTool\(\s*[\n\s]*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const allTools: string[] = [];
    while ((match = toolsRegex.exec(registrationSource)) !== null) {
      allTools.push(match[1]);
    }
    assert.equal(allTools.length, 69, "should have 69 registered tools");

    const missing: string[] = [];
    for (const tool of allTools) {
      const annotations = extractAnnotationsForTool(registrationSource, tool);
      if (!annotations) missing.push(tool);
    }
    assert.deepEqual(missing, [], `tools missing annotations: ${missing.join(", ")}`);
  });

  it("all 55 read-only tools have readOnlyHint: true", () => {
    const toolsRegex = /server\.registerTool\(\s*[\n\s]*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const errors: string[] = [];
    while ((match = toolsRegex.exec(registrationSource)) !== null) {
      if (MUTATION_TOOLS.has(match[1])) continue;
      const annotations = extractAnnotationsForTool(registrationSource, match[1]);
      if (!annotations || annotations.readOnlyHint !== true) {
        errors.push(match[1]);
      }
    }
    assert.deepEqual(errors, [], `read-only tools missing readOnlyHint: true: ${errors.join(", ")}`);
  });

  it("all 8 mutation tools have readOnlyHint: false", () => {
    for (const tool of MUTATION_TOOLS) {
      const annotations = extractAnnotationsForTool(registrationSource, tool);
      assert.ok(annotations, `${tool} should have annotations`);
      assert.equal(annotations!.readOnlyHint, false, `${tool} should have readOnlyHint: false`);
    }
  });

  it("all read-only tools have destructiveHint: false and idempotentHint: true", () => {
    const toolsRegex = /server\.registerTool\(\s*[\n\s]*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    const errors: string[] = [];
    while ((match = toolsRegex.exec(registrationSource)) !== null) {
      if (MUTATION_TOOLS.has(match[1])) continue;
      const annotations = extractAnnotationsForTool(registrationSource, match[1]);
      if (!annotations) continue;
      if (annotations.destructiveHint !== false) errors.push(`${match[1]}: destructiveHint should be false`);
      if (annotations.idempotentHint !== true) errors.push(`${match[1]}: idempotentHint should be true`);
    }
    assert.deepEqual(errors, [], errors.join("; "));
  });

  it("update_test_suite and update_test_case have idempotentHint: true", () => {
    for (const tool of ["update_test_suite", "update_test_case"]) {
      const annotations = extractAnnotationsForTool(registrationSource, tool);
      assert.ok(annotations, `${tool} should have annotations`);
      assert.equal(annotations!.idempotentHint, true, `${tool} should be idempotent (PUT/PATCH)`);
    }
  });

  it("import_launch_results_to_test_run has destructiveHint: true", () => {
    const annotations = extractAnnotationsForTool(registrationSource, "import_launch_results_to_test_run");
    assert.ok(annotations);
    assert.equal(annotations!.destructiveHint, true, "import tool should be destructive (overrides results)");
  });

  it("rerun_launch_failures has destructiveHint: true", () => {
    const annotations = extractAnnotationsForTool(registrationSource, "rerun_launch_failures");
    assert.ok(annotations);
    assert.equal(annotations!.destructiveHint, true, "rerun tool should be destructive (triggers CI)");
    assert.equal(annotations!.idempotentHint, false, "rerun tool should not be idempotent");
  });

  it("start_launch has destructiveHint: true", () => {
    const annotations = extractAnnotationsForTool(registrationSource, "start_launch");
    assert.ok(annotations);
    assert.equal(annotations!.destructiveHint, true, "start_launch should be destructive (triggers CI)");
    assert.equal(annotations!.idempotentHint, false, "start_launch should not be idempotent");
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
    assert.ok(md.includes("# Advanced Zebrunner MCP — Prompts"));
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
    assert.ok(md.includes("# Advanced Zebrunner MCP — Resources"));
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
