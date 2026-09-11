/**
 * adv_find_field_history_changes — scan TCM audit history for field transitions.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { EnhancedZebrunnerClient } from '../api/enhanced-client.js';
import type { ZebrunnerReportingClient } from '../api/reporting-client.js';
import { findFieldHistoryChanges } from '../utils/field-history-search.js';

export interface FindFieldHistoryChangesToolDeps {
  client: EnhancedZebrunnerClient;
  reportingClient: ZebrunnerReportingClient;
  resolveProjectId: (project: string | number) => Promise<{ projectId: number }>;
  getProjectAliases: () => Record<string, string>;
  debugLog: (message: string, data?: unknown) => void;
}

export function registerFindFieldHistoryChangesTool(
  server: McpServer,
  deps: FindFieldHistoryChangesToolDeps,
): void {
  server.registerTool(
    'find_field_history_changes',
    {
      description:
        '🔎 Find test cases whose TCM change history matches a field transition in a date range. ' +
        'Scans project cases internally (no full case payloads to the client) and returns only matching ' +
        '{key, timestamp, oldValue, newValue} events plus concurrentChanges from the same audit entry. ' +
        'Use for questions like "Manual Only changed Yes→No in the last 60 days". ' +
        'Field aliases match adv_get_test_case_distribution_by_field (e.g. "Manual Only", automationState, customField.manualOnly).',
      inputSchema: {
        project_key: z.string().min(1).describe("Project key (e.g. 'MCP', 'android')"),
        field: z.string().min(1).describe(
          'History field path or display name: customField.manualOnly, automationState, "Manual Only", deprecated, steps, etc.',
        ),
        from_value: z.string().optional().describe(
          'Prior value to match (e.g. Yes, No, id:1). Omit to match any old value.',
        ),
        to_value: z.string().optional().describe(
          'New value to match (e.g. No, Semi-Automated). Omit to match any new value.',
        ),
        changed_after: z.string().optional().describe('ISO datetime — start of change window (inclusive)'),
        changed_before: z.string().optional().describe('ISO datetime — end of change window (inclusive)'),
        suite_id: z.number().int().positive().optional().describe('Optional: scope to a single test suite ID'),
        root_suite_id: z.number().int().positive().optional().describe(
          'Optional: scope to a root suite and all descendants (RQL IN filter)',
        ),
        include_case_summary: z.boolean().default(true).describe(
          'Include title and current automationState on each match (default true)',
        ),
        max_results: z.number().int().positive().max(500).default(100).describe(
          'Maximum matching change events to return (default 100)',
        ),
        history_limit: z.number().int().min(1).max(100).default(100).describe(
          'Max audit entries fetched per test case from TCM /changes (default 100)',
        ),
        format: z.enum(['json', 'compact']).default('json').describe('Output format'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        deps.debugLog('adv_find_field_history_changes', args);

        const { projectId } = await deps.resolveProjectId(args.project_key);
        const aliases = deps.getProjectAliases();
        const projectKey = aliases[args.project_key] ?? args.project_key;

        const result = await findFieldHistoryChanges(
          {
            client: deps.client,
            reportingClient: deps.reportingClient,
            getFieldsLayout: (pid) => deps.reportingClient.getFieldsLayout(pid),
            debugLog: (msg, data) => deps.debugLog(msg, data),
          },
          {
            projectKey,
            projectId,
            field: args.field,
            fromValue: args.from_value,
            toValue: args.to_value,
            changedAfter: args.changed_after,
            changedBefore: args.changed_before,
            suiteId: args.suite_id,
            rootSuiteId: args.root_suite_id,
            includeCaseSummary: args.include_case_summary,
            maxResults: args.max_results,
            historyLimit: args.history_limit,
          },
        );

        const text =
          args.format === 'compact'
            ? JSON.stringify(result)
            : JSON.stringify(result, null, 2);

        return { content: [{ type: 'text' as const, text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.debugLog('Error in adv_find_field_history_changes', { error: msg });
        return {
          content: [{ type: 'text' as const, text: `❌ Error in adv_find_field_history_changes: ${msg}` }],
        };
      }
    },
  );
}
