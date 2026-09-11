/**
 * adv_build_field_history_index — build or refresh the local TCM history index (Option 1).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EnhancedZebrunnerClient } from '../api/enhanced-client.js';
import type { ZebrunnerReportingClient } from '../api/reporting-client.js';
import { buildHistoryIndexBatch } from '../utils/history-index/builder.js';
import { getHistoryIndexRoot } from '../utils/history-index/paths.js';
import { loadHistoryIndex } from '../utils/history-index/store.js';

export interface BuildFieldHistoryIndexToolDeps {
  client: EnhancedZebrunnerClient;
  reportingClient: ZebrunnerReportingClient;
  resolveProjectId: (project: string | number) => Promise<{ projectId: number }>;
  getProjectAliases: () => Record<string, string>;
  debugLog: (message: string, data?: unknown) => void;
}

export function registerBuildFieldHistoryIndexTool(
  server: McpServer,
  deps: BuildFieldHistoryIndexToolDeps,
): void {
  server.registerTool(
    'build_field_history_index',
    {
      description:
        '🗂️ Build or refresh the local TCM field-history index for a project (Option 1). ' +
        'Indexes /changes once; adv_find_field_history_changes queries it in milliseconds. ' +
        'Run repeatedly with continue_build=true until complete=true (chunked to avoid MCP timeouts). ' +
        `Storage: ${getHistoryIndexRoot()}/<projectKey>/index.json`,
      inputSchema: {
        project_key: z.string().min(1).describe("Project key (e.g. 'MCP', 'android')"),
        max_cases_per_batch: z.number().int().positive().max(500).default(150).describe(
          'Cases to index per call (default 150 — tune for MCP timeout budget)',
        ),
        history_limit: z.number().int().min(1).max(100).default(100).describe(
          'Max audit entries fetched per case during indexing',
        ),
        history_concurrency: z.number().int().min(1).max(20).default(10).describe(
          'Parallel /changes fetches per batch',
        ),
        continue_build: z.boolean().default(true).describe(
          'Resume a partial build (default true)',
        ),
        force_refresh: z.boolean().default(false).describe(
          'Drop existing index and rebuild from scratch',
        ),
        format: z.enum(['json', 'compact']).default('json'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        deps.debugLog('adv_build_field_history_index', args);

        const { projectId } = await deps.resolveProjectId(args.project_key);
        const aliases = deps.getProjectAliases();
        const projectKey = aliases[args.project_key] ?? args.project_key;

        const existing = loadHistoryIndex(projectKey);
        const result = await buildHistoryIndexBatch(
          {
            client: deps.client,
            reportingClient: deps.reportingClient,
            debugLog: (msg, data) => deps.debugLog(msg, data),
          },
          {
            projectKey,
            projectId,
            maxCasesPerBatch: args.max_cases_per_batch,
            historyLimit: args.history_limit,
            historyConcurrency: args.history_concurrency,
            continueBuild: args.continue_build,
            forceRefresh: args.force_refresh,
          },
        );

        const payload = {
          ...result,
          indexWasComplete: existing?.meta.complete ?? false,
          nextStep: result.complete
            ? 'Run adv_find_field_history_changes with index_mode=auto (default).'
            : 'Call adv_build_field_history_index again with continue_build=true.',
        };

        const text =
          args.format === 'compact'
            ? JSON.stringify(payload)
            : JSON.stringify(payload, null, 2);

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.debugLog('Error in adv_build_field_history_index', { error: msg });
        return {
          content: [{ type: 'text' as const, text: `❌ Error in adv_build_field_history_index: ${msg}` }],
        };
      }
    },
  );
}
