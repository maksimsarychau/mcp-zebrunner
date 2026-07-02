#!/usr/bin/env node
// Quick smoke test: spin up the built MCP server over stdio, run
// initialize + tools/list, and assert that every tool is registered under
// `adv_<name>`, the description prefix is present, and the deprecated alias
// behavior matches the ZEBRUNNER_REGISTER_LEGACY_ALIASES env var.
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function loadDotenv(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const raw of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/i);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}
const dotenvVars = loadDotenv(path.resolve(".env"));

function runOnce({ legacy }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("dist/server.js")], {
      env: {
        ...process.env,
        ...dotenvVars,
        DEBUG: "false",
        ZEBRUNNER_REGISTER_LEGACY_ALIASES: legacy ? "true" : "false",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let buf = "";
    const pending = new Map();
    let nextId = 1;
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      reject(new Error("Timed out waiting for tools/list"));
    }, 20_000);

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
          }
        } catch {}
      }
    });

    child.stderr.on("data", (chunk) => {
      // stderr is informative; ignore for verification purposes
    });

    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited unexpectedly with code ${code}`));
      }
    });

    function send(method, params) {
      const id = nextId++;
      return new Promise((res) => {
        pending.set(id, res);
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    }
    function notify(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    }

    (async () => {
      try {
        await send("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "verify-rename", version: "0.1" },
        });
        notify("notifications/initialized", {});

        const toolsResp = await send("tools/list", {});
        const resourcesResp = await send("resources/list", {});
        const promptsResp = await send("prompts/list", {});

        const tools = toolsResp.result?.tools ?? [];
        const resources = resourcesResp.result?.resources ?? [];
        const prompts = promptsResp.result?.prompts ?? [];

        const adv = tools.filter((t) => t.name.startsWith("adv_"));
        const legacyTools = tools.filter((t) => !t.name.startsWith("adv_"));
        const advBaseNames = new Set(adv.map((t) => t.name.slice(4)));
        const legacyNames = new Set(legacyTools.map((t) => t.name));

        const missingAdvPrefix = adv.filter(
          (t) => !t.description?.startsWith("[Advanced Zebrunner MCP] "),
        );
        const malformedLegacy = legacyTools.filter(
          (t) => !t.description?.startsWith("[deprecated alias — use adv_"),
        );
        const doublePrefix = tools.filter(
          (t) => (t.description?.match(/\[Advanced Zebrunner MCP\]/g) ?? []).length > 1,
        );
        const stalePrefixOnLegacy = legacyTools.filter((t) =>
          t.description?.includes("[Advanced Zebrunner MCP]"),
        );

        const advWithoutLegacy = [...advBaseNames].filter((n) => !legacyNames.has(n));
        const legacyWithoutAdv = [...legacyNames].filter((n) => !advBaseNames.has(n));

        const routingResource = resources.find((r) => r.uri === "zebrunner://mcp-routing");
        settled = true;
        clearTimeout(timeout);
        try { child.kill(); } catch {}
        resolve({
          legacyMode: legacy,
          counts: {
            tools: tools.length,
            adv: adv.length,
            legacy: legacyTools.length,
            resources: resources.length,
            prompts: prompts.length,
          },
          missingAdvPrefix: missingAdvPrefix.map((t) => t.name),
          malformedLegacy: malformedLegacy.map((t) => t.name),
          doublePrefix: doublePrefix.map((t) => t.name),
          stalePrefixOnLegacy: stalePrefixOnLegacy.map((t) => t.name),
          advWithoutLegacy,
          legacyWithoutAdv,
          hasRoutingResource: !!routingResource,
          sampleAdv: adv.slice(0, 3).map((t) => ({ name: t.name, desc: t.description?.slice(0, 70) })),
          sampleLegacy: legacyTools.slice(0, 3).map((t) => ({ name: t.name, desc: t.description?.slice(0, 70) })),
        });
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          try { child.kill(); } catch {}
          reject(err);
        }
      }
    })();
  });
}

(async () => {
  const defaultRun = await runOnce({ legacy: false });
  const legacyRun = await runOnce({ legacy: true });
  console.log("=== Default (ZEBRUNNER_REGISTER_LEGACY_ALIASES unset/false) ===");
  console.log(JSON.stringify(defaultRun, null, 2));
  console.log("\n=== Escape hatch (ZEBRUNNER_REGISTER_LEGACY_ALIASES=true) ===");
  console.log(JSON.stringify(legacyRun, null, 2));

  const failures = [];
  if (defaultRun.counts.legacy !== 0) failures.push("default mode: expected 0 legacy tools, got " + defaultRun.counts.legacy);
  if (defaultRun.counts.adv === 0) failures.push("default mode: expected >0 adv_ tools, got 0");
  if (defaultRun.missingAdvPrefix.length) failures.push("default mode: adv_ tools missing description prefix: " + defaultRun.missingAdvPrefix.join(","));
  if (!defaultRun.hasRoutingResource) failures.push("default mode: zebrunner://mcp-routing resource missing");

  if (legacyRun.counts.adv !== defaultRun.counts.adv) failures.push("escape hatch: adv_ tool count differs (" + legacyRun.counts.adv + " vs " + defaultRun.counts.adv + ")");
  if (legacyRun.counts.legacy !== legacyRun.counts.adv) failures.push("escape hatch: expected legacy count == adv count, got legacy=" + legacyRun.counts.legacy + " adv=" + legacyRun.counts.adv);
  if (legacyRun.advWithoutLegacy.length) failures.push("escape hatch: adv_<name> without legacy alias: " + legacyRun.advWithoutLegacy.join(","));
  if (legacyRun.legacyWithoutAdv.length) failures.push("escape hatch: legacy without adv_: " + legacyRun.legacyWithoutAdv.join(","));
  if (legacyRun.malformedLegacy.length) failures.push("escape hatch: malformed legacy descriptions: " + legacyRun.malformedLegacy.join(","));
  if (legacyRun.stalePrefixOnLegacy.length) failures.push("escape hatch: legacy tools mistakenly carry [Advanced] prefix: " + legacyRun.stalePrefixOnLegacy.join(","));
  if (legacyRun.doublePrefix.length) failures.push("any mode: tools with double [Advanced] prefix: " + legacyRun.doublePrefix.join(","));

  if (failures.length) {
    console.error("\n❌ VERIFICATION FAILED:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  } else {
    console.log("\n✅ Wrapper integrity verified for both modes.");
  }
})().catch((err) => {
  console.error("verification crashed:", err);
  process.exit(1);
});
