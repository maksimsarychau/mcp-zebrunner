/**
 * Quality Dashboard report.
 *
 * Orchestrates parallel API calls across multiple projects and returns
 * a unified HTML dashboard + Markdown summary with PNG charts.
 * Supports 6 configurable sections: pass_rate, runtime, coverage, bugs, milestones, flaky.
 */

import {
  type ReportContext,
  type ReportInput,
  type ReportOutput,
  type PassRateData,
  type RuntimeData,
  type CoverageData,
  type BugsData,
  type MilestoneData,
  type FlakyData,
  type PassRateTargets,
  type ProjectContext,
  ALL_DASHBOARD_SECTIONS,
  DEFAULT_TARGETS,
  COLORS,
} from "./types.js";
import { generatePngChart, type ChartConfig } from "../../utils/chart-generator.js";
import {
  generateDashboardHtml,
  type DashboardData,
  type DashboardSection,
} from "../../utils/dashboard-template.js";

interface ProjectDashboardData {
  passRate?: PassRateData;
  runtime?: RuntimeData;
  coverage?: CoverageData;
  bugs?: BugsData;
  milestones?: MilestoneData;
  flaky?: FlakyData;
}

export async function generateQualityDashboardReport(
  ctx: ReportContext,
  input: ReportInput,
): Promise<ReportOutput> {
  const {
    projects,
    period,
    milestone,
    top_bugs_limit = 10,
    sections = ALL_DASHBOARD_SECTIONS,
    targets,
  } = input;

  const mergedTargets: PassRateTargets = { ...DEFAULT_TARGETS, ...(targets ?? {}) };
  const enabledSections = new Set(sections);
  const periodDays = ctx.periodToDays(period);

  const projectContexts = await ctx.resolveProjects(projects);

  const allData = await Promise.all(
    projectContexts.map(pCtx =>
      fetchProjectData(ctx, pCtx, period, periodDays, milestone, top_bugs_limit, enabledSections),
    ),
  );

  const dashboardSections: DashboardSection[] = [];

  if (enabledSections.has('pass_rate')) {
    const passRates = allData.map(d => d.passRate).filter(Boolean) as PassRateData[];
    if (passRates.length > 0) dashboardSections.push(buildPassRateSection(passRates, mergedTargets));
  }
  if (enabledSections.has('runtime')) {
    const runtimes = allData.map(d => d.runtime).filter(Boolean) as RuntimeData[];
    if (runtimes.length > 0) dashboardSections.push(buildRuntimeSection(runtimes, ctx));
  }
  if (enabledSections.has('coverage')) {
    const coverages = allData.map(d => d.coverage).filter(Boolean) as CoverageData[];
    if (coverages.length > 0) dashboardSections.push(buildCoverageSection(coverages));
  }
  if (enabledSections.has('bugs')) {
    const bugs = allData.map(d => d.bugs).filter(Boolean) as BugsData[];
    if (bugs.length > 0) dashboardSections.push(buildBugsSection(bugs, top_bugs_limit));
  }
  if (enabledSections.has('milestones')) {
    const milestones = allData.map(d => d.milestones).filter(Boolean) as MilestoneData[];
    if (milestones.length > 0) dashboardSections.push(buildMilestonesSection(milestones));
  }
  if (enabledSections.has('flaky')) {
    const flaky = allData.map(d => d.flaky).filter(Boolean) as FlakyData[];
    if (flaky.length > 0) dashboardSections.push(buildFlakySection(flaky));
  }

  const projectNames = projectContexts.map(c => c.alias);
  const generatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  const dashboardData: DashboardData = {
    title: 'Quality Dashboard',
    period,
    projects: projectNames,
    generatedAt,
    sections: dashboardSections,
  };

  const htmlDashboard = generateDashboardHtml(dashboardData);

  const contentBlocks: any[] = [];
  contentBlocks.push({
    type: "text" as const,
    text: buildMarkdownSummary(dashboardData, allData, mergedTargets, ctx),
  });

  for (const section of dashboardSections) {
    if (section.chartType === 'table') continue;
    try {
      const chartConfig = sectionToChartConfig(section);
      const pngBuffer = await generatePngChart(chartConfig);
      contentBlocks.push({
        type: "image" as const,
        data: pngBuffer.toString('base64'),
        mimeType: "image/png",
      });
    } catch {
      // PNG generation failed — markdown text is still there
    }
  }

  contentBlocks.push({
    type: "text" as const,
    text: `\n\n---\n\n[HTML_DASHBOARD]\nThe self-contained HTML dashboard is attached below. Save it as a .html file and open in a browser for interactive charts.\n\n\`\`\`html\n${htmlDashboard}\n\`\`\``,
  });

  return { content: contentBlocks };
}

// ── Data Fetching ────────────────────────────────────────────────────────

async function fetchProjectData(
  ctx: ReportContext,
  pCtx: ProjectContext,
  period: string,
  periodDays: number,
  milestone: string | undefined,
  bugsLimit: number,
  sections: Set<string>,
): Promise<ProjectDashboardData> {
  const fetchers: Promise<any>[] = [];
  const keys: string[] = [];

  if (sections.has('pass_rate')) {
    keys.push('passRate');
    fetchers.push(ctx.fetchPassRate(pCtx, period, milestone).catch(() => null));
  }
  if (sections.has('runtime')) {
    keys.push('runtime');
    fetchers.push(ctx.fetchRuntime(pCtx, milestone).catch(() => null));
  }
  if (sections.has('coverage')) {
    keys.push('coverage');
    fetchers.push(ctx.fetchCoverage(pCtx).catch(() => null));
  }
  if (sections.has('bugs')) {
    keys.push('bugs');
    fetchers.push(ctx.fetchBugs(pCtx, period, bugsLimit, milestone).catch(() => null));
  }
  if (sections.has('milestones')) {
    keys.push('milestones');
    fetchers.push(ctx.fetchMilestones(pCtx, periodDays).catch(() => null));
  }
  if (sections.has('flaky')) {
    keys.push('flaky');
    fetchers.push(ctx.fetchFlaky(pCtx, periodDays, milestone).catch(() => null));
  }

  const results = await Promise.all(fetchers);
  const data: ProjectDashboardData = {};
  keys.forEach((k, i) => {
    if (results[i] !== null) (data as any)[k] = results[i];
  });
  return data;
}

// ── Section Builders ────────────────────────────────────────────────────

function buildPassRateSection(data: PassRateData[], targets: PassRateTargets): DashboardSection {
  const labels = data.map(d => d.project);
  const datasets = [
    { label: 'Passed', data: data.map(d => d.passed), backgroundColor: COLORS.passed },
    { label: 'Failed', data: data.map(d => d.failed), backgroundColor: COLORS.failed },
    { label: 'Skipped', data: data.map(d => d.skipped), backgroundColor: COLORS.skipped },
    { label: 'Known Issue', data: data.map(d => d.knownIssue), backgroundColor: COLORS.knownIssue },
    { label: 'Aborted', data: data.map(d => d.aborted), backgroundColor: COLORS.aborted },
  ].filter(ds => ds.data.some(v => v > 0));

  const summaryParts = data.map(d => {
    const target = targets[d.project.toLowerCase()] ?? targets[d.project] ?? 90;
    const icon = d.passRate >= target ? '✅' : '⚠️';
    return `${d.project}: ${d.passRate}% ${icon} (target: ${target}%) | excl. known: ${d.passRateExclKnown}%`;
  });

  return {
    id: 'pass_rate',
    title: 'Pass Rate Overview',
    chartType: 'stacked_bar',
    labels,
    datasets,
    summary: summaryParts.join('\n'),
  };
}

function buildRuntimeSection(data: RuntimeData[], ctx: ReportContext): DashboardSection {
  const hasData = data.some(d => d.short + d.medium + d.long > 0);

  const summaryParts = data.map(d => {
    const fmtAvg = d.avgRuntimePerTest > 0 ? ctx.fmtSeconds(d.avgRuntimePerTest) : 'N/A';
    const fmtTotal = d.totalElapsedSec > 0 ? ctx.fmtSeconds(d.totalElapsedSec) : 'N/A';
    return `${d.project}: ${d.totalTests} tests, avg ${fmtAvg}/test, WRI: ${d.wri}, total: ${fmtTotal} | S:${d.shortPercent}% M:${d.mediumPercent}% L:${d.longPercent}%`;
  });

  return {
    id: 'runtime',
    title: 'Regression Runtime Efficiency',
    chartType: 'stacked_bar',
    labels: data.map(d => d.project),
    datasets: [
      { label: 'Short (<5m)', data: data.map(d => d.short), backgroundColor: COLORS.short },
      { label: 'Medium (5-10m)', data: data.map(d => d.medium), backgroundColor: COLORS.medium },
      { label: 'Long (>10m)', data: data.map(d => d.long), backgroundColor: COLORS.long },
    ],
    summary: hasData ? summaryParts.join('\n') : 'No runtime data available for this period',
  };
}

function buildCoverageSection(data: CoverageData[]): DashboardSection {
  if (data.length === 1) {
    const d = data[0];
    return {
      id: 'coverage',
      title: `Automation Coverage — ${d.project}`,
      chartType: 'pie',
      labels: ['Automated', 'Manual', 'Not Automated'],
      datasets: [{
        label: 'Test Cases',
        data: [d.automated, d.manual, d.notAutomated],
        backgroundColor: [COLORS.automated, COLORS.manual, COLORS.notAutomated],
      }],
      summary: `${d.total} total test cases — ${d.total > 0 ? ((d.automated / d.total) * 100).toFixed(1) : 0}% automated`,
    };
  }

  return {
    id: 'coverage',
    title: 'Automation Coverage Sustainability',
    chartType: 'bar',
    labels: data.map(d => d.project),
    datasets: [
      { label: 'Automated', data: data.map(d => d.automated), backgroundColor: COLORS.automated },
      { label: 'Manual', data: data.map(d => d.manual), backgroundColor: COLORS.manual },
      { label: 'Not Automated', data: data.map(d => d.notAutomated), backgroundColor: COLORS.notAutomated },
    ],
    summary: data.map(d =>
      `${d.project}: ${d.total > 0 ? ((d.automated / d.total) * 100).toFixed(1) : 0}% automated (${d.automated}/${d.total})`,
    ).join(' | '),
  };
}

function buildBugsSection(data: BugsData[], limit: number): DashboardSection {
  const allBugs = data.flatMap(d => d.bugs.map(b => ({ ...b, project: d.project })));
  allBugs.sort((a, b) => b.failures - a.failures);
  const top = allBugs.slice(0, limit);

  return {
    id: 'bugs',
    title: `Top ${top.length} Bugs`,
    chartType: 'horizontal_bar',
    labels: top.map(b => `${b.key} (${b.project})`),
    datasets: [{ label: 'Failures', data: top.map(b => b.failures) }],
    summary: `${allBugs.length} unique bugs across ${data.length} project(s)`,
  };
}

function buildMilestonesSection(data: MilestoneData[]): DashboardSection {
  const headers = ['Project', 'Milestone', 'Status', 'Start Date', 'Due Date'];
  const rows: string[][] = [];

  for (const d of data) {
    for (const m of d.milestones.slice(0, 15)) {
      const status = m.completed ? '✅ Completed' : m.overdue ? '⚠️ OVERDUE' : '🔄 In Progress';
      const start = m.startDate ? new Date(m.startDate).toLocaleDateString() : '—';
      const due = m.dueDate ? new Date(m.dueDate).toLocaleDateString() : '—';
      rows.push([d.project, m.name, status, start, due]);
    }
  }

  const totalMs = data.reduce((s, d) => s + d.milestones.length, 0);
  const completed = data.reduce((s, d) => s + d.milestones.filter(m => m.completed).length, 0);
  const overdue = data.reduce((s, d) => s + d.milestones.filter(m => m.overdue).length, 0);
  const inProgress = totalMs - completed - overdue;

  return {
    id: 'milestones',
    title: 'Milestone Summary',
    chartType: 'table',
    labels: [],
    datasets: [],
    tableHeaders: headers,
    tableRows: rows,
    summary: `${totalMs} milestones in period — ${completed} completed, ${inProgress} in progress, ${overdue} overdue`,
  };
}

function buildFlakySection(data: FlakyData[]): DashboardSection {
  const allFlaky = data.flatMap(d => d.flaky.map(f => ({ ...f, project: d.project })));

  if (allFlaky.length === 0) {
    return {
      id: 'flaky',
      title: 'Flaky Tests',
      chartType: 'table',
      labels: [],
      datasets: [],
      tableHeaders: ['Info'],
      tableRows: [['No flaky tests detected in this period']],
      summary: 'No flaky tests found',
    };
  }

  allFlaky.sort((a, b) => b.flipCount - a.flipCount);
  const top = allFlaky.slice(0, 10);

  const headers = ['Project', 'Test Name', 'Flips', 'Pass Rate', 'Stability'];
  const rows: string[][] = top.map(f => [
    f.project,
    f.testName.length > 60 ? f.testName.substring(0, 57) + '...' : f.testName,
    String(f.flipCount),
    `${f.passRate}%`,
    `${f.stability}%`,
  ]);

  const totalFlaky = data.reduce((s, d) => s + d.total, 0);

  return {
    id: 'flaky',
    title: 'Flaky Tests',
    chartType: 'table',
    labels: [],
    datasets: [],
    tableHeaders: headers,
    tableRows: rows,
    summary: `${totalFlaky} flaky tests detected across ${data.length} project(s)`,
  };
}

// ── Output Helpers ──────────────────────────────────────────────────────

function sectionToChartConfig(section: DashboardSection): ChartConfig {
  return {
    type: section.chartType as ChartConfig['type'],
    title: section.title,
    labels: section.labels,
    datasets: section.datasets.map(ds => ({
      label: ds.label,
      values: ds.data,
      color: typeof ds.backgroundColor === 'string' ? ds.backgroundColor : undefined,
    })),
    width: 800,
    height: 400,
  };
}

function buildMarkdownSummary(
  dashboardData: DashboardData,
  allData: ProjectDashboardData[],
  targets: PassRateTargets,
  ctx: ReportContext,
): string {
  const lines: string[] = [];
  lines.push(`# Quality Dashboard`);
  lines.push(`**Projects:** ${dashboardData.projects.join(', ')} | **Period:** ${dashboardData.period} | **Generated:** ${dashboardData.generatedAt}`);
  lines.push('');

  const prData = allData.map(d => d.passRate).filter(Boolean) as PassRateData[];
  if (prData.length > 0) {
    lines.push('## Pass Rate Overview');
    lines.push('| Project | Total | Passed | Failed | Known Issue | Skipped | Pass Rate | excl. Known | Target | Status |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const pr of prData) {
      const target = targets[pr.project.toLowerCase()] ?? targets[pr.project] ?? 90;
      const icon = pr.passRate >= target ? '✅' : '⚠️';
      lines.push(`| ${pr.project} | ${pr.total} | ${pr.passed} | ${pr.failed} | ${pr.knownIssue} | ${pr.skipped} | ${pr.passRate}% | ${pr.passRateExclKnown}% | ${target}% | ${icon} |`);
    }
    lines.push('');
  }

  const rtData = allData.map(d => d.runtime).filter(Boolean) as RuntimeData[];
  if (rtData.length > 0 && rtData.some(r => r.totalTests > 0)) {
    lines.push('## Regression Runtime Efficiency');
    lines.push('| Project | Tests | Test Cases | Total Time | Avg/Test | Avg/TC | WRI | Short | Medium | Long |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const rt of rtData) {
      lines.push(`| ${rt.project} | ${rt.totalTests} | ${rt.totalTestCases} | ${ctx.fmtSeconds(rt.totalElapsedSec)} | ${ctx.fmtSeconds(rt.avgRuntimePerTest)} | ${ctx.fmtSeconds(rt.avgRuntimePerTestCase)} | ${rt.wri} | ${rt.shortPercent}% (${rt.short}) | ${rt.mediumPercent}% (${rt.medium}) | ${rt.longPercent}% (${rt.long}) |`);
    }
    lines.push('');
  }

  for (const section of dashboardData.sections) {
    if (section.id === 'pass_rate' || section.id === 'runtime') continue;
    lines.push(`## ${section.title}`);
    if (section.summary) lines.push(`> ${section.summary}`);
    lines.push('');
    if (section.chartType === 'table' && section.tableHeaders && section.tableRows) {
      lines.push('| ' + section.tableHeaders.join(' | ') + ' |');
      lines.push('| ' + section.tableHeaders.map(() => '---').join(' | ') + ' |');
      for (const row of section.tableRows) {
        lines.push('| ' + row.join(' | ') + ' |');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
