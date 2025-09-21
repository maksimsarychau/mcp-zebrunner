import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, ChildProcess } from 'child_process';
import { testConfig } from '../fixtures/api-responses.js';

/**
 * End-to-End tests for the Zebrunner MCP Server
 * These tests start the actual server and test MCP tool calls
 * 
 * Prerequisites:
 * - Valid .env file with Zebrunner credentials
 * - Built server (npm run build)
 */

describe('Zebrunner MCP Server E2E Tests', () => {
  let serverProcess: ChildProcess;
  let serverReady = false;

  before(async () => {
    // Start the server process
    serverProcess = spawn('node', ['dist/server.js'], {
      env: {
        ...process.env,
        ZEBRUNNER_URL: process.env.ZEBRUNNER_URL || testConfig.ZEBRUNNER_URL,
        ZEBRUNNER_LOGIN: process.env.ZEBRUNNER_LOGIN || testConfig.ZEBRUNNER_LOGIN,
        ZEBRUNNER_TOKEN: process.env.ZEBRUNNER_TOKEN || testConfig.ZEBRUNNER_TOKEN,
        DEBUG: 'false' // Reduce noise in tests
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Wait for server to be ready (with timeout)
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 10000);

      serverProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('MCP Server started') || output.includes('server started')) {
          serverReady = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('Server stderr:', data.toString());
      });

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      serverProcess.on('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Server exited with code ${code}`));
        }
      });
    });
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  describe('Server Initialization', () => {
    it('should start server successfully', () => {
      assert.equal(serverReady, true);
      assert.ok(serverProcess.pid);
    });
  });

  describe('Core Working Tools', () => {
    it('should list test suites for MFPAND project', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'list_test_suites',
          arguments: {
            project_key: 'MFPAND',
            format: 'json'
          }
        }
      };

      // Send request to server
      const response = await sendMCPRequest(serverProcess, request);
      
      assert.equal(response.error, undefined);
      assert.ok(response.result);
      assert.ok(response.result.content);
      assert.equal(response.result.content[0].type, 'text');
      assert.ok(response.result.content[0].text.length > 0);
    });

    it('should get test case by key MFPAND-29', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'get_test_case_by_key',
          arguments: {
            project_key: 'MFPAND',
            case_key: 'MFPAND-29',
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      assert.equal(response.error, undefined);
      assert.ok(response.result);
      assert.ok(response.result.content);
    });

    it('should get test case in markdown format', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'get_test_case_by_key',
          arguments: {
            project_key: 'MFPAND',
            case_key: 'MFPAND-29',
            format: 'markdown'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      assert.equal(response.error, undefined);
      assert.ok(response.result?.content?.[0]?.text?.includes('# Test Case:'));
      assert.ok(response.result?.content?.[0]?.text?.includes('**ID:**'));
      assert.ok(response.result?.content?.[0]?.text?.includes('**Key:**'));
      assert.ok(response.result?.content?.[0]?.text?.includes('## Steps'));
    });
  });

  describe('Enhanced Features', () => {
    it('should get advanced test cases with pagination', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'get_test_cases_advanced',
          arguments: {
            project_key: 'MFPAND',
            page: 0,
            size: 10,
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      assert.equal(response.error, undefined);
      assert.ok(response.result);
      
      const data = JSON.parse(response.result.content[0].text);
      assert.equal(data.items.length <= 10, true);
      assert.ok(data._meta);
    });

    it('should build suite hierarchy', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'get_suite_hierarchy',
          arguments: {
            project_key: 'MFPAND',
            max_depth: 3,
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      assert.equal(response.error, undefined);
      assert.ok(response.result);
    });

    it('should handle string format output', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'list_test_suites',
          arguments: {
            project_key: 'MFPAND',
            format: 'string'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      assert.equal(response.error, undefined);
      assert.ok(response.result?.content?.[0]?.text?.includes('=== Test Suite:'));
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid project key gracefully', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'list_test_suites',
          arguments: {
            project_key: 'INVALID_PROJECT',
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      // Should not crash, but may return error or empty results
      assert.ok(response.result || response.error);
    });

    it('should handle missing required parameters', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'get_test_case_by_key',
          arguments: {
            // Missing required parameters
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      // Should return validation error
      assert.ok(response.error);
    });

    it('should handle non-existent test case', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'get_test_case_by_key',
          arguments: {
            project_key: 'MFPAND',
            case_key: 'NONEXISTENT-999',
            format: 'json'
          }
        }
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      // Should handle gracefully with error message
      assert.ok(response.result?.content?.[0]?.text?.includes('Error') || response.error);
    });
  });

  describe('Tool Discovery', () => {
    it('should list available tools', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/list'
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      assert.ok(response.result);
      assert.ok(response.result.tools);
      
      const toolNames = response.result.tools.map((tool: any) => tool.name);
      assert.ok(toolNames.includes('list_test_suites'));
      assert.ok(toolNames.includes('get_test_case_by_key'));
      assert.ok(toolNames.includes('get_test_cases_advanced'));
      assert.ok(toolNames.includes('get_suite_hierarchy'));
    });

    it('should provide tool descriptions and schemas', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/list'
      };

      const response = await sendMCPRequest(serverProcess, request);
      
      const tools = response.result.tools;
      const listSuitesTool = tools.find((tool: any) => tool.name === 'list_test_suites');
      
      assert.ok(listSuitesTool);
      assert.ok(listSuitesTool.description);
      assert.ok(listSuitesTool.inputSchema);
      assert.ok(listSuitesTool.inputSchema.properties);
      assert.ok(listSuitesTool.inputSchema.properties.project_key);
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent requests', async () => {
      const requests = Array.from({ length: 3 }, (_, i) => ({
        jsonrpc: '2.0',
        id: 100 + i,
        method: 'tools/call',
        params: {
          name: 'list_test_suites',
          arguments: {
            project_key: 'MFPAND',
            format: 'json'
          }
        }
      }));

      const responses = await Promise.all(
        requests.map(req => sendMCPRequest(serverProcess, req))
      );

      responses.forEach(response => {
        assert.equal(response.error, undefined);
        assert.ok(response.result);
      });
    });

    it('should respond within reasonable time', async () => {
      const startTime = Date.now();
      
      const request = {
        jsonrpc: '2.0',
        id: 200,
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
      const duration = Date.now() - startTime;
      
      assert.ok(response.result);
      assert.ok(duration < 5000); // Should respond within 5 seconds
    });
  });
});

/**
 * Helper function to send MCP request to server and get response
 */
async function sendMCPRequest(serverProcess: ChildProcess, request: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'));
    }, 10000);

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
    serverProcess.stdin?.write(JSON.stringify(request) + '\n');
  });
}