/**
 * Combined Executive Dashboard Report.
 *
 * Produces a standup-ready executive summary combining:
 * Pass Rate, Runtime, Top 5 Bugs, Coverage, and Flaky Tests.
 * Returns Markdown + PNG charts + HTML dashboard.
 */

import {
  type ReportContext,
  type ReportInput,
  type ReportOutput,
  type PassRateData,
  type RuntimeData,
  type CoverageData,
  type BugsData,
  type FlakyData,
  type PassRateTargets,
  type ProjectContext,
  DEFAULT_TARGETS,
  COLORS,
} from "./types.js";
import { generatePngChart, type ChartConfig } from "../../utils/chart-generator.js";
import {
  generateDashboardHtml,
  type DashboardData,
  type DashboardSection,
} from "../../utils/dashboard-template.js";

interface ExecutiveData {
  passRate?: PassRateData;
  runtime?: RuntimeData;
  coverage?: CoverageData;
  bugs?: BugsData;
  flaky?: FlakyData;
}

export async function generateExecutiveReport(
  ctx: ReportContext,
  input: ReportInput,
): Promise<ReportOutput> {
  const { projects, period, milestone, targets, top_bugs_limit = 5 } = input;
  const mergedTargets: PassRateTargets = { ...DEFAULT_TARGETS, ...(targets ?? {}) };
  const periodDays = ctx.periodToDays(period);

  const projectContexts = await ctx.resolveProjects(projects);

  const allData = await Promise.all(
    projectContexts.map(pCtx => fetchExecutiveData(ctx, pCtx, period, periodDays, milestone, top_bugs_limit)),
  );

  const markdown = buildExecutiveMarkdown(allData, projectContexts, mergedTargets, ctx, period, milestone);
  const contentBlocks: any[] = [{ type: "text" as const, text: markdown }];

  const sections = buildDashboardSections(allData, mergedTargets, top_bugs_limit, ctx);

  for (const section of sections) {
    if (section.chartType === 'table') continue;
    try {
      const chartConfig: ChartConfig = {
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
      const pngBuffer = await generatePngChart(chartConfig);
      contentBlocks.push({ type: "image" as const, data: pngBuffer.toString('base64'), mimeType: "image/png" });
    } catch {
      // PNG generation failed
    }
  }

  const generatedAt = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const dashboardData: DashboardData = {
    title: 'Executive QA Dashboard',
    period,
    projects: projectContexts.map(c => c.alias),
    generatedAt,
    sections,
  };
  const htmlDashboard = generateDashboardHtml(dashboardData);

  contentBlocks.push({
    type: "text" as const,
    text: `\n\n---\n\n[HTML_DASHBOARD]\nSave as .html and open in a browser for interactive charts.\n\n\`\`\`html\n${htmlDashboard}\n\`\`\``,
  });

  return { content: contentBlocks };
}

async function fetchExecutiveData(
  ctx: ReportContext,
  pCtx: ProjectContext,
  period: string,
  periodDays: number,
  milestone: string | undefined,
  bugsLimit: number,
): Promise<ExecutiveData> {
  const [passRate, runtime, coverage, bugs, flaky] = await Promise.allSettled([
    ctx.fetchPassRate(pCtx, period, milestone),
    ctx.fetchRuntime(pCtx, milestone),
    ctx.fetchCoverage(pCtx),
    ctx.fetchBugs(pCtx, period, bugsLimit, milestone),
    ctx.fetchFlaky(pCtx, periodDays, milestone),
  ]);

  return {
    passRate: passRate.status === 'fulfilled' ? passRate.value : undefined,
    runtime: runtime.status === 'fulfilled' ? runtime.value : undefined,
    coverage: coverage.status === 'fulfilled' ? coverage.value : undefined,
    bugs: bugs.status === 'fulfilled' ? bugs.value : undefined,
    flaky: flaky.status === 'fulfilled' ? flaky.value : undefined,
  };
}

function buildExecutiveMarkdown(
  allData: ExecutiveData[],
  contexts: ProjectContext[],
  targets: PassRateTargets,
  ctx: ReportContext,
  period: string,
  milestone?: string,
): string {
  const lines: string[] = [];
  lines.push('# Executive QA Dashboard');
  lines.push(`**Period:** ${period}${milestone ? ` | **Milestone:** ${milestone}` : ''} | **Platforms:** ${contexts.map(c => c.alias).join(', ')}`);
  lines.push('');

  // Pass Rate
  const prData = allData.map(d => d.passRate).filter(Boolean) as PassRateData[];
  if (prData.length > 0) {
    lines.push('## Pass Rate');
    lines.push('| Platform | Pass Rate | excl. Known | Target | Status |');
    lines.push('| --- | ---: | ---: | ---: | :---: |');
    for (const pr of prData) {
      const target = targets[pr.project.toLowerCase()] ?? targets[pr.project] ?? 90;
      const icon = pr.passRate >= target ? '✅' : '⚠️';
      lines.push(`| ${pr.project} | ${pr.passRate}% | ${pr.passRateExclKnown}% | ${target}% | ${icon} |`);
    }
    lines.push('');
  }

  // Runtime
  const rtData = allData.map(d => d.runtime).filter(Boolean) as RuntimeData[];
  if (rtData.length > 0 && rtData.some(r => r.totalTests > 0)) {
    lines.push('## Regression Runtime');
    lines.push('| Platform | Avg/Test | WRI | Short | Medium | Long |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const rt of rtData) {
      lines.push(`| ${rt.project} | ${ctx.fmtSeconds(rt.avgRuntimePerTest)} | ${rt.wri} | ${rt.shortPercent}% | ${rt.mediumPercent}% | ${rt.longPercent}% |`);
    }
    lines.push('');
  }

  // Top Bugs
  const allBugs = allData.flatMap(d => d.bugs?.bugs.map(b => ({ ...b, project: d.bugs!.project })) ?? []);
  allBugs.sort((a, b) => b.failures - a.failures);
  const topBugs = allBugs.slice(0, 5);
  if (topBugs.length > 0) {
    lines.push('## Top 5 Bugs');
    lines.push('| # | Defect | Platform | Failures | Repro % |');
    lines.push('| ---: | --- | --- | ---: | ---: |');
    topBugs.forEach((b, i) => {
      lines.push(`| ${i + 1} | ${b.key} | ${b.project} | ${b.failures} | ${b.percentage}% |`);
    });
    lines.push('');
  }

  // Coverage
  const cvData = allData.map(d => d.coverage).filter(Boolean) as CoverageData[];
  if (cvData.length > 0) {
    lines.push('## Automation Coverage');
    lines.push('| Platform | Automated | Manual | Not Automated | Total | Coverage % |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const cv of cvData) {
      const pct = cv.total > 0 ? ((cv.automated / cv.total) * 100).toFixed(1) : '0.0';
      lines.push(`| ${cv.project} | ${cv.automated} | ${cv.manual} | ${cv.notAutomated} | ${cv.total} | ${pct}% |`);
    }
    lines.push('');
  }

  // Flaky Tests
  const allFlaky = allData.flatMap(d => d.flaky?.flaky.map(f => ({ ...f, project: d.flaky!.project })) ?? []);
  allFlaky.sort((a, b) => b.flipCount - a.flipCount);
  const topFlaky = allFlaky.slice(0, 5);
  if (topFlaky.length > 0) {
    lines.push('## Flaky Tests');
    lines.push('| Platform | Test Name | Flips | Stability |');
    lines.push('| --- | --- | ---: | ---: |');
    for (const f of topFlaky) {
      const name = f.testName.length > 50 ? f.testName.substring(0, 47) + '...' : f.testName;
      lines.push(`| ${f.project} | ${name} | ${f.flipCount} | ${f.stability}% |`);
    }
    lines.push('');
  } else {
    lines.push('## Flaky Tests');
    lines.push('No flaky tests detected in this period.');
    lines.push('');
  }

  return lines.join('\n');
}

function buildDashboardSections(
  allData: ExecutiveData[],
  targets: PassRateTargets,
  bugsLimit: number,
  ctx: ReportContext,
): DashboardSection[] {
  const sections: DashboardSection[] = [];

  const prData = allData.map(d => d.passRate).filter(Boolean) as PassRateData[];
  if (prData.length > 0) {
    sections.push({
      id: 'pass_rate',
      title: 'Pass Rate',
      chartType: 'stacked_bar',
      labels: prData.map(d => d.project),
      datasets: [
        { label: 'Passed', data: prData.map(d => d.passed), backgroundColor: COLORS.passed },
        { label: 'Failed', data: prData.map(d => d.failed), backgroundColor: COLORS.failed },
        { label: 'Known Issue', data: prData.map(d => d.knownIssue), backgroundColor: COLORS.knownIssue },
      ].filter(ds => ds.data.some(v => v > 0)),
      summary: prData.map(d => {
        const t = targets[d.project.toLowerCase()] ?? 90;
        return `${d.project}: ${d.passRate}% ${d.passRate >= t ? '✅' : '⚠️'}`;
      }).join(' | '),
    });
  }

  const cvData = allData.map(d => d.coverage).filter(Boolean) as CoverageData[];
  if (cvData.length > 0) {
    sections.push({
      id: 'coverage',
      title: 'Automation Coverage',
      chartType: 'bar',
      labels: cvData.map(d => d.project),
      datasets: [
        { label: 'Automated', data: cvData.map(d => d.automated), backgroundColor: COLORS.automated },
        { label: 'Not Automated', data: cvData.map(d => d.notAutomated), backgroundColor: COLORS.notAutomated },
      ],
      summary: cvData.map(d => `${d.project}: ${d.total > 0 ? ((d.automated / d.total) * 100).toFixed(1) : 0}%`).join(' | '),
    });
  }

  return sections;
}
