import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  firstToolCall,
  checkRefusalFromResponse,
  type EvalLlmResponse,
} from "../eval/eval-llm-client.js";

describe("eval-llm-response helpers", () => {
  it("firstToolCall returns first tool", () => {
    const response: EvalLlmResponse = {
      toolCalls: [{ name: "adv_list_test_suites", input: { project_key: "MCP" } }],
      textBlocks: [],
      usage: { inputTokens: 1, outputTokens: 2 },
    };
    const call = firstToolCall(response);
    assert.equal(call?.name, "adv_list_test_suites");
    assert.equal(call?.input.project_key, "MCP");
  });

  it("checkRefusalFromResponse when no tools", () => {
    const response: EvalLlmResponse = {
      toolCalls: [],
      textBlocks: ["I cannot help with that."],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const result = checkRefusalFromResponse(response);
    assert.equal(result.refused, true);
    assert.equal(result.selectedTool, undefined);
  });

  it("checkRefusalFromResponse when tool selected", () => {
    const response: EvalLlmResponse = {
      toolCalls: [{ name: "adv_get_top_bugs", input: {} }],
      textBlocks: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
    const result = checkRefusalFromResponse(response);
    assert.equal(result.refused, false);
    assert.equal(result.selectedTool, "adv_get_top_bugs");
  });
});
