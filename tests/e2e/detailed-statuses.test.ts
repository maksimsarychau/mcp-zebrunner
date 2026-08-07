import 'dotenv/config';
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'child_process';
import { E2E_SERVER_ENV, waitForServerReady } from './server-startup.js';

/**
 * Boundary tests for the opt-in `includeDetailedStatuses` flag (v9.2.6).
 *
 * Verifies through a real MCP stdio server that:
 * - every launch reporting tool publishes the flag as an optional boolean
 * - responses omit detailed statuses unless the caller opts in
 * - the opt-in block follows the normalized contract and leaves totals untouched
 *
 * Live counts are never asserted — only shape, invariants, and parity with the
 * default response. Launch selection is configurable:
 *   ZEBRUNNER_DETAILED_STATUS_LAUNCH_ID   explicit launch (skips discovery)
 *   ZEBRUNNER_DETAILED_STATUS_PROJECT_KEY project for discovery / the launch above
 */

const REQUEST_TIMEOUT_MS = 90_000;

const PROJECT_KEY =
  process.env.ZEBRUNNER_DETAILED_STATUS_PROJECT_KEY ||
  process.env.ZEBRUNNER_PROJECT_KEY ||
  'MCP';

/** Tools wired to the opt-in flag in v9.2.6. */
const DETAILED_STATUS_TOOLS = [
  'adv_get_launch_details',
  'adv_get_launch_test_summary',
  'adv_get_launch_summary',
  'adv_get_all_launches_for_project',
  'adv_get_all_launches_with_filter',
  'adv_get_platform_results_by_period',
  'adv_analyze_regression_runtime',
  'adv_regression_results_analyzer',
  'adv_generate_weekly_regression_stability_report',
  'adv_rerun_launch_failures',
  'adv_generate_report',
];

const hasCredentials = Boolean(
  process.env.ZEBRUNNER_URL &&
  process.env.ZEBRUNNER_LOGIN &&
  process.env.ZEBRUNNER_TOKEN &&
  !process.env.ZEBRUNNER_URL.includes('example.com') &&
  !process.env.ZEBRUNNER_TOKEN.includes('test-token')
);

const skipReason = !hasCredentials
  ? 'no real Zebrunner credentials in .env'
  : !existsSync('dist/server.js')
    ? 'dist/server.js not found — run npm run build'
    : undefined;

describe('Detailed statuses over the MCP boundary', { skip: skipReason }, () => {
  let serverProcess: ChildProcess;
  let requestId = 0;
  let tools: any[] = [];
  let launchId: number | undefined;

  before(async () => {
    serverProcess = spawn('node', ['dist/server.js'], {
      env: E2E_SERVER_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await waitForServerReady(serverProcess, 30_000);

    const listed = await sendRequest('tools/list');
    tools = listed.result?.tools ?? [];

    launchId = await resolveLaunchId();
    if (launchId == null) {
      console.log(`⚠️  No launch found for ${PROJECT_KEY} — response-shape tests will be skipped`);
    }
  });

  after(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
    }
  });

  describe('Published tool schema', () => {
    it('exposes includeDetailedStatuses as an optional boolean on every wired tool', () => {
      for (const name of DETAILED_STATUS_TOOLS) {
        const tool = tools.find((t) => t.name === name);
        assert.ok(tool, `${name} should be published by tools/list`);

        const properties = tool.inputSchema?.properties ?? {};
        const flag = properties.includeDetailedStatuses;
        assert.ok(flag, `${name} should publish includeDetailedStatuses`);
        assert.equal(flag.type, 'boolean', `${name}.includeDetailedStatuses should be boolean`);

        const required: string[] = tool.inputSchema?.required ?? [];
        assert.equal(
          required.includes('includeDetailedStatuses'),
          false,
          `${name}.includeDetailedStatuses must stay optional`,
        );
      }
    });

    it('rejects a non-boolean value for the flag', async () => {
      const response = await callTool('adv_get_launch_summary', {
        projectKey: PROJECT_KEY,
        launchId: launchId ?? 1,
        includeDetailedStatuses: 'yes-please',
      });

      const failed = Boolean(response.error) || response.result?.isError === true;
      const text = textOf(response);
      assert.ok(
        failed || /invalid|expected boolean|error/i.test(text),
        `Expected a validation failure, got: ${text.slice(0, 200)}`,
      );
    });
  });

  describe('adv_get_launch_test_summary response contract', () => {
    it('omits detailed statuses by default and keeps counts identical when opted in', async function () {
      if (launchId == null) return this.skip?.();

      const baseArgs = { projectKey: PROJECT_KEY, launchId, count_only: true };

      const legacy = jsonOf(await callTool('adv_get_launch_test_summary', baseArgs));
      assert.equal('detailedStatuses' in legacy, false, 'default response must stay unchanged');
      assert.equal(typeof legacy.total_count, 'number');

      const optedIn = jsonOf(await callTool('adv_get_launch_test_summary', {
        ...baseArgs,
        includeDetailedStatuses: true,
      }));

      assert.equal(optedIn.total_count, legacy.total_count, 'totals must not shift');
      assert.deepEqual(optedIn.by_status, legacy.by_status, 'per-status counts must not shift');

      assertManualKnownIssueBlock(optedIn.detailedStatuses, optedIn.total_count);
      assert.equal(optedIn.detailedStatuses.manualAndKnownIssue.scope, 'allLaunchTests');
    });

    it('scopes the union block to the filtered set when a status filter is applied', async function () {
      if (launchId == null) return this.skip?.();

      const filtered = jsonOf(await callTool('adv_get_launch_test_summary', {
        projectKey: PROJECT_KEY,
        launchId,
        count_only: true,
        statusFilter: ['FAILED'],
        includeDetailedStatuses: true,
      }));

      assertManualKnownIssueBlock(filtered.detailedStatuses, filtered.filtered_count);
      assert.equal(filtered.detailedStatuses.manualAndKnownIssue.scope, 'filteredTests');
      assert.equal(
        filtered.detailedStatuses.manualAndKnownIssue.totalConsidered,
        filtered.filtered_count,
      );
    });
  });

  describe('adv_get_launch_summary response contract', () => {
    it('adds launch-source buckets under testResults without touching the totals', async function () {
      if (launchId == null) return this.skip?.();

      const legacy = jsonOf(await callTool('adv_get_launch_summary', {
        projectKey: PROJECT_KEY,
        launchId,
      }));
      assert.equal('detailedStatuses' in legacy.testResults, false);

      const optedIn = jsonOf(await callTool('adv_get_launch_summary', {
        projectKey: PROJECT_KEY,
        launchId,
        includeDetailedStatuses: true,
      }));

      const { detailedStatuses, ...totals } = optedIn.testResults;
      assert.deepEqual(totals, legacy.testResults, 'existing testResults fields must not change');
      assert.equal(detailedStatuses.source, 'launch');

      for (const [field, value] of Object.entries(detailedStatuses)) {
        if (field === 'source' || field === 'unavailable') continue;
        assert.equal(typeof value, 'number', `detailedStatuses.${field} should be numeric`);
      }
      for (const field of detailedStatuses.unavailable ?? []) {
        assert.equal(field in detailedStatuses, false, `${field} is unavailable but also reported`);
      }
    });
  });

  // ── helpers ──

  function assertManualKnownIssueBlock(detailed: any, expectedTotal: number) {
    assert.ok(detailed, 'opt-in response must carry detailedStatuses');
    assert.equal(detailed.source, 'testRuns');

    const union = detailed.manualAndKnownIssue;
    assert.ok(union, 'detailedStatuses.manualAndKnownIssue must be present');
    for (const field of ['passedManually', 'knownIssue', 'bothConditions', 'eitherCondition', 'totalConsidered']) {
      assert.equal(typeof union[field], 'number', `${field} should be numeric`);
      assert.ok(union[field] >= 0, `${field} should not be negative`);
    }

    assert.equal(
      union.eitherCondition,
      union.passedManually + union.knownIssue - union.bothConditions,
      'eitherCondition must be the deduplicated union',
    );
    assert.ok(union.bothConditions <= Math.min(union.passedManually, union.knownIssue));
    assert.ok(union.eitherCondition <= union.totalConsidered);
    if (typeof expectedTotal === 'number') {
      assert.equal(union.totalConsidered, expectedTotal, 'union must consider every counted test');
    }
  }

  async function resolveLaunchId(): Promise<number | undefined> {
    const configured = process.env.ZEBRUNNER_DETAILED_STATUS_LAUNCH_ID;
    if (configured) return Number(configured);

    const response = await callTool('adv_get_all_launches_for_project', {
      project: PROJECT_KEY,
      pageSize: 1,
      format: 'raw',
    });
    const text = textOf(response);
    try {
      const parsed = JSON.parse(text);
      const items = parsed.items ?? parsed.data?.items ?? parsed.launches ?? [];
      if (Array.isArray(items) && items.length > 0 && typeof items[0].id === 'number') {
        return items[0].id;
      }
    } catch {
      // fall through to a textual match for formatted output
    }
    const match = text.match(/"id"\s*:\s*(\d+)/);
    return match ? Number(match[1]) : undefined;
  }

  function textOf(response: any): string {
    if (response.error) return JSON.stringify(response.error);
    const blocks = response.result?.content?.filter((c: any) => c.type === 'text') ?? [];
    return blocks.map((b: any) => b.text).join('\n');
  }

  function jsonOf(response: any): any {
    const text = textOf(response);
    try {
      return JSON.parse(text);
    } catch (error: any) {
      throw new Error(`Expected JSON tool output, got: ${text.slice(0, 300)}`);
    }
  }

  function callTool(name: string, args: Record<string, unknown>) {
    return sendRequest('tools/call', { name, arguments: args });
  }

  function sendRequest(method: string, params?: Record<string, unknown>): Promise<any> {
    const id = ++requestId;
    const request = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };

    return new Promise((resolve, reject) => {
      let buffer = '';

      const timeout = setTimeout(() => {
        serverProcess.stdout?.off('data', onData);
        reject(new Error(`MCP request ${method} (id=${id}) timed out`));
      }, REQUEST_TIMEOUT_MS);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let parsed: any;
          try {
            parsed = JSON.parse(line);
          } catch {
            continue;
          }
          if (parsed.id === id) {
            clearTimeout(timeout);
            serverProcess.stdout?.off('data', onData);
            resolve(parsed);
            return;
          }
        }
      };

      serverProcess.stdout?.on('data', onData);
      serverProcess.stdin?.write(JSON.stringify(request) + '\n');
    });
  }
});
