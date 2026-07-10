/**
 * v9.2.5 — TAM template 7: test case development / authoring trend (CREATED_AT × AMOUNT).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { parseAuthoringTrendRows, sumAuthoringAmounts } from '../utils/widget-response-parsers.js';

export const AUTHORING_TREND_TEMPLATE_ID = 7;

export const AUTHORING_GROUPING_PERIOD = ['DAY', 'WEEK', 'MONTH'] as const;
export type AuthoringGroupingPeriod = (typeof AUTHORING_GROUPING_PERIOD)[number];

const projectArg = z
  .union([z.enum(['web', 'android', 'ios', 'api']), z.string(), z.number()])
  .describe("Project alias, key, or numeric projectId");

export interface TestAuthoringTrendToolDeps {
  resolveProjectId: (project: string | number) => Promise<{ projectId: number }>;
  callWidgetSql: WidgetSqlCaller;
  debugLog: (message: string, data?: unknown) => void;
}

export function registerTestAuthoringTrendTool(server: McpServer, deps: TestAuthoringTrendToolDeps): void {
  const { resolveProjectId, callWidgetSql, debugLog } = deps;

  server.registerTool(
    'get_test_authoring_trend',
    {
      description:
        '📈 TCM test case development trend (TAM widget template 7): daily/weekly/monthly count of test cases created over time (CREATED_AT × AMOUNT). ' +
        'Not the same as adv_get_tcm_case_analytics net_change (TCM widget 37777) or adv_get_test_case_distribution_by_field (field pie 37780).',
      inputSchema: {
        project: projectArg.default('web'),
        period: z.enum(ALL_PERIODS).default('Last 14 Days'),
        ...widgetPeriodZodFields('Last 14 Days'),
        grouping_period: z
          .enum(AUTHORING_GROUPING_PERIOD)
          .default('DAY')
          .describe('Bucket size for the trend series (template 7 groupingPeriod)'),
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
        debugLog('adv_get_test_authoring_trend called', args);
        const { projectId } = await resolveProjectId(args.project);
        const periodInput = pickWidgetPeriodInput(args);

        const paramsConfig = buildParamsConfig({
          period: args.period,
          periodInput,
          extra: {
            groupingPeriod: args.grouping_period,
            dashboardName: 'api-verify',
            isReact: true,
          },
        });

        const data = await callWidgetSql(projectId, AUTHORING_TREND_TEMPLATE_ID, paramsConfig);
        const rows = parseAuthoringTrendRows(Array.isArray(data) ? data : []);
        const resolvedPeriod = formatWidgetPeriodLabel(
          periodInput,
          extractResolvedPeriodLabel(Array.isArray(data) ? data as Array<Record<string, unknown>> : []),
          args.period,
        );
        const totalCreated = sumAuthoringAmounts(rows);

        if (args.format === 'compact') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                templateId: AUTHORING_TREND_TEMPLATE_ID,
                period: resolvedPeriod,
                grouping_period: args.grouping_period,
                total_created: totalCreated,
                rows,
              }),
            }],
          };
        }

        if (args.format === 'json') {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                templateId: AUTHORING_TREND_TEMPLATE_ID,
                period: resolvedPeriod,
                grouping_period: args.grouping_period,
                total_created: totalCreated,
                rows,
              }, null, 2),
            }],
          };
        }

        const lines = [
          `# Test case authoring trend — ${args.project}`,
          '',
          `**Period:** ${resolvedPeriod}`,
          `**Grouping:** ${args.grouping_period}`,
          `**Template:** ${AUTHORING_TREND_TEMPLATE_ID}`,
          `**Total cases created (sum of AMOUNT):** ${totalCreated}`,
          `**Data points:** ${rows.length}`,
          '',
          '| Date | Created |',
          '|------|---------|',
          ...rows.slice(0, 60).map(r => `| ${r.created_at} | ${r.amount} |`),
          rows.length > 60 ? `\n_…and ${rows.length - 60} more rows_` : '',
        ].filter(Boolean);

        return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        debugLog('Error in adv_get_test_authoring_trend', { error: message, args });
        return {
          content: [{ type: 'text' as const, text: `❌ Error getting test authoring trend: ${message}` }],
        };
      }
    },
  );
}
