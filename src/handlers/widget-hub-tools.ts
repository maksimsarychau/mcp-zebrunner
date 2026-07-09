/**
 * v9.2.4 widget hub MCP tools — TCM case analytics, failure analytics, execution analytics.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZebrunnerReportingClient } from '../api/reporting-client.js';
import {
  ALL_PERIODS,
  buildParamsConfig,
  extractResolvedPeriodLabel,
  type WidgetSqlCaller,
} from '../utils/widget-sql.js';
import {
  formatWidgetPeriodLabel,
  pickWidgetPeriodInput,
  widgetPeriodZodFields,
} from '../utils/widget-period.js';
import {
  TCM_WIDGET_SYSTEM_NAMES,
} from '../utils/tcm-widget-client.js';
import {
  distributionWithPercents,
  parseLabeledValueItems,
  parseNetChangeItems,
} from '../utils/widget-response-parsers.js';

export const FAILURE_ANALYTICS_MODES = [
  'tag_distribution',
  'tags_by_maintainer',
  'jira_by_maintainer',
] as const;

export const EXECUTION_ANALYTICS_MODES = [
  'roi',
  'duration_trend',
  'launch_duration',
  'stability_table',
] as const;

export const TCM_CASE_ANALYTICS_MODES = [
  'net_change',
  'created_by_user',
  'updated_by_user',
] as const;

const FAILURE_TEMPLATE_BY_MODE: Record<(typeof FAILURE_ANALYTICS_MODES)[number], number> = {
  tag_distribution: 40112,
  tags_by_maintainer: 55991,
  jira_by_maintainer: 57086,
};

const EXECUTION_TEMPLATE_BY_MODE: Record<(typeof EXECUTION_ANALYTICS_MODES)[number], number> = {
  roi: 1,
  duration_trend: 131,
  launch_duration: 57085,
  stability_table: 16,
};

const projectArg = z
  .union([z.enum(['web', 'android', 'ios', 'api']), z.string(), z.number()])
  .describe("Project alias, key, or numeric projectId");

export interface WidgetHubToolsDeps {
  resolveProjectId: (project: string | number) => Promise<{ projectId: number }>;
  reportingClient: ZebrunnerReportingClient;
  callWidgetSql: WidgetSqlCaller;
  debugLog: (message: string, data?: unknown) => void;
}

export function registerWidgetHubTools(server: McpServer, deps: WidgetHubToolsDeps): void {
  const { resolveProjectId, reportingClient, callWidgetSql, debugLog } = deps;

  server.registerTool(
    'get_tcm_case_analytics',
    {
      description:
        '📈 TCM dashboard widgets: net case change (37777), cases created by user (37779), cases updated by user (37778). ' +
        'For field/suite pie distribution use adv_get_test_case_distribution_by_field instead.',
      inputSchema: {
        project: projectArg.default('web'),
        mode: z
          .enum(TCM_CASE_ANALYTICS_MODES)
          .describe('Widget mode: net_change | created_by_user | updated_by_user'),
        period: z
          .enum(ALL_PERIODS)
          .default('Last 30 Days')
          .describe('TCM widget period preset'),
        grouping_period: z
          .enum(['Day', 'Week', 'Month'])
          .optional()
          .describe('Net change grouping (mode=net_change only)'),
        format: z.enum(['formatted', 'json', 'compact']).default('formatted'),
        chart: z.enum(['none', 'png', 'html', 'text']).default('none'),
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
        debugLog('adv_get_tcm_case_analytics called', args);
        const { projectId } = await resolveProjectId(args.project);

        let systemName: string;
        let filters: Record<string, unknown>;

        switch (args.mode) {
          case 'net_change':
            systemName = TCM_WIDGET_SYSTEM_NAMES.NET_CHANGE;
            filters = {
              period: args.period,
              groupingPeriod: args.grouping_period ?? 'Week',
            };
            break;
          case 'created_by_user':
            systemName = TCM_WIDGET_SYSTEM_NAMES.CREATED_BY_USER;
            filters = { period: args.period };
            break;
          case 'updated_by_user':
            systemName = TCM_WIDGET_SYSTEM_NAMES.UPDATED_BY_USER;
            filters = { period: args.period };
            break;
        }

        const raw = await reportingClient.getTcmWidgetContent<unknown>(
          systemName,
          projectId,
          filters,
        );

        if (args.format === 'compact' || args.format === 'json') {
          return { content: [{ type: 'text' as const, text: JSON.stringify(raw, null, 2) }] };
        }

        if (args.mode === 'net_change') {
          const items = parseNetChangeItems(raw);
          const lines = [
            `# TCM net change — ${args.project}`,
            '',
            `**Period:** ${args.period}`,
            `**Grouping:** ${args.grouping_period ?? 'Week'}`,
            '',
            '| Period | From | To | Δ |',
            '|--------|-----:|---:|--:|',
            ...items.map(
              i =>
                `| ${i.period} | ${i.valueFrom} | ${i.valueTo} | ${i.valueTo - i.valueFrom} |`,
            ),
          ];
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        const items = parseLabeledValueItems(raw);
        const withPct = distributionWithPercents(items);
        const title =
          args.mode === 'created_by_user' ? 'Created by user' : 'Updated by user';
        const lines = [
          `# TCM ${title} — ${args.project}`,
          '',
          `**Period:** ${args.period}`,
          '',
          '| User | Count | % |',
          '|------|------:|--:|',
          ...withPct.map(i => `| ${i.label} | ${i.value} | ${i.percent}% |`),
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog('Error in adv_get_tcm_case_analytics', { error: message, args });
        return {
          content: [{ type: 'text' as const, text: `❌ Error getting TCM case analytics: ${message}` }],
        };
      }
    },
  );

  server.registerTool(
    'get_failure_analytics',
    {
      description:
        '🏷️ Failure analytics widgets: tag distribution (40112), tags × maintainer (55991), Jira × maintainer (57086). ' +
        'For ranked defect list use adv_get_top_bugs; for failure reasons use adv_get_bug_review.',
      inputSchema: {
        project: projectArg.default('web'),
        mode: z.enum(FAILURE_ANALYTICS_MODES),
        period: z.enum(ALL_PERIODS).default('Last 14 Days'),
        ...widgetPeriodZodFields('Last 14 Days'),
        format: z.enum(['formatted', 'json', 'compact']).default('formatted'),
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
        debugLog('adv_get_failure_analytics called', args);
        const { projectId } = await resolveProjectId(args.project);
        const periodInput = pickWidgetPeriodInput(args);
        const templateId = FAILURE_TEMPLATE_BY_MODE[args.mode];

        const paramsConfig = buildParamsConfig({
          period: args.period,
          periodInput,
          extra: { dashboardName: 'api-verify', isReact: true },
        });

        const data = await callWidgetSql(projectId, templateId, paramsConfig);
        const rows = Array.isArray(data) ? data : [];
        const resolvedPeriod = formatWidgetPeriodLabel(
          periodInput,
          extractResolvedPeriodLabel(rows),
          args.period,
        );

        if (args.format === 'compact' || args.format === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ mode: args.mode, period: resolvedPeriod, rows }, null, 2),
            }],
          };
        }

        const lines = [
          `# Failure analytics (${args.mode}) — ${args.project}`,
          '',
          `**Period:** ${resolvedPeriod}`,
          `**Rows:** ${rows.length}`,
          '',
          '```json',
          JSON.stringify(rows.slice(0, 50), null, 2),
          '```',
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog('Error in adv_get_failure_analytics', { error: message, args });
        return {
          content: [{ type: 'text' as const, text: `❌ Error getting failure analytics: ${message}` }],
        };
      }
    },
  );

  server.registerTool(
    'get_execution_analytics',
    {
      description:
        '⏱️ Execution analytics widgets: ROI (1), duration trend (131), launch duration by suite/run (57085), stability table (16). ' +
        'Not the same as adv_analyze_regression_runtime (launch API) or adv_find_flaky_tests (flip-flop detection).',
      inputSchema: {
        project: projectArg.default('web'),
        mode: z.enum(EXECUTION_ANALYTICS_MODES),
        period: z.enum(ALL_PERIODS).default('Last 7 Days'),
        ...widgetPeriodZodFields('Last 7 Days'),
        run_filter: z
          .array(z.string())
          .optional()
          .describe('Reporting RUN filter (suite/run names) for duration_trend or launch_duration'),
        suite_filter: z
          .array(z.string())
          .optional()
          .describe('SUITE filter for launch_duration mode'),
        stability_threshold: z
          .number()
          .int()
          .min(0)
          .max(100)
          .default(99)
          .describe('Minimum stability % for stability_table mode (template 16)'),
        format: z.enum(['formatted', 'json', 'compact']).default('formatted'),
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
        debugLog('adv_get_execution_analytics called', args);
        const { projectId } = await resolveProjectId(args.project);
        const periodInput = pickWidgetPeriodInput(args);
        const templateId = EXECUTION_TEMPLATE_BY_MODE[args.mode];

        const extra: Record<string, unknown> = { dashboardName: 'api-verify', isReact: true };

        if (args.mode === 'stability_table') {
          extra.STABILITY = String(args.stability_threshold);
        }
        if (args.mode === 'launch_duration') {
          if (args.suite_filter?.length) {
            extra.SUITE = args.suite_filter;
          } else if (args.run_filter?.length) {
            extra.RUN = args.run_filter;
          }
        }
        if (args.mode === 'duration_trend' && args.run_filter?.length) {
          extra.RUN = args.run_filter;
        }
        if (args.mode === 'duration_trend' || args.mode === 'roi') {
          // template 131 / 1 use standard react dashboard filters
        }

        const paramsConfig = buildParamsConfig({
          period: args.period,
          periodInput,
          extra,
        });

        const data = await callWidgetSql(projectId, templateId, paramsConfig);
        const rows = Array.isArray(data) ? data : [];
        const resolvedPeriod = formatWidgetPeriodLabel(
          periodInput,
          extractResolvedPeriodLabel(rows),
          args.period,
        );

        if (args.format === 'compact' || args.format === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ mode: args.mode, period: resolvedPeriod, rows }, null, 2),
            }],
          };
        }

        const lines = [
          `# Execution analytics (${args.mode}) — ${args.project}`,
          '',
          `**Period:** ${resolvedPeriod}`,
          `**Template:** ${templateId}`,
          `**Rows:** ${rows.length}`,
          '',
          '```json',
          JSON.stringify(rows.slice(0, 50), null, 2),
          '```',
        ];
        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog('Error in adv_get_execution_analytics', { error: message, args });
        return {
          content: [{ type: 'text' as const, text: `❌ Error getting execution analytics: ${message}` }],
        };
      }
    },
  );
}
