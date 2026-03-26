import { spawn, ChildProcess } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const SERVER_STARTUP_TIMEOUT = 30_000;
const REQUEST_TIMEOUT_MS = 60_000;

let serverProcess: ChildProcess | null = null;
let nextRequestId = 1;
let _toolSchemas: any[] | null = null;

/**
 * Start the MCP server (dist/server.js) over stdio.
 * Requires a signed build — run `npm run build` and sign before eval.
 */
export async function startMCPServer(): Promise<void> {
  if (serverProcess) return;

  const distPath = join(process.cwd(), "dist", "server.js");
  if (!existsSync(distPath)) {
    throw new Error("dist/server.js not found. Run: npm run build && npm run sign-release");
  }

  console.error("[eval-mcp] Starting MCP server...");

  serverProcess = spawn("node", [distPath], {
    env: { ...process.env, DEBUG: "false" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`MCP server startup timeout after ${SERVER_STARTUP_TIMEOUT / 1000}s`));
    }, SERVER_STARTUP_TIMEOUT);

    let stderrOutput = "";

    const handleStdout = (data: Buffer) => {
      const output = data.toString();
      if (output.includes("Zebrunner Unified MCP Server started successfully")) {
        clearTimeout(timeout);
        console.error("[eval-mcp] Server started");
        resolve();
      }
    };

    const handleStderr = (data: Buffer) => {
      const output = data.toString();
      stderrOutput += output;
      if (output.includes("Zebrunner Unified MCP Server started successfully")) {
        clearTimeout(timeout);
        console.error("[eval-mcp] Server started");
        resolve();
      }
    };

    serverProcess!.stdout?.on("data", handleStdout);
    serverProcess!.stderr?.on("data", handleStderr);

    serverProcess!.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    serverProcess!.on("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        serverProcess = null;
        reject(new Error(
          `MCP server exited with code ${code}. ` +
          `Make sure you ran 'npm run build' and signed the release.\n` +
          `stderr: ${stderrOutput.slice(-500)}`
        ));
      }
    });
  });
}

/**
 * Shutdown the MCP server gracefully.
 */
export function stopMCPServer(): void {
  if (serverProcess) {
    console.error("[eval-mcp] Shutting down server...");
    serverProcess.kill("SIGTERM");
    serverProcess = null;
    _toolSchemas = null;
  }
}

/**
 * Send a JSON-RPC request to the MCP server over stdio.
 */
export async function sendMCPRequest(method: string, params?: any): Promise<any> {
  if (!serverProcess) {
    throw new Error("MCP server not started. Call startMCPServer() first.");
  }

  const id = nextRequestId++;
  const request = {
    jsonrpc: "2.0",
    id,
    method,
    ...(params ? { params } : {}),
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      serverProcess?.stdout?.off("data", onData);
      reject(new Error(`MCP request ${method} (id=${id}) timed out after ${REQUEST_TIMEOUT_MS / 1000}s`));
    }, REQUEST_TIMEOUT_MS);

    let buffer = "";

    const onData = (data: Buffer) => {
      buffer += data.toString();
      try {
        const lines = buffer.split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          const response = JSON.parse(line);
          if (response.id === id) {
            clearTimeout(timeout);
            serverProcess?.stdout?.off("data", onData);
            resolve(response);
            return;
          }
        }
      } catch {
        // partial JSON — keep buffering
      }
    };

    serverProcess!.stdout?.on("data", onData);
    serverProcess!.stdin?.write(JSON.stringify(request) + "\n");
  });
}

/**
 * Get tool schemas from the running MCP server via tools/list.
 * Cached after first call.
 */
export async function getMCPToolSchemas(): Promise<any[]> {
  if (_toolSchemas) return _toolSchemas;

  const response = await sendMCPRequest("tools/list");
  if (!response.result?.tools) {
    throw new Error("tools/list returned no tools: " + JSON.stringify(response));
  }

  _toolSchemas = response.result.tools;
  console.error(`[eval-mcp] Loaded ${_toolSchemas!.length} tool schemas from MCP server`);
  return _toolSchemas!;
}

/**
 * Call an MCP tool by name with arguments.
 */
export async function callMCPTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const response = await sendMCPRequest("tools/call", {
    name: toolName,
    arguments: args,
  });

  if (response.error) {
    return `ERROR: ${JSON.stringify(response.error)}`;
  }

  const textBlocks = response.result?.content?.filter(
    (c: any) => c.type === "text"
  );
  if (!textBlocks?.length) {
    return "NO_CONTENT";
  }

  return textBlocks.map((b: any) => b.text).join("\n");
}

/**
 * Convert MCP tool schemas to Anthropic function calling format.
 */
export function toAnthropicTools(mcpTools: any[]): any[] {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}
