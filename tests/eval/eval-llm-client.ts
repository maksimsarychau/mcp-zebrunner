import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { EvalConfig } from "./eval-config.js";
import { judgeToolForProvider } from "./eval-tool-format.js";

export interface EvalLlmToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface EvalLlmResponse {
  toolCalls: EvalLlmToolCall[];
  textBlocks: string[];
  usage: { inputTokens: number; outputTokens: number };
}

export type EvalLlmToolChoice = "auto" | { name: string };

export interface EvalLlmChatOptions {
  model: string;
  system?: string;
  userMessage: string;
  tools: unknown[];
  toolChoice: EvalLlmToolChoice;
  maxTokens: number;
  temperature: number;
}

export interface EvalLlmClient {
  chatWithTools(opts: EvalLlmChatOptions): Promise<EvalLlmResponse>;
}

export function firstToolCall(response: EvalLlmResponse): EvalLlmToolCall | undefined {
  return response.toolCalls[0];
}

export function checkRefusalFromResponse(
  response: EvalLlmResponse,
): { refused: boolean; selectedTool?: string } {
  const call = firstToolCall(response);
  if (!call) return { refused: true };
  return { refused: false, selectedTool: call.name };
}

class AnthropicEvalClient implements EvalLlmClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chatWithTools(opts: EvalLlmChatOptions): Promise<EvalLlmResponse> {
    const toolChoice =
      opts.toolChoice === "auto"
        ? { type: "auto" as const }
        : { type: "tool" as const, name: opts.toolChoice.name };

    const response = await this.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      system: opts.system,
      tools: opts.tools as Anthropic.Tool[],
      tool_choice: toolChoice,
      messages: [{ role: "user", content: opts.userMessage }],
    });

    return normalizeAnthropicResponse(response);
  }
}

class OpenAiEvalClient implements EvalLlmClient {
  private client: OpenAI;

  constructor(apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey: apiKey || "ollama",
      baseURL: baseUrl,
    });
  }

  async chatWithTools(opts: EvalLlmChatOptions): Promise<EvalLlmResponse> {
    const toolChoice =
      opts.toolChoice === "auto"
        ? "auto"
        : { type: "function" as const, function: { name: opts.toolChoice.name } };

    const response = await this.client.chat.completions.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.userMessage },
      ],
      tools: opts.tools as OpenAI.ChatCompletionTool[],
      tool_choice: toolChoice,
    });

    return normalizeOpenAiResponse(response);
  }
}

class GeminiEvalClient implements EvalLlmClient {
  private genai: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genai = new GoogleGenerativeAI(apiKey);
  }

  async chatWithTools(opts: EvalLlmChatOptions): Promise<EvalLlmResponse> {
    const declarations = (opts.tools as Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>).map(
      (tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: convertJsonSchemaToGemini(tool.parameters ?? { type: "object", properties: {} }),
      }),
    );

    const model = this.genai.getGenerativeModel({
      model: opts.model,
      systemInstruction: opts.system,
      tools: [{ functionDeclarations: declarations }],
    });

    const forcedTool =
      opts.toolChoice === "auto" ? undefined : opts.toolChoice.name;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: opts.userMessage }] }],
      generationConfig: {
        temperature: opts.temperature,
        maxOutputTokens: opts.maxTokens,
      },
      ...(forcedTool
        ? {
            toolConfig: {
              functionCallingConfig: {
                mode: "ANY" as const,
                allowedFunctionNames: [forcedTool],
              },
            },
          }
        : {}),
    });

    return normalizeGeminiResponse(result.response);
  }
}

function normalizeAnthropicResponse(response: Anthropic.Message): EvalLlmResponse {
  const toolCalls: EvalLlmToolCall[] = [];
  const textBlocks: string[] = [];

  for (const block of response.content) {
    if (block.type === "tool_use") {
      toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> });
    } else if (block.type === "text") {
      textBlocks.push(block.text);
    }
  }

  return {
    toolCalls,
    textBlocks,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

function normalizeOpenAiResponse(response: OpenAI.ChatCompletion): EvalLlmResponse {
  const message = response.choices[0]?.message;
  const toolCalls: EvalLlmToolCall[] = [];
  const textBlocks: string[] = [];

  if (message?.content) textBlocks.push(message.content);

  for (const tc of message?.tool_calls ?? []) {
    if (tc.type === "function") {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        input = {};
      }
      toolCalls.push({ name: tc.function.name, input });
    }
  }

  return {
    toolCalls,
    textBlocks,
    usage: {
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

function normalizeGeminiResponse(response: {
  text?: () => string;
  functionCalls?: () => Array<{ name: string; args: Record<string, unknown> }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}): EvalLlmResponse {
  const toolCalls: EvalLlmToolCall[] = [];
  const textBlocks: string[] = [];

  try {
    const text = response.text?.();
    if (text) textBlocks.push(text);
  } catch {
    // no text when function call only
  }

  for (const call of response.functionCalls?.() ?? []) {
    toolCalls.push({ name: call.name, input: call.args ?? {} });
  }

  return {
    toolCalls,
    textBlocks,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

function convertJsonSchemaToGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const type = String(schema.type ?? "object").toLowerCase();
  const geminiType =
    type === "string" ? SchemaType.STRING
    : type === "number" || type === "integer" ? SchemaType.NUMBER
    : type === "boolean" ? SchemaType.BOOLEAN
    : type === "array" ? SchemaType.ARRAY
    : SchemaType.OBJECT;

  const out: Record<string, unknown> = { type: geminiType };

  if (schema.description) out.description = schema.description;

  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && geminiType === SchemaType.OBJECT) {
    const converted: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(props)) {
      converted[key] = convertJsonSchemaToGemini(val);
    }
    out.properties = converted;
  }

  if (Array.isArray(schema.required)) {
    out.required = schema.required;
  }

  return out;
}

let _client: EvalLlmClient | null = null;

export function createEvalLlmClient(config: EvalConfig): EvalLlmClient {
  if (_client) return _client;

  switch (config.provider) {
    case "anthropic":
      _client = new AnthropicEvalClient(config.apiKey!);
      break;
    case "openai":
    case "local":
      _client = new OpenAiEvalClient(config.apiKey ?? "ollama", config.baseUrl);
      break;
    case "gemini":
      _client = new GeminiEvalClient(config.apiKey!);
      break;
  }

  return _client!;
}

export function getJudgeTools(config: EvalConfig): unknown[] {
  return [judgeToolForProvider(config.provider)];
}

export function resetEvalLlmClientForTests(): void {
  _client = null;
}
