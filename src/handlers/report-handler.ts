/**
 * Universal Report handler.
 *
 * Routes to individual report generators based on report_types,
 * provides shared data-fetching methods used across all report types.
 */

import { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import { ZebrunnerReportingToolHandlers } from "./reporting-tools.js";
import {
  buildParamsConfig,
  getTemplate,
  parseWidgetStatusCounts,
  type WidgetSqlCaller,
} from "../utils/widget-sql.js";
import { getConfig } from "../utils/config-loader.js";

import {
  type ProjectContext,
  type PassRateData,
  type RuntimeData,
  type CoverageData,
  type BugEntry,
  type BugsData,
  type MilestoneEntry,
  type MilestoneData,
  type FlakyData,
  type FlakyEntry,
  type ReportInput,
  type ReportOutput,
  type ReportContext,
  PERIOD_DAYS_MAP,
} from "./reports/types.js";

import { generateQualityDashboardReport } from "./reports/quality-dashboard.js";
import { generateCoverageReport } from "./reports/coverage-report.js";
import { generatePassRateReport } from "./reports/pass-rate-report.js";
import { generateRuntimeReport } from "./reports/runtime-report.js";
import { generateExecutiveReport } from "./reports/executive-report.js";
import { generateReleaseReadinessReport } from "./reports/release-readiness.js";
import { noMilestoneLaunchesMessage } from "./reports/pass-rate-display.js";

export { type ReportInput, type ReportOutput } from "./reports/types.js";

type ReportGenerator = (ctx: ReportContext, input: ReportInput) => Promise<ReportOutput>;

const REPORT_GENERATORS: Record<string, ReportGenerator> = {
  quality_dashboard: generateQualityDashboardReport,
  coverage: generateCoverageReport,
  pass_rate: generatePassRateReport,
  runtime_efficiency: generateRuntimeReport,
  executive_dashboard: generateExecutiveReport,
  release_readiness: generateReleaseReadinessReport,
};

export class ReportHandler implements ReportContext {
  constructor(
    public reportingClient: ZebrunnerReportingClient,
    public publicClient: EnhancedZebrunnerClient,
    public reportingHandlers: ZebrunnerReportingToolHandlers,
    public callWidgetSql: WidgetSqlCaller,
    private _resolveProjectId: (project: string | number) => Promise<{ projectId: number }>,
    private projectAliases: Record<string, string>,
  ) {}

  async generateReport(input: ReportInput): Promise<ReportOutput> {
    const { report_types } = input;
    const contentBlocks: any[] = [];

    for (const reportType of report_types) {
      const generator = REPORT_GENERATORS[reportType];
      if (!generator) {
        contentBlocks.push({
          type: "text" as const,
          text: `Unknown report type: "${reportType}". Available: ${Object.keys(REPORT_GENERATORS).join(', ')}`,
        });
        continue;
      }

      if (report_types.length > 1) {
        contentBlocks.push({
          type: "text" as const,
          text: `\n\n---\n\n## Report: ${reportType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n`,
        });
      }

      try {
        const result = await generator(this, input);
        contentBlocks.push(...result.content);
      } catch (error: any) {
        contentBlocks.push({
          type: "text" as const,
          text: `Error generating ${reportType} report: ${error?.message || error}`,
        });
      }
    }

    return { content: contentBlocks };
  }

  // ── Project Resolution ─────────────────────────────────────────────────

  async resolveProjects(projects: string[]): Promise<ProjectContext[]> {
    const results = await Promise.allSettled(
      projects.map(async (alias) => {
        const key = this.projectAliases[alias] || alias;
        const { projectId } = await this._resolveProjectId(key);
        return { alias, projectKey: key, projectId } as ProjectContext;
      })
    );

    const resolved: ProjectContext[] = [];
    const failed: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        resolved.push(r.value);
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        failed.push(`${projects[i]}: ${reason}`);
      }
    }

    if (failed.length > 0) {
      console.error(`⚠️ [resolveProjects] Failed to resolve ${failed.length}/${projects.length} project(s): ${failed.join('; ')}`);
    }

    if (resolved.length === 0) {
      throw new Error(`Could not resolve any of the specified projects: ${projects.join(', ')}. Errors: ${failed.join('; ')}`);
    }

    return resolved;
  }

  // ── Shared Fetch Methods ──────────────────────────────────────────────

  async fetchPassRate(ctx: ProjectContext, period: string, milestone?: string): Promise<PassRateData> {
    const result = await this.fetchPassRateOnce(ctx, period, milestone);

    if (milestone && result.total === 0) {
      console.error(
        `⚠️ [fetchPassRate] ${ctx.alias}: no launches assigned to milestone "${milestone}" — ` +
        `pass rate omitted (not 0%)`
      );
      return {
        ...result,
        noMilestoneLaunches: true,
        milestoneNote: noMilestoneLaunchesMessage(milestone),
      };
    }

    return result;
  }

  private async fetchPassRateOnce(
    ctx: ProjectContext,
    period: string,
    milestone?: string,
  ): Promise<PassRateData> {
    const params = buildParamsConfig({
      period,
      milestone: milestone ? [milestone] : [],
    });
    const widgetData = await this.callWidgetSql(ctx.projectId, getTemplate().RESULTS_BY_PLATFORM, params);
    if (!Array.isArray(widgetData)) {
      console.error(
        `⚠️ [fetchPassRate] Widget SQL returned non-array for project ${ctx.alias}` +
        ` (type=${typeof widgetData}), falling back to launches API`
      );
    }
    const rows: any[] = Array.isArray(widgetData) ? widgetData : [];

    let passed = 0, failed = 0, skipped = 0, knownIssue = 0, aborted = 0;
    let dataSource: 'widget_sql' | 'launches_fallback' = 'widget_sql';

    const widgetCounts = parseWidgetStatusCounts(rows);
    if (widgetCounts) {
      passed = widgetCounts.passed;
      failed = widgetCounts.failed;
      skipped = widgetCounts.skipped;
      knownIssue = widgetCounts.knownIssue;
      aborted = widgetCounts.aborted;
      console.error(
        `📊 [fetchPassRate] ${ctx.alias}: parsed ${rows.length} widget row(s), ` +
        `passed=${passed} failed=${failed} skipped=${skipped} knownIssue=${knownIssue} aborted=${aborted}`
      );
    }

    const widgetTotal = passed + failed + skipped + knownIssue + aborted;
    if (widgetTotal === 0) {
      dataSource = 'launches_fallback';
      const reason = rows.length === 0
        ? 'no widget rows'
        : 'widget rows did not yield status counts';
      console.error(
        `⚠️ [fetchPassRate] ${ctx.alias}: ${reason}, falling back to launches API`
      );

      let page = 1;
      let totalPages = 1;
      let launchCount = 0;
      while (page <= totalPages) {
        const launches = await this.reportingClient.getLaunches(ctx.projectId, {
          page,
          pageSize: 100,
          milestone,
        });
        totalPages = launches._meta?.totalPages ?? 1;
        const items = launches.items || [];
        launchCount += items.length;

        for (const l of items) {
          passed += l.passed || 0;
          failed += l.failed || 0;
          skipped += l.skipped || 0;
          aborted += l.aborted || 0;
        }
        page += 1;
      }

      if (launchCount === 0) {
        console.error(`⚠️ [fetchPassRate] Launches API returned 0 items for ${ctx.alias}`);
      } else {
        console.error(
          `📊 [fetchPassRate] ${ctx.alias} (launches fallback, ${launchCount} launches): ` +
          `passed=${passed} failed=${failed} skipped=${skipped} aborted=${aborted} ` +
          `(knownIssue not available in launches API)`
        );
      }
    }

    const total = passed + failed + skipped + knownIssue + aborted;
    const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
    const totalExclKnown = total - knownIssue;
    const passRateExclKnown = totalExclKnown > 0 ? Math.round((passed / totalExclKnown) * 1000) / 10 : 0;

    if (total === 0 && milestone) {
      console.error(
        `⚠️ [fetchPassRate] ${ctx.alias}: total=0 for milestone="${milestone}" ` +
        `(data source: ${dataSource}) — will mark as no launches on milestone`
      );
    } else if (total === 0) {
      console.error(
        `⚠️ [fetchPassRate] ${ctx.alias}: total=0 for period="${period}" ` +
        `(data source: ${dataSource})`
      );
    }

    return {
      project: ctx.alias,
      passed, failed, skipped, knownIssue, aborted, total,
      passRate,
      passRateExclKnown,
    };
  }

  async fetchRuntime(ctx: ProjectContext, milestone?: string): Promise<RuntimeData> {
    const result = await this.reportingHandlers.analyzeRegressionRuntime({
      projectId: ctx.projectId,
      projectKey: ctx.projectKey,
      milestone,
      includeTestDetails: false,
      includeAttemptsDetails: false,
      format: 'dto',
      chart: 'none',
    });

    const textBlock = result.content?.find((c: any) => c.type === 'text') as { type: 'text'; text: string } | undefined;
    if (!textBlock?.text) throw new Error(`No runtime data returned for project ${ctx.alias}`);

    const dto = JSON.parse(textBlock.text);
    const agg = dto.aggregated || dto;
    const dist = agg.durationDistribution || {};

    return {
      project: ctx.alias,
      short: dist.shortCount ?? 0,
      medium: dist.mediumCount ?? 0,
      long: dist.longCount ?? 0,
      totalTests: agg.totalTests ?? 0,
      totalTestCases: agg.totalTestCasesCovered ?? 0,
      totalElapsedSec: agg.totalElapsedSeconds ?? 0,
      avgRuntimePerTest: agg.overallAvgRuntimePerTest ?? 0,
      avgRuntimePerTestCase: agg.overallAvgRuntimePerTestCase ?? 0,
      wri: agg.overallWeightedRuntimeIndex ?? 0,
      shortPercent: dist.shortPercent ?? 0,
      mediumPercent: dist.mediumPercent ?? 0,
      longPercent: dist.longPercent ?? 0,
    };
  }

  async fetchCoverage(ctx: ProjectContext): Promise<CoverageData> {
    const automationStates = await this.reportingClient.getAutomationStates(ctx.projectId);

    const countByStateId = async (stateId: number): Promise<number> => {
      const result = await this.publicClient.getTestCases(ctx.projectKey, {
        filter: `automationState.id = ${stateId}`,
        size: 1,
      });
      return (result._meta as any)?.total ?? result._meta?.totalElements ?? result.items?.length ?? 0;
    };

    const counts = await Promise.all(
      automationStates.map(async (s) => ({
        name: s.name,
        count: await countByStateId(s.id),
      })),
    );

    const statesRecord: Record<string, number> = {};
    let total = 0;
    for (const { name, count } of counts) {
      statesRecord[name] = count;
      total += count;
    }

    const findByLower = (needle: string): number => {
      const entry = counts.find(c => c.name.toLowerCase() === needle);
      return entry?.count ?? 0;
    };

    return {
      project: ctx.alias,
      states: statesRecord,
      total,
      automated: findByLower('automated'),
      manual: findByLower('manual'),
      notAutomated: findByLower('not automated'),
    };
  }

  async fetchBugs(ctx: ProjectContext, period: string, limit: number, milestone?: string): Promise<BugsData> {
    const params = buildParamsConfig({
      period,
      milestone: milestone ? [milestone] : [],
      dashboardName: getConfig().dashboardNames.bugsReproRate,
    });
    const bugsWidgetData = await this.callWidgetSql(ctx.projectId, getTemplate().TOP_BUGS, params);
    if (!Array.isArray(bugsWidgetData)) {
      console.error(`⚠️ [fetchBugs] Widget SQL returned non-array for project ${ctx.alias} (got ${typeof bugsWidgetData})`);
    }
    const rows: any[] = Array.isArray(bugsWidgetData) ? bugsWidgetData : [];

    const bugs: BugEntry[] = rows.slice(0, limit).map(row => {
      const defectHtml = row.DEFECT || '';
      const textMatch = defectHtml.match?.(/>([^<]+)</);
      const key = textMatch ? textMatch[1] : 'Unknown';

      const failuresStr = row.FAILURES || '0 of 0';
      const match = failuresStr.match?.(/(\d+)\s+of\s+(\d+)/);
      const failures = match ? parseInt(match[1]) : 0;
      const total = match ? parseInt(match[2]) : 0;

      return { key, failures, total, percentage: parseFloat(row['%'] || '0') };
    }).sort((a, b) => b.failures - a.failures);

    return { project: ctx.alias, bugs };
  }

  async fetchMilestones(ctx: ProjectContext, periodDays: number): Promise<MilestoneData> {
    const response = await this.reportingClient.getMilestones(ctx.projectId, {
      pageSize: 50,
      completed: 'all',
    });

    const now = new Date();
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);

    const milestones: MilestoneEntry[] = (response.items || [])
      .filter(m => {
        const start = m.startDate ? new Date(m.startDate) : null;
        const due = m.dueDate ? new Date(m.dueDate) : null;
        if (!start && !due) return false;
        const mStart = start ?? due!;
        const mEnd = due ?? start!;
        return mEnd >= periodStart && mStart <= now;
      })
      .map(m => {
        const dueDate = m.dueDate || null;
        const overdue = !m.completed && dueDate != null && new Date(dueDate) < now;
        return {
          name: m.name,
          completed: m.completed,
          dueDate,
          startDate: m.startDate || null,
          overdue,
        };
      });

    return { project: ctx.alias, milestones };
  }

  async fetchFlaky(ctx: ProjectContext, periodDays: number, milestone?: string): Promise<FlakyData> {
    const result = await this.reportingHandlers.findFlakyTests({
      projectId: ctx.projectId,
      projectKey: ctx.projectKey,
      period_days: Math.min(periodDays, 30),
      milestone,
      limit: 10,
      include_manual: true,
      include_history: false,
      format: 'json',
      count_only: false,
      chart: 'none',
    });

    const textBlock = result.content?.find((c: any) => c.type === 'text') as { type: 'text'; text: string } | undefined;
    if (!textBlock?.text) throw new Error(`No flaky test data returned for project ${ctx.alias}`);

    const data = JSON.parse(textBlock.text);
    const items = data.flaky_tests || data.automated_flaky || data.items || [];

    const flaky: FlakyEntry[] = items.slice(0, 10).map((item: any) => ({
      testName: item.test_name || item.testName || item.name || 'Unknown',
      flipCount: item.flip_count || item.flipCount || 0,
      passRate: item.pass_rate ?? item.passRate ?? 0,
      stability: item.stability ?? item.avg_stability ?? 0,
    }));

    return {
      project: ctx.alias,
      flaky,
      total: data.total_flaky ?? data.totalFlaky ?? flaky.length,
    };
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  fmtSeconds(sec: number): string {
    if (sec <= 0) return '0s';
    if (sec < 60) return `${Math.round(sec)}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
  }

  periodToDays(period: string): number {
    return PERIOD_DAYS_MAP[period.toLowerCase()] ?? 30;
  }
}
