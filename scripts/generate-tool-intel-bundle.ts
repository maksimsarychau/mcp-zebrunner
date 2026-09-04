#!/usr/bin/env tsx
/**
 * Generates src/generated/tool-intel-bundle.json from tools.json, TOOLS_CATALOG.md,
 * and docs/AI_MCP_BENEFITS.md. Run via: npm run generate:tool-intel-bundle
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExpandedTools,
  catalogMapToRecord,
  parseRoleBenefits,
  parseToolsCatalog,
  parseToolsJson,
  type ToolCatalogEntry,
} from "../src/utils/tool-intel-parse.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function main(): void {
  const toolsPath = path.join(ROOT, "tools.json");
  const catalogPath = path.join(ROOT, "TOOLS_CATALOG.md");
  const benefitsPath = path.join(ROOT, "docs", "AI_MCP_BENEFITS.md");
  const outPath = path.join(ROOT, "src", "generated", "tool-intel-bundle.json");

  const toolsRaw = fs.readFileSync(toolsPath, "utf-8");
  const catalogRaw = fs.readFileSync(catalogPath, "utf-8");
  const benefitsRaw = fs.readFileSync(benefitsPath, "utf-8");

  const toolsJson = parseToolsJson(toolsRaw);
  const catalogByTool = parseToolsCatalog(catalogRaw);
  const roleBenefits = parseRoleBenefits(benefitsRaw);

  const tools: ToolCatalogEntry[] = buildExpandedTools(toolsJson, catalogByTool, false);

  if (tools.length === 0) {
    console.error("ERROR: generated bundle has zero tools");
    process.exit(1);
  }

  const bundle = {
    sourceHashes: {
      toolsJson: sha256(toolsRaw),
      catalog: sha256(catalogRaw),
      benefits: sha256(benefitsRaw),
    },
    tools,
    catalogByTool: catalogMapToRecord(catalogByTool),
    roleBenefits,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf-8");
  console.log(`Wrote ${outPath} (${tools.length} tools)`);
}

main();
