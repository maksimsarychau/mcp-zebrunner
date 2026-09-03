import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bundle from "../generated/tool-intel-bundle.json" with { type: "json" };
import type { PromptMeta } from "../prompts.js";
import type { ResourceMeta } from "../resources.js";
import {
  buildExpandedTools,
  catalogRecordToMap,
  parseRoleBenefits,
  parseToolsCatalog,
  parseToolsJson,
  shouldRegisterLegacyAliases,
  type RoleBenefit,
  type ToolCatalogEntry,
} from "./tool-intel-parse.js";

export type { ToolCatalogEntry } from "./tool-intel-parse.js";

export type ToolIntelSnapshot = {
  mcpVersion: string;
  tools: ToolCatalogEntry[];
  roleBenefits: RoleBenefit[];
};

const TOKEN_RANGE_DEFAULT = "Low (<=1k tokens)";

const TOKEN_RANGE_BY_TOOL: Record<string, string> = {
  adv_analyze_test_failure: "High (6k-12k tokens)",
  adv_detailed_analyze_launch_failures: "Very High (12k+ tokens)",
  adv_analyze_test_execution_video: "Very High (12k+ tokens)",
  adv_analyze_screenshot: "High (6k-12k tokens)",
  adv_generate_weekly_regression_stability_report: "High (6k-12k tokens)",
  adv_regression_results_analyzer: "High (6k-12k tokens)",
  adv_get_bug_review: "High (6k-12k tokens)",
  adv_get_bug_failure_info: "Medium (3k-6k tokens)",
  adv_analyze_test_cases_duplicates: "Medium (3k-6k tokens)",
  adv_analyze_test_cases_duplicates_semantic: "High (6k-12k tokens)",
  adv_aggregate_test_cases_by_feature: "High (6k-12k tokens)",
  adv_analyze_test_impact: "Low (1k-4k tokens)",
  adv_get_all_tcm_test_cases_by_project: "High (6k-12k tokens)",
  adv_get_all_tcm_test_cases_with_root_suite_id: "High (6k-12k tokens)",
  adv_get_all_launches_for_project: "Medium (3k-6k tokens)",
  adv_get_all_launches_with_filter: "Medium (3k-6k tokens)",
  adv_list_test_runs: "Medium (3k-6k tokens)",
  adv_list_test_run_test_cases: "Medium (3k-6k tokens)",
};

function projectRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(current, "..", "..");
}

function readTextSafe(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function readVersionFromPackageJson(root: string): string {
  const packageRaw = readTextSafe(path.join(root, "package.json"));
  try {
    const parsed = JSON.parse(packageRaw);
    if (typeof parsed?.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // keep "unknown"
  }
  return "unknown";
}

function shouldUseBundleFallback(): boolean {
  return (process.env.TOOL_INTEL_FORCE_BUNDLE ?? "").trim().toLowerCase() === "1";
}

function snapshotFromFilesystem(root: string, mcpVersion: string): ToolIntelSnapshot | null {
  const toolsJson = parseToolsJson(readTextSafe(path.join(root, "tools.json")));
  if (toolsJson.length === 0) return null;

  const catalogByTool = parseToolsCatalog(readTextSafe(path.join(root, "TOOLS_CATALOG.md")));
  const roleBenefits = parseRoleBenefits(
    readTextSafe(path.join(root, "docs", "AI_MCP_BENEFITS.md")),
  );

  return {
    mcpVersion,
    tools: buildExpandedTools(toolsJson, catalogByTool, shouldRegisterLegacyAliases()),
    roleBenefits,
  };
}

/** Load snapshot from embedded bundle (npm/Docker path). Exported for unit tests. */
export function loadToolIntelSnapshotFromBundle(mcpVersion: string): ToolIntelSnapshot {
  const catalogByTool = catalogRecordToMap(
    bundle.catalogByTool as Record<string, ToolCatalogEntry>,
  );
  const toolsJson: ToolCatalogEntry[] = (bundle.tools as ToolCatalogEntry[]).map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));

  return {
    mcpVersion,
    tools: buildExpandedTools(toolsJson, catalogByTool, shouldRegisterLegacyAliases()),
    roleBenefits: (bundle.roleBenefits as RoleBenefit[]) ?? [],
  };
}

export function loadToolIntelSnapshot(): ToolIntelSnapshot {
  const root = projectRoot();
  const mcpVersion = readVersionFromPackageJson(root);

  if (!shouldUseBundleFallback()) {
    const fromFs = snapshotFromFilesystem(root, mcpVersion);
    if (fromFs) return fromFs;
  }

  return loadToolIntelSnapshotFromBundle(mcpVersion);
}

export function tokenEstimateForTool(toolName: string): string {
  const legacyName = toolName.startsWith("adv_") ? toolName.slice("adv_".length) : toolName;
  return TOKEN_RANGE_BY_TOOL[toolName] || TOKEN_RANGE_BY_TOOL[legacyName] || TOKEN_RANGE_DEFAULT;
}

export function markdownForAllTools(snapshot: ToolIntelSnapshot, options: {
  includeExamples: boolean;
  includeTokenEstimates: boolean;
  includeRoleBenefits: boolean;
}): string {
  const lines: string[] = [];
  lines.push("# Using the Advanced Zebrunner MCP Server: Tools Summary");
  lines.push("");
  lines.push("All tools are registered under the canonical **`adv_<name>`** form (e.g. `adv_create_test_case`). Legacy short names without the `adv_` prefix are deprecated and only available when `ZEBRUNNER_REGISTER_LEGACY_ALIASES=true`.");
  lines.push("");
  lines.push(`MCP version: ${snapshot.mcpVersion}`);
  lines.push("");
  lines.push(`Total tools: ${snapshot.tools.length}`);
  lines.push("");

  if (options.includeRoleBenefits && snapshot.roleBenefits.length > 0) {
    lines.push("## Value by Role");
    for (const role of snapshot.roleBenefits) {
      lines.push(`- **${role.role}:** ${role.value}`);
    }
    lines.push("");
  }

  const groups = new Map<string, ToolCatalogEntry[]>();
  for (const tool of snapshot.tools) {
    const key = tool.category || "Uncategorized";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tool);
  }

  lines.push("## Tools by Category");
  lines.push("");
  for (const [category, tools] of groups) {
    const sorted = tools.slice().sort((a, b) => a.name.localeCompare(b.name));
    lines.push(`### ${category} (${sorted.length} tools)`);
    lines.push("");
    lines.push("| Tool | Description | Token Usage | Example |");
    lines.push("|------|-------------|-------------|---------|");
    for (const tool of sorted) {
      const description = tool.description || "N/A";
      const tokens = options.includeTokenEstimates ? tokenEstimateForTool(tool.name) : "N/A";
      const example = options.includeExamples && tool.examples && tool.examples.length > 0 ? tool.examples[0] : "N/A";
      lines.push(`| \`${tool.name}\` | ${description} | ${tokens} | ${example} |`);
    }
    lines.push("");
  }

  if (options.includeTokenEstimates) {
    lines.push("_Token usage is approximate and depends on filters, input size, and output format._");
  }

  return lines.join("\n");
}

export function markdownForToolDetails(snapshot: ToolIntelSnapshot, toolName: string, options: {
  includeExamples: boolean;
  includeTokenEstimates: boolean;
  includeRoleBenefits: boolean;
}): string {
  const tool = snapshot.tools.find(item => item.name === toolName);
  if (!tool) {
    const suggestions = snapshot.tools
      .map(item => item.name)
      .filter(name => name.toLowerCase().includes(toolName.toLowerCase()))
      .slice(0, 5);
    return suggestions.length
      ? `❌ Tool not found: ${toolName}\n\nDid you mean: ${suggestions.map(s => `\`${s}\``).join(", ")}?`
      : `❌ Tool not found: ${toolName}`;
  }

  const lines: string[] = [];
  lines.push(`# Using the Advanced Zebrunner MCP Server: Tool Details`);
  lines.push("");
  lines.push(`MCP version: ${snapshot.mcpVersion}`);
  lines.push("");
  lines.push(`## \`${tool.name}\``);
  lines.push(`- Category: ${tool.category || "General"}`);
  lines.push(`- Description: ${tool.description || "N/A"}`);
  if (options.includeTokenEstimates) {
    lines.push(`- Approx token usage: ${tokenEstimateForTool(tool.name)}`);
  }

  if (options.includeExamples && tool.examples && tool.examples.length > 0) {
    lines.push("- Example prompts:");
    for (const example of tool.examples.slice(0, 5)) {
      lines.push(`  - ${example}`);
    }
  }

  if (options.includeRoleBenefits && snapshot.roleBenefits.length > 0) {
    lines.push("");
    lines.push("## Role Impact");
    for (const role of snapshot.roleBenefits) {
      lines.push(`- **${role.role}:** ${role.value}`);
    }
  }

  if (options.includeTokenEstimates) {
    lines.push("");
    lines.push("_Token usage is approximate and depends on filters, input size, and output format._");
  }

  return lines.join("\n");
}

export function markdownForPrompts(prompts: PromptMeta[], mcpVersion: string): string {
  const lines: string[] = [];
  lines.push("# Advanced Zebrunner MCP — Prompts");
  lines.push("");
  lines.push(`MCP version: ${mcpVersion}`);
  lines.push("");
  lines.push(`Total prompts: ${prompts.length}`);
  lines.push("");
  lines.push("Prompts are pre-built workflow instructions selected via the **/** command in MCP clients.");
  lines.push("Each prompt injects expert instructions that guide the LLM through multi-tool orchestration.");
  lines.push("");

  const groups = new Map<string, PromptMeta[]>();
  for (const p of prompts) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category)!.push(p);
  }

  for (const [category, items] of groups) {
    lines.push(`## ${category}`);
    lines.push("");
    lines.push("| Prompt | Title | Description | Arguments |");
    lines.push("|--------|-------|-------------|-----------|");
    for (const p of items) {
      lines.push(`| \`/${p.name}\` | ${p.title} | ${p.description} | ${p.args.join(", ")} |`);
    }
    lines.push("");
  }

  lines.push("_Use `/prompt-name` in Claude Desktop or Claude Code to activate a prompt._");

  return lines.join("\n");
}

export function markdownForResources(resources: ResourceMeta[], mcpVersion: string): string {
  const lines: string[] = [];
  lines.push("# Advanced Zebrunner MCP — Resources");
  lines.push("");
  lines.push(`MCP version: ${mcpVersion}`);
  lines.push("");
  lines.push(`Total resources: ${resources.length}`);
  lines.push("");
  lines.push("Resources provide read-only reference data attached via the **@** menu (plug icon) in MCP clients.");
  lines.push("Static resources require no parameters. Template resources require a `{project_key}`.");
  lines.push("");

  const statics = resources.filter(r => r.type === "static");
  const templates = resources.filter(r => r.type === "template");

  if (statics.length > 0) {
    lines.push("## Static Resources (no parameters)");
    lines.push("");
    lines.push("| Resource | URI | Description |");
    lines.push("|----------|-----|-------------|");
    for (const r of statics) {
      lines.push(`| \`${r.name}\` | \`${r.uri}\` | ${r.description} |`);
    }
    lines.push("");
  }

  if (templates.length > 0) {
    lines.push("## Template Resources (require project_key)");
    lines.push("");
    lines.push("| Resource | URI Pattern | Description |");
    lines.push("|----------|-------------|-------------|");
    for (const r of templates) {
      lines.push(`| \`${r.name}\` | \`${r.uri}\` | ${r.description} |`);
    }
    lines.push("");
  }

  lines.push("_Use the @ menu or plug icon in your MCP client to browse and attach resources._");

  return lines.join("\n");
}
