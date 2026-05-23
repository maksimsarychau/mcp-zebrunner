import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PromptMeta } from "../prompts.js";
import type { ResourceMeta } from "../resources.js";

export type ToolCatalogEntry = {
  name: string;
  description: string;
  category?: string | null;
  examples?: string[];
};

export type ToolIntelSnapshot = {
  mcpVersion: string;
  tools: ToolCatalogEntry[];
  roleBenefits: Array<{ role: string; value: string }>;
};

const TOKEN_RANGE_DEFAULT = "Low (<=1k tokens)";

const TOKEN_RANGE_BY_TOOL: Record<string, string> = {
  analyze_test_failure: "High (6k-12k tokens)",
  detailed_analyze_launch_failures: "Very High (12k+ tokens)",
  analyze_test_execution_video: "Very High (12k+ tokens)",
  analyze_screenshot: "High (6k-12k tokens)",
  generate_weekly_regression_stability_report: "High (6k-12k tokens)",
  regression_results_analyzer: "High (6k-12k tokens)",
  get_bug_review: "High (6k-12k tokens)",
  get_bug_failure_info: "Medium (3k-6k tokens)",
  analyze_test_cases_duplicates: "Medium (3k-6k tokens)",
  analyze_test_cases_duplicates_semantic: "High (6k-12k tokens)",
  aggregate_test_cases_by_feature: "High (6k-12k tokens)",
  get_all_tcm_test_cases_by_project: "High (6k-12k tokens)",
  get_all_tcm_test_cases_with_root_suite_id: "High (6k-12k tokens)",
  get_all_launches_for_project: "Medium (3k-6k tokens)",
  get_all_launches_with_filter: "Medium (3k-6k tokens)",
  list_test_runs: "Medium (3k-6k tokens)",
  list_test_run_test_cases: "Medium (3k-6k tokens)"
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

function parseToolsJson(raw: string): ToolCatalogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: any) => item && typeof item.name === "string")
      .map((item: any) => ({
        name: item.name,
        description: typeof item.description === "string" ? item.description : ""
      }));
  } catch {
    return [];
  }
}

function parseToolsCatalog(raw: string): Map<string, ToolCatalogEntry> {
  const result = new Map<string, ToolCatalogEntry>();
  if (!raw) return result;

  const lines = raw.split(/\r?\n/);
  let category: string | null = null;
  let current: ToolCatalogEntry | null = null;
  let inExamples = false;

  const flush = () => {
    if (current) result.set(current.name, current);
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      category = line.replace(/^##\s+/, "").trim();
      continue;
    }

    const toolMatch = line.match(/^###\s+`([^`]+)`/);
    if (toolMatch) {
      flush();
      current = {
        name: toolMatch[1],
        description: "",
        category,
        examples: []
      };
      inExamples = false;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("**Description:**")) {
      current.description = line.replace("**Description:**", "").trim();
      continue;
    }

    if (line.startsWith("**Example Prompts:**")) {
      inExamples = true;
      continue;
    }

    if (line.startsWith("**") && !line.startsWith("**Example Prompts:**")) {
      inExamples = false;
      continue;
    }

    if (inExamples && line.trim().startsWith("- ")) {
      current.examples?.push(line.trim().replace(/^- /, ""));
    }
  }

  flush();
  return result;
}

function parseRoleBenefits(raw: string): Array<{ role: string; value: string }> {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const entries: Array<{ role: string; value: string }> = [];
  let tableActive = false;

  for (const line of lines) {
    if (line.startsWith("| Role |")) {
      tableActive = true;
      continue;
    }
    if (!tableActive) continue;
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map(cell => cell.trim()).filter(Boolean);
    if (cells.length < 2 || cells[0] === "Role" || cells[0].startsWith("------")) continue;
    entries.push({
      role: cells[0].replace(/\*\*/g, ""),
      value: cells[1].replace(/\*\*/g, "")
    });
  }

  return entries;
}

export function loadToolIntelSnapshot(): ToolIntelSnapshot {
  const root = projectRoot();
  const packageRaw = readTextSafe(path.join(root, "package.json"));
  const tools = parseToolsJson(readTextSafe(path.join(root, "tools.json")));
  const catalogByTool = parseToolsCatalog(readTextSafe(path.join(root, "TOOLS_CATALOG.md")));
  const roleBenefits = parseRoleBenefits(readTextSafe(path.join(root, "docs", "AI_MCP_BENEFITS.md")));
  let mcpVersion = "unknown";
  try {
    const parsed = JSON.parse(packageRaw);
    if (typeof parsed?.version === "string" && parsed.version.length > 0) {
      mcpVersion = parsed.version;
    }
  } catch {
    // keep "unknown"
  }

  // Expand the canonical tools.json list (still keyed by legacy names) into
  // the dual-name registry the server actually exposes at runtime:
  //   - "adv_<name>"  — primary / canonical (description carries the
  //                     [Advanced Zebrunner MCP] prefix).
  //   - "<name>"      — deprecated alias, included ONLY when the legacy-alias
  //                     env var is set (matches src/server.ts behaviour).
  // The TOOLS_CATALOG.md is keyed by legacy names; the catalog entry is shared
  // by both rows so descriptions and examples stay consistent.
  const ADV_PREFIX = "adv_";
  const ADV_DESC_PREFIX = "[Advanced Zebrunner MCP] ";
  const LEGACY_ALIAS_TRUTHY = ["1", "true", "yes", "on"];
  const registerLegacyAliases = LEGACY_ALIAS_TRUTHY.includes(
    (process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES ?? "").trim().toLowerCase()
  );
  const expanded: ToolCatalogEntry[] = [];
  for (const tool of tools) {
    const legacyName = tool.name;
    const advName = `${ADV_PREFIX}${legacyName}`;
    const catalog = catalogByTool.get(legacyName);
    const baseDescription = catalog?.description || tool.description || "";
    const category = catalog?.category ?? null;
    const examples = catalog?.examples ?? [];

    expanded.push({
      name: advName,
      description: `${ADV_DESC_PREFIX}${baseDescription}`,
      category,
      examples
    });
    if (registerLegacyAliases) {
      expanded.push({
        name: legacyName,
        description: `[deprecated alias — use ${advName}] ${baseDescription}`,
        category,
        examples
      });
    }
  }

  return {
    mcpVersion,
    tools: expanded,
    roleBenefits
  };
}

export function tokenEstimateForTool(toolName: string): string {
  // Token estimates are keyed by the legacy (un-prefixed) tool name; if the
  // caller passes the `adv_<name>` form, strip the prefix before looking up.
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
  lines.push("Tools are registered under two names: the recommended `adv_<name>` form (e.g. `adv_create_test_case`) and a deprecated legacy alias (`<name>`) kept for backward compatibility. Prefer the `adv_` form in new prompts and scripts.");
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
