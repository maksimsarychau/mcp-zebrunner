import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  AnthropicEvalClient,
  OpenAiEvalClient,
  anthropicSupportsForcedToolChoice,
  anthropicSupportsTemperature,
  type EvalLlmChatOptions,
} from "../eval/eval-llm-client.js";

const options: EvalLlmChatOptions = {
  model: "test-model",
  system: "Select a tool.",
  userMessage: "List projects",
  tools: [{
    type: "function",
    function: {
      name: "adv_get_available_projects",
      description: "List projects",
      parameters: { type: "object", properties: {} },
    },
  }],
  toolChoice: { name: "adv_get_available_projects" },
  maxTokens: 321,
  temperature: 0,
};

async function requestBody(input: string | URL | Request, init?: RequestInit): Promise<Record<string, unknown>> {
  const body = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
  assert.equal(typeof body, "string");
  return JSON.parse(body as string) as Record<string, unknown>;
}

describe("eval LLM SDK request compatibility", () => {
  it("keeps max_tokens and custom baseURL for OpenAI-compatible providers", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input instanceof Request ? input.url : input);
      capturedBody = await requestBody(input, init);
      return new Response(JSON.stringify({
        id: "chatcmpl-test",
        object: "chat.completion",
        created: 1,
        model: "test-model",
        choices: [{
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call-1",
              type: "function",
              function: { name: "adv_get_available_projects", arguments: "{}" },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const client = new OpenAiEvalClient("ollama", "http://127.0.0.1:11434/v1", fetchImpl);
    const response = await client.chatWithTools(options);

    assert.equal(capturedUrl, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(capturedBody.max_tokens, 321);
    assert.equal(capturedBody.max_completion_tokens, undefined);
    assert.deepEqual(response.toolCalls, [{ name: "adv_get_available_projects", input: {} }]);
    assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 4 });
  });

  it("serializes Anthropic messages and normalizes tool use", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input instanceof Request ? input.url : input);
      capturedBody = await requestBody(input, init);
      return new Response(JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [{
          type: "tool_use",
          id: "toolu-1",
          name: "adv_get_available_projects",
          input: {},
        }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 3 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const client = new AnthropicEvalClient("test-key", fetchImpl);
    const response = await client.chatWithTools({
      ...options,
      tools: [{
        name: "adv_get_available_projects",
        description: "List projects",
        input_schema: { type: "object", properties: {} },
      }],
    });

    assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages");
    assert.equal(capturedBody.max_tokens, 321);
    assert.deepEqual(response.toolCalls, [{ name: "adv_get_available_projects", input: {} }]);
    assert.deepEqual(response.usage, { inputTokens: 10, outputTokens: 3 });
  });

  it("omits temperature for Anthropic Sonnet/Opus 5 models", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedBody = await requestBody(input, init);
      return new Response(JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const client = new AnthropicEvalClient("test-key", fetchImpl);
    await client.chatWithTools({ ...options, model: "claude-sonnet-5", toolChoice: "auto" });

    assert.equal("temperature" in capturedBody, false);
    assert.equal(anthropicSupportsTemperature("claude-sonnet-4-6"), true);
    assert.equal(anthropicSupportsTemperature("claude-sonnet-5"), false);
    assert.equal(anthropicSupportsTemperature("claude-opus-5-20260201"), false);
    assert.equal(anthropicSupportsTemperature("claude-sonnet-5-5"), false);
  });

  describe("claude-sonnet-5-5 (rejects forced tool_choice)", () => {
    const anthropicOk = (model: string) =>
      new Response(JSON.stringify({
        id: "msg-test",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "tool_use", id: "tu_1", name: "score_output", input: { relevance: 5 } }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: { input_tokens: 4, output_tokens: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } });

    it("anthropicSupportsForcedToolChoice is false only for Sonnet 5.5", () => {
      assert.equal(anthropicSupportsForcedToolChoice("claude-sonnet-5-5"), false);
      assert.equal(anthropicSupportsForcedToolChoice("claude-sonnet-5-5-20261101"), false);
      assert.equal(anthropicSupportsForcedToolChoice("claude-sonnet-5"), true);
      assert.equal(anthropicSupportsForcedToolChoice("claude-sonnet-4-6"), true);
      assert.equal(anthropicSupportsForcedToolChoice("claude-opus-5"), true);
    });

    it("sends tool_choice auto + an instruction instead of forcing the judge tool", async () => {
      let body: Record<string, any> = {};
      const fetchImpl: typeof fetch = async (input, init) => {
        body = await requestBody(input, init);
        return anthropicOk("claude-sonnet-5-5");
      };
      const client = new AnthropicEvalClient("test-key", fetchImpl);
      const response = await client.chatWithTools({
        ...options,
        model: "claude-sonnet-5-5",
        toolChoice: { name: "score_output" },
      });

      assert.deepEqual(body.tool_choice, { type: "auto" });
      assert.ok(String(body.messages[0].content).includes('calling the "score_output" tool'));
      assert.equal("temperature" in body, false);
      assert.deepEqual(response.toolCalls, [{ name: "score_output", input: { relevance: 5 } }]);
    });

    it("still forces the tool for models that support it", async () => {
      let body: Record<string, any> = {};
      const fetchImpl: typeof fetch = async (input, init) => {
        body = await requestBody(input, init);
        return anthropicOk("claude-sonnet-4-6");
      };
      const client = new AnthropicEvalClient("test-key", fetchImpl);
      await client.chatWithTools({ ...options, model: "claude-sonnet-4-6", toolChoice: { name: "score_output" } });

      assert.deepEqual(body.tool_choice, { type: "tool", name: "score_output" });
      assert.ok(!String(body.messages[0].content).includes("exactly once"), "prompt untouched when forcing works");
    });

    it("leaves auto tool choice untouched on Sonnet 5.5", async () => {
      let body: Record<string, any> = {};
      const fetchImpl: typeof fetch = async (input, init) => {
        body = await requestBody(input, init);
        return anthropicOk("claude-sonnet-5-5");
      };
      const client = new AnthropicEvalClient("test-key", fetchImpl);
      await client.chatWithTools({ ...options, model: "claude-sonnet-5-5", toolChoice: "auto" });
      assert.deepEqual(body.tool_choice, { type: "auto" });
      assert.equal(body.messages[0].content, options.userMessage);
    });
  });
});
