#!/usr/bin/env node
/**
 * One-shot: prefix documented tool names with adv_ (skip if already prefixed).
 * Run from repo root: node scripts/advify-tool-names.mjs [files...]
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tools = JSON.parse(fs.readFileSync(path.join(root, "tools.json"), "utf-8"));
const shortNames = tools
  .map((t) => t.name.replace(/^adv_/, ""))
  .sort((a, b) => b.length - a.length);

function advify(text) {
  const placeholder = "\uE000ADV\uE001";
  let out = text.replace(/adv_/g, placeholder);
  for (const name of shortNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re, `adv_${name}`);
  }
  out = out.replace(new RegExp(placeholder, "g"), "adv_");
  out = out.replace(/adv_adv_/g, "adv_");
  return out;
}

const defaultFiles = [
  "README.md",
  "TOOLS_CATALOG.md",
  "change-logs.md",
  "docs/AI_MCP_BENEFITS.md",
  "docs/EXECUTIVE_SUMMARY.md",
  "docs/EVALUATION_FRAMEWORK.md",
  "docs/INTELLIGENT_RULES_SYSTEM.md",
  "docs/LLM_AGENT_MCP_WORKFLOW_TEST_STRATEGIES.md",
  "docs/REPUBLISH_INSTRUCTIONS.md",
  "docs/RESOURCES_AND_PROMPTS.md",
  "docs/TERMINOLOGY.md",
  "docs/OFFICIAL_MCP_PARITY.md",
  "docs/HOSTING_GUIDE.md",
  "docs/RELEASE_SIGNING_GUIDE.md",
  "docs/TEST_PROMPTS.md",
  "src/resources.ts",
  "src/prompts.ts",
  "src/utils/tool-intel.ts",
];

const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles;

for (const rel of files) {
  const fp = path.join(root, rel);
  if (!fs.existsSync(fp)) {
    console.warn("skip (missing):", rel);
    continue;
  }
  const before = fs.readFileSync(fp, "utf-8");
  const after = advify(before);
  if (before !== after) {
    fs.writeFileSync(fp, after);
    console.log("updated:", rel);
  } else {
    console.log("unchanged:", rel);
  }
}
