#!/usr/bin/env tsx
/**
 * Snapshot of the MCP tool contract surface (names, input schemas, annotations).
 *
 * Starts the real server over STDIO with throw-away credentials (no network is
 * needed for `tools/list`), registers legacy aliases too, and normalizes every
 * tool into a compact, diff-friendly signature.
 *
 * Usage:
 *   tsx scripts/snapshot-tool-contracts.ts --out tests/baselines/tool-contracts-9.4.4.json
 *   tsx scripts/snapshot-tool-contracts.ts            # prints JSON to stdout
 *
 * Used by tests/unit/tool-contract-compat.test.ts to prove a release did not
 * remove, rename or narrow any existing tool input.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface InputSignature {
  required: boolean;
  /** Normalized type signature, e.g. "string", "number|string", "array<string>", "enum[a,b]". */
  type: string;
  /** JSON-serialised default (undefined when no default). */
  default?: string;
}

export interface ToolContract {
  name: string;
  descriptionSha256: string;
  inputs: Record<string, InputSignature>;
  annotations: Record<string, unknown>;
}

export interface ToolContractSnapshot {
  version: string;
  capturedAt: string;
  toolCount: number;
  tools: ToolContract[];
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function typeSignature(schema: any): string {
  if (!schema || typeof schema !== "object") return "any";
  if (Array.isArray(schema.enum)) return `enum[${schema.enum.map(String).sort().join(",")}]`;
  if (schema.const !== undefined) return `const[${String(schema.const)}]`;
  for (const key of ["anyOf", "oneOf"] as const) {
    if (Array.isArray(schema[key])) {
      const parts = schema[key].map(typeSignature).filter((p: string) => p !== "null");
      return Array.from(new Set(parts)).sort().join("|") || "any";
    }
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map(typeSignature).join("&");
  }
  const t = schema.type;
  if (Array.isArray(t)) return t.filter((x: string) => x !== "null").sort().join("|");
  if (t === "array") return `array<${typeSignature(schema.items)}>`;
  if (t === "object") {
    const props = schema.properties ? Object.keys(schema.properties).sort() : [];
    return props.length > 0 ? `object{${props.join(",")}}` : "object";
  }
  return typeof t === "string" ? t : "any";
}

export function normalizeTool(tool: any): ToolContract {
  const schema = tool.inputSchema ?? {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const inputs: Record<string, InputSignature> = {};
  for (const [name, prop] of Object.entries<any>(schema.properties ?? {})) {
    const sig: InputSignature = {
      required: required.includes(name),
      type: typeSignature(prop),
    };
    if (prop && Object.prototype.hasOwnProperty.call(prop, "default")) {
      sig.default = JSON.stringify(prop.default);
    }
    inputs[name] = sig;
  }
  return {
    name: tool.name,
    descriptionSha256: createHash("sha256").update(tool.description ?? "").digest("hex").slice(0, 16),
    inputs,
    annotations: tool.annotations ?? {},
  };
}

export async function captureToolContracts(): Promise<ToolContractSnapshot> {
  const pkg = JSON.parse(
    (await import("node:fs")).readFileSync(resolve(ROOT, "package.json"), "utf8"),
  );

  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && !/^ZEBRUNNER_/.test(k)) env[k] = v;
  }
  Object.assign(env, {
    ZEBRUNNER_URL: "https://contract-snapshot.example.com/api/public/v1",
    ZEBRUNNER_LOGIN: "snapshot-user",
    ZEBRUNNER_TOKEN: "snapshot-token",
    ZEBRUNNER_REGISTER_LEGACY_ALIASES: "true",
    MCP_SKIP_INTEGRITY_CHECK: "true",
    DEBUG: "false",
    MCP_AUTH_MODE: "",
  });

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", resolve(ROOT, "src/server.ts")],
    cwd: ROOT,
    env,
    stderr: "ignore",
  });
  const client = new Client({ name: "tool-contract-snapshot", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport);
    const tools: any[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined);
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    const contracts = tools.map(normalizeTool).sort((a, b) => a.name.localeCompare(b.name));
    return {
      version: pkg.version,
      capturedAt: new Date().toISOString(),
      toolCount: contracts.length,
      tools: contracts,
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const outIdx = process.argv.indexOf("--out");
  const snapshot = await captureToolContracts();
  const json = JSON.stringify(snapshot, null, 2) + "\n";
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    const outPath = resolve(process.cwd(), process.argv[outIdx + 1]);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, json, "utf8");
    console.error(`Wrote ${snapshot.toolCount} tool contracts (v${snapshot.version}) to ${outPath}`);
  } else {
    process.stdout.write(json);
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
