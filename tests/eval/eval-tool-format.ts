import type { EvalConfig, EvalProvider } from "./eval-config.js";
import { evalWireProvider } from "./eval-config.js";

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export function toAnthropicTools(mcpTools: McpToolSchema[]): unknown[] {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}

export function toOpenAiTools(mcpTools: McpToolSchema[]): unknown[] {
  return mcpTools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description || "",
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
  }));
}

export function toGeminiTools(mcpTools: McpToolSchema[]): unknown[] {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    parameters: tool.inputSchema || { type: "object", properties: {} },
  }));
}

export function formatToolsForProvider(provider: EvalProvider, mcpTools: McpToolSchema[]): unknown[] {
  switch (evalWireProvider(provider)) {
    case "anthropic":
      return toAnthropicTools(mcpTools);
    case "openai":
      return toOpenAiTools(mcpTools);
    case "gemini":
      return toGeminiTools(mcpTools);
  }
}

/** Judge tool used by Layer 3 LLM-as-judge across all providers. */
export function judgeToolForProvider(provider: EvalProvider): unknown {
  const schema = {
    type: "object" as const,
    properties: {
      relevance: { type: "number", description: "1-5: Does the output answer the user's question?" },
      completeness: { type: "number", description: "1-5: Are all expected data points present?" },
      format: { type: "number", description: "1-5: Is the output well-structured and readable?" },
      reasoning: { type: "string", description: "Brief explanation of the scores" },
    },
    required: ["relevance", "completeness", "format", "reasoning"],
  };

  switch (evalWireProvider(provider)) {
    case "anthropic":
      return {
        name: "score_output",
        description: "Score the quality of the MCP tool output",
        input_schema: schema,
      };
    case "openai":
      return {
        type: "function" as const,
        function: {
          name: "score_output",
          description: "Score the quality of the MCP tool output",
          parameters: schema,
        },
      };
    case "gemini":
      return {
        name: "score_output",
        description: "Score the quality of the MCP tool output",
        parameters: schema,
      };
  }
}
