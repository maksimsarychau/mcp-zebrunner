import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, ChildProcess } from 'child_process';

/**
 * Manual End-to-End tests for the Zebrunner MCP Server
 * These tests start the actual server and test MCP tool calls
 *
 * Prerequisites:
 * - Valid .env file with Zebrunner credentials
 * - Built server (npm run build)
 *
 * To run: npx tsx --test tests/e2e/server-manual.test.ts
 */

// Check for real credentials
const hasRealCredentials = process.env.ZEBRUNNER_URL &&
                          process.env.ZEBRUNNER_LOGIN &&
                          process.env.ZEBRUNNER_TOKEN;

if (!hasRealCredentials) {
  console.log('⚠️  Manual E2E tests skipped - no real Zebrunner credentials found');
  console.log('   Set ZEBRUNNER_URL, ZEBRUNNER_LOGIN, and ZEBRUNNER_TOKEN in .env to run these tests');
  process.exit(0);
}

describe('Manual E2E Tests - Zebrunner MCP Server', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;

  before(async () => {
    console.log('🚀 Starting MCP Server for manual E2E tests...');

    // Start the server process with real environment variables
    serverProcess = spawn('node', ['dist/server.js'], {
      env: {
        ...process.env,
        DEBUG: 'false' // Reduce noise in tests
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to be ready (with timeout)
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout after 15 seconds'));
      }, 15000);

      // Listen to both stdout and stderr for startup message
      const handleOutput = (data: Buffer) => {
        const output = data.toString();
        console.log('Server output:', output.trim());

        if (output.includes('Zebrunner Unified MCP Server started successfully')) {
          serverReady = true;
          clearTimeout(timeout);
          console.log('✅ Server started successfully');
          resolve();
        }
      };

      serverProcess.stdout?.on('data', handleOutput);
      serverProcess.stderr?.on('data', handleOutput);

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      serverProcess.on('exit', (code) => {
        if (code !== 0 && !serverReady) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code} before starting`));
        }
      });
    });
  });

  after(() => {
    console.log('🛑 Shutting down server...');
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
    }
  });

  describe('Server Health', () => {
    it('should start server successfully', () => {
      assert.equal(serverReady, true, 'Server should be ready');
      assert.ok(serverProcess.pid, 'Server process should have PID');
    });
  });

  describe('MCP Protocol Tests', () => {
    it('should list available tools', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      };

      const response = await sendMCPRequest(serverProcess, request);

      assert.ok(response.result, 'Should have result');
      assert.ok(response.result.tools, 'Should have tools array');

      const toolNames = response.result.tools.map((tool: any) => tool.name);
      console.log('Available tools:', toolNames);

      // Verify key tools are present
      assert.ok(toolNames.includes('list_test_suites'));
      assert.ok(toolNames.includes('get_test_case_by_key'));
    });

    it('should call list_test_suites tool', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'list_test_suites',
          arguments: {
            project_key: 'MFPAND',
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);

      console.log('List suites response type:', typeof response.result?.content?.[0]?.text);

      assert.equal(response.error, undefined, 'Should not have error');
      assert.ok(response.result, 'Should have result');
      assert.ok(response.result.content, 'Should have content');
      assert.equal(response.result.content[0].type, 'text');
      assert.ok(response.result.content[0].text.length > 0, 'Should have content text');
    });

    it('should handle tool errors gracefully', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_test_case_by_key',
          arguments: {
            project_key: 'INVALID',
            case_key: 'INVALID-999'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);

      // Should either have result with error message or error response
      assert.ok(response.result || response.error, 'Should handle gracefully');
      console.log('Error handling test result:', response.result ? 'handled' : 'errored');
    });
  });

  describe('Performance', () => {
    it('should respond to multiple concurrent requests', async () => {
      const requests = Array.from({ length: 3 }, (_, i) => ({
        jsonrpc: '2.0',
        id: 10 + i,
        method: 'tools/call',
        params: {
          name: 'list_test_suites',
          arguments: {
            project_key: 'MFPAND',
            format: 'json'
          }
        }
      }));

      const startTime = Date.now();
      const responses = await Promise.all(
        requests.map(req => sendMCPRequest(serverProcess, req))
      );
      const duration = Date.now() - startTime;

      console.log(`Processed ${requests.length} concurrent requests in ${duration}ms`);

      responses.forEach((response, i) => {
        assert.ok(response.result || response.error, `Request ${i} should complete`);
      });

      assert.ok(duration < 10000, 'Should handle concurrent requests within 10 seconds');
    });
  });
});

/**
 * Helper function to send MCP request to server and get response
 */
async function sendMCPRequest(serverProcess: ChildProcess, request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request ${request.id} timeout after 15 seconds`));
    }, 15000);

    let responseBuffer = '';

    const onData = (data: Buffer) => {
      responseBuffer += data.toString();

      // Look for complete JSON response
      try {
        const lines = responseBuffer.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            const response = JSON.parse(line);
            if (response.id === request.id) {
              clearTimeout(timeout);
              serverProcess.stdout?.off('data', onData);
              resolve(response);
              return;
            }
          }
        }
      } catch (e) {
        // Continue waiting for complete response
      }
    };

    serverProcess.stdout?.on('data', onData);

    // Send request
    const requestLine = JSON.stringify(request) + '\n';
    console.log(`Sending request ${request.id}: ${request.method}`);
    serverProcess.stdin?.write(requestLine);
  });
}

console.log('✅ Manual E2E tests configured');