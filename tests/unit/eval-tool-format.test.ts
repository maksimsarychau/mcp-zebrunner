import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatToolsForProvider,
  toAnthropicTools,
  toOpenAiTools,
  toGeminiTools,
  judgeToolForProvider,
} from "../eval/eval-tool-format.js";

const SAMPLE_MCP_TOOLS = [
  {
    name: "adv_list_test_suites",
    description: "List test suites",
    inputSchema: {
      type: "object",
      properties: { project_key: { type: "string" } },
      required: ["project_key"],
    },
  },
];

describe("eval-tool-format", () => {
  it("formats tools for anthropic", () => {
    const tools = toAnthropicTools(SAMPLE_MCP_TOOLS) as Array<Record<string, unknown>>;
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, "adv_list_test_suites");
    assert.ok(tools[0].input_schema);
  });

  it("formats tools for openai", () => {
    const tools = toOpenAiTools(SAMPLE_MCP_TOOLS) as Array<{
      type: string;
      function: { name: string; parameters: unknown };
    }>;
    assert.equal(tools[0].type, "function");
    assert.equal(tools[0].function.name, "adv_list_test_suites");
    assert.ok(tools[0].function.parameters);
  });

  it("formats tools for gemini", () => {
    const tools = toGeminiTools(SAMPLE_MCP_TOOLS) as Array<Record<string, unknown>>;
    assert.equal(tools[0].name, "adv_list_test_suites");
    assert.ok(tools[0].parameters);
  });

  it("formatToolsForProvider dispatches by provider", () => {
    const anthropic = formatToolsForProvider("anthropic", SAMPLE_MCP_TOOLS) as Array<Record<string, unknown>>;
    const openai = formatToolsForProvider("openai", SAMPLE_MCP_TOOLS) as Array<Record<string, unknown>>;
    assert.ok(anthropic[0].input_schema);
    assert.equal(openai[0].type, "function");
  });

  it("judgeToolForProvider returns score_output for each provider", () => {
    const a = judgeToolForProvider("anthropic") as { name: string };
    const o = judgeToolForProvider("openai") as { function: { name: string } };
    const g = judgeToolForProvider("gemini") as { name: string };
    assert.equal(a.name, "score_output");
    assert.equal(o.function.name, "score_output");
    assert.equal(g.name, "score_output");
  });
});
