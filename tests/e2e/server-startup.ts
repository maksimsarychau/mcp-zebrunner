import type { ChildProcess } from 'node:child_process';

/** Matches STDIO or HTTP startup lines from `src/server.ts` / `src/http/server.ts`. */
export const SERVER_READY_PATTERN =
  /Zebrunner MCP Server started|MCP HTTP server listening on port/;

export const E2E_SERVER_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  DEBUG: 'false',
  MCP_SKIP_INTEGRITY_CHECK: 'true',
};

export function waitForServerReady(
  serverProcess: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      finish(() => reject(new Error(`Server startup timeout after ${timeoutMs / 1000} seconds`)));
    }, timeoutMs);

    const handleOutput = (data: Buffer) => {
      const output = data.toString();
      if (SERVER_READY_PATTERN.test(output)) {
        finish(() => resolve());
      }
    };

    serverProcess.stdout?.on('data', handleOutput);
    serverProcess.stderr?.on('data', handleOutput);

    serverProcess.on('error', (error) => {
      finish(() => reject(error));
    });

    serverProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        finish(() => reject(new Error(`Server exited with code ${code} before starting`)));
      }
    });
  });
}
