import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { TOOL_SCHEMA_REQUIRED_KEYS } from "../helpers/tool-coverage-matrix.js";

function readServerSource() {
  return fs.readFileSync(path.join(process.cwd(), "src", "server.ts"), "utf-8");
}

function schemaBlockForTool(source: string, toolName: string): string | null {
  const escapedName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startPattern = new RegExp(`server\\.tool\\(\\s*"${escapedName}"`, "m");
  const startMatch = source.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return null;

  const startIndex = startMatch.index;
  const asyncIndex = source.indexOf(",\n    async", startIndex);
  if (asyncIndex === -1) return null;

  const schemaStart = source.indexOf("{", startIndex);
  if (schemaStart === -1 || schemaStart > asyncIndex) return null;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = schemaStart; i < asyncIndex; i++) {
    const ch = source[i];
    const prev = source[i - 1];

    if (ch === "'" && !inDouble && !inTemplate && prev !== "\\") inSingle = !inSingle;
    if (ch === "\"" && !inSingle && !inTemplate && prev !== "\\") inDouble = !inDouble;
    if (ch === "`" && !inSingle && !inDouble && prev !== "\\") inTemplate = !inTemplate;

    if (inSingle || inDouble || inTemplate) continue;

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(schemaStart + 1, i);
      }
    }
  }

  return null;
}

const KEY_ALIASES: Record<string, string[]> = {
  project_key: ["project_key", "project", "projectKey"],
  project: ["project", "project_key"],
  suite_id: ["suite_id", "root_suite_id", "test_suite_id"],
  run_id: ["run_id", "test_run_id", "testRunId", "id"],
  launch_id: ["launch_id", "launchId", "test_run_id", "testRunId"],
  case_key: ["case_key", "caseKey", "test_case_key"],
  automation_state: ["automation_state", "automation_states", "automation_state_id"],
  automation_states: ["automation_states", "automation_state", "automation_state_id"],
  screenshot_url: ["screenshot_url", "screenshotUrl", "url"],
  projectKey: ["projectKey", "project_key", "project"],
  testRunId: ["testRunId", "test_run_id", "launch_id"],
  testId: ["testId", "test_id"],
  implementation_code: ["implementation_code", "implementation_context"]
};

function keyCandidates(key: string): string[] {
  return KEY_ALIASES[key] ?? [key];
}

describe("Tool Schema Coverage", () => {
  it("validates required schema keys exist for all 51 tools", () => {
    const source = readServerSource();

    for (const [toolName, requiredKeys] of Object.entries(TOOL_SCHEMA_REQUIRED_KEYS)) {
      const schema = schemaBlockForTool(source, toolName);
      if (requiredKeys.length === 0) {
        assert.ok(schema !== null, `schema block should exist for ${toolName} (can be empty object)`);
        continue;
      }
      assert.ok(typeof schema === "string" && schema.length > 0, `schema block should exist for ${toolName}`);

      for (const key of requiredKeys) {
        const candidates = keyCandidates(key);
        const found = candidates.some(candidate => {
          const keyRegex = new RegExp(`\\b${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
          return keyRegex.test(schema);
        });
        assert.ok(found, `${toolName} schema should include key "${key}" (or alias)`);
      }
    }
  });

  it("enforces period enum and about tool enum constraints", () => {
    const source = readServerSource();

    for (const toolName of [
      "get_platform_results_by_period",
      "get_top_bugs",
      "get_bug_review",
      "get_bug_failure_info"
    ]) {
      const schema = schemaBlockForTool(source, toolName);
      assert.ok(/period\s*:\s*z\.enum\(ALL_PERIODS\)/.test(schema), `${toolName} should use z.enum(ALL_PERIODS)`);
    }

    const aboutSchema = schemaBlockForTool(source, "about_mcp_tools");
    assert.ok(/mode\s*:\s*z\.enum\(\["summary",\s*"tool"\]\)/.test(aboutSchema), "about_mcp_tools should enforce mode enum");
    assert.ok(/tool_name\s*:/.test(aboutSchema), "about_mcp_tools should expose tool_name");
    assert.ok(/include_examples\s*:/.test(aboutSchema), "about_mcp_tools should expose include_examples");
    assert.ok(/include_token_estimates\s*:/.test(aboutSchema), "about_mcp_tools should expose include_token_estimates");
    assert.ok(/include_role_benefits\s*:/.test(aboutSchema), "about_mcp_tools should expose include_role_benefits");
  });
});
