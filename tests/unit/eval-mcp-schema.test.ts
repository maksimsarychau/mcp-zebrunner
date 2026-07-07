import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import {
  mcpToolInputProperties,
  mcpToolsExposeInputProperty,
} from "../eval/eval-mcp-client.js";

describe("eval-mcp-client schema helpers", () => {
  it("mcpToolsExposeInputProperty detects properties on tools/list schemas", () => {
    const tools = [
      {
        name: "adv_get_all_tcm_test_cases_by_project",
        inputSchema: {
          type: "object",
          properties: {
            project_key: { type: "string" },
            include_call_metrics: { type: "boolean" },
          },
        },
      },
    ];
    assert.equal(mcpToolsExposeInputProperty(tools, "include_call_metrics"), true);
    assert.equal(mcpToolsExposeInputProperty(tools, "missing_flag"), false);
  });

  it("mcpToolInputProperties returns empty object when schema has no properties", () => {
    assert.deepEqual(mcpToolInputProperties({}), {});
  });
});
