#!/usr/bin/env tsx
/**
 * One-command regression self-check: proves existing tools and functionality still work.
 *
 *   npm run self-check          offline: no credentials or network needed
 *   npm run self-check:live     offline steps + live checks (needs ZEBRUNNER_URL/LOGIN/TOKEN)
 *
 * Offline steps (in order):
 *   1. lint                tsc --noEmit
 *   2. build               regenerates the tool-intel bundle and compiles to dist/
 *   3. unit tests          includes tool-contract compat vs the 9.4.4 baseline, golden outputs,
 *                          parser contract, failure isolation, version + doc counts, secret leak
 *   4. verify-rename       built server over STDIO: every tool is adv_<name>, alias behaviour
 *   5. registry smoke      every registered tool has a description, annotations and a tools.json entry
 *
 * Live steps (--live): smoke against the real workspace, api-verify.sh, MCP pagination audit.
 *
 * Exit code is non-zero when any step fails. A step that cannot run (for example live steps
 * without credentials) is reported as SKIP and never counted as a pass.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const LIVE = args.has("--live");
const VERBOSE = args.has("--verbose");

type Status = "PASS" | "FAIL" | "SKIP";
interface StepResult {
  name: string;
  status: Status;
  ms: number;
  detail?: string;
}

function run(cmd: string, cmdArgs: string[], opts: { env?: NodeJS.ProcessEnv } = {}): Promise<{ code: number; output: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: ROOT,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => {
      output += d;
      if (VERBOSE) process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      output += d;
      if (VERBOSE) process.stderr.write(d);
    });
    child.on("error", (e) => resolvePromise({ code: 1, output: `${output}\n${e.message}` }));
    child.on("close", (code) => resolvePromise({ code: code ?? 1, output }));
  });
}

function tail(text: string, lines = 25): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

async function step(name: string, fn: () => Promise<{ ok: boolean; detail?: string; skip?: boolean }>): Promise<StepResult> {
  const started = Date.now();
  process.stdout.write(`▶ ${name} ... `);
  try {
    const r = await fn();
    const status: Status = r.skip ? "SKIP" : r.ok ? "PASS" : "FAIL";
    const ms = Date.now() - started;
    console.log(`${status} (${(ms / 1000).toFixed(1)}s)`);
    if (status === "FAIL" && r.detail) console.log(indent(r.detail));
    if (status === "SKIP" && r.detail) console.log(indent(r.detail));
    return { name, status, ms, detail: r.detail };
  } catch (error) {
    const ms = Date.now() - started;
    const detail = error instanceof Error ? error.message : String(error);
    console.log(`FAIL (${(ms / 1000).toFixed(1)}s)`);
    console.log(indent(detail));
    return { name, status: "FAIL", ms, detail };
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

function npm(script: string): Promise<{ code: number; output: string }> {
  return run("npm", ["run", "--silent", script]);
}

function hasCredentials(): boolean {
  if (process.env.ZEBRUNNER_URL && process.env.ZEBRUNNER_LOGIN && process.env.ZEBRUNNER_TOKEN) return true;
  const envFile = resolve(ROOT, ".env");
  if (!existsSync(envFile)) return false;
  const text = readFileSync(envFile, "utf-8");
  return ["ZEBRUNNER_URL", "ZEBRUNNER_LOGIN", "ZEBRUNNER_TOKEN"].every((k) => new RegExp(`^${k}=.+`, "m").test(text));
}

async function registrySmoke(): Promise<{ ok: boolean; detail?: string }> {
  const { captureToolContracts } = await import("./snapshot-tool-contracts.js");
  const snapshot = await captureToolContracts();
  const adv = snapshot.tools.filter((t) => t.name.startsWith("adv_"));
  const toolsJson = JSON.parse(readFileSync(resolve(ROOT, "tools.json"), "utf-8")) as Array<{ name: string }>;
  const problems: string[] = [];

  const listed = new Set(toolsJson.map((t) => t.name));
  for (const t of adv) {
    if (!listed.has(t.name)) problems.push(`${t.name}: missing from tools.json`);
    if (!t.descriptionSha256) problems.push(`${t.name}: empty description`);
    if (!t.annotations || Object.keys(t.annotations).length === 0) problems.push(`${t.name}: no annotations`);
  }
  const registered = new Set(adv.map((t) => t.name));
  for (const name of listed) if (!registered.has(name)) problems.push(`${name}: in tools.json but not registered`);

  const readOnlyArtifactTools = ["adv_list_test_artifacts", "adv_get_file_metadata", "adv_download_artifact"];
  for (const name of readOnlyArtifactTools) {
    const tool = adv.find((t) => t.name === name);
    if (!tool) problems.push(`${name}: not registered`);
    else if (tool.annotations.readOnlyHint !== true) problems.push(`${name}: must be readOnlyHint=true`);
  }

  return problems.length === 0
    ? { ok: true, detail: `${adv.length} adv_ tools checked` }
    : { ok: false, detail: problems.slice(0, 30).join("\n") };
}

async function main() {
  console.log(`Zebrunner MCP self-check (${LIVE ? "offline + live" : "offline"})\n`);
  const results: StepResult[] = [];

  results.push(
    await step("lint (tsc --noEmit)", async () => {
      const r = await npm("lint");
      return { ok: r.code === 0, detail: tail(r.output) };
    }),
  );

  results.push(
    await step("build (tool-intel bundle + tsc)", async () => {
      const r = await npm("build");
      return { ok: r.code === 0, detail: tail(r.output) };
    }),
  );

  results.push(
    await step("unit tests (contracts, golden, parser, isolation, version, doc counts, secrets)", async () => {
      const r = await npm("test:unit");
      const failed = /fail (\d+)/i.exec(r.output);
      const ok = r.code === 0 && !(failed && Number(failed[1]) > 0);
      return { ok, detail: tail(r.output, 40) };
    }),
  );

  results.push(
    await step("verify-rename (built server over STDIO)", async () => {
      if (!existsSync(resolve(ROOT, "dist/server.js"))) return { ok: false, detail: "dist/server.js missing (build failed?)" };
      // Throw-away credentials: tools/list needs no network.
      // MCP_SKIP_INTEGRITY_CHECK is the documented dev switch: the release signature covers the
      // original sources, so a modified working tree would otherwise stop the server at startup.
      const r = await run("node", ["scripts/verify-rename.mjs"], {
        env: {
          MCP_SKIP_INTEGRITY_CHECK: "true",
          ZEBRUNNER_URL: process.env.ZEBRUNNER_URL || "https://self-check.invalid/api/public/v1",
          ZEBRUNNER_LOGIN: process.env.ZEBRUNNER_LOGIN || "self-check",
          ZEBRUNNER_TOKEN: process.env.ZEBRUNNER_TOKEN || "self-check",
        },
      });
      return { ok: r.code === 0, detail: tail(r.output) };
    }),
  );

  results.push(
    await step("registry smoke (annotations, tools.json, read-only artifact tools)", async () => registrySmoke()),
  );

  if (LIVE) {
    const creds = hasCredentials();
    const skipDetail = "ZEBRUNNER_URL / ZEBRUNNER_LOGIN / ZEBRUNNER_TOKEN not set";

    results.push(
      await step("live smoke (npm run smoke)", async () => {
        if (!creds) return { ok: false, skip: true, detail: skipDetail };
        const r = await npm("smoke");
        return { ok: r.code === 0, detail: tail(r.output) };
      }),
    );
    results.push(
      await step("live api-verify (tests/api-verify.sh)", async () => {
        if (!creds) return { ok: false, skip: true, detail: skipDetail };
        const r = await run("bash", ["tests/api-verify.sh"]);
        return { ok: r.code === 0, detail: tail(r.output, 40) };
      }),
    );
    results.push(
      await step("live MCP pagination audit", async () => {
        if (!creds) return { ok: false, skip: true, detail: skipDetail };
        const r = await npm("test:mcp-pagination-audit");
        return { ok: r.code === 0, detail: tail(r.output, 40) };
      }),
    );
  }

  console.log("\n──────── Summary ────────");
  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${(r.ms / 1000).toFixed(1)}s`);
  }
  const failed = results.filter((r) => r.status === "FAIL");
  const skipped = results.filter((r) => r.status === "SKIP");
  console.log(
    `\n${failed.length === 0 ? "✅ self-check passed" : `❌ self-check FAILED (${failed.length} step${failed.length > 1 ? "s" : ""})`}` +
      (skipped.length ? ` — ${skipped.length} step(s) skipped (no credentials); not counted as passed` : ""),
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
