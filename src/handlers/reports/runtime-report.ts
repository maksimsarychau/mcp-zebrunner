/**
 * Regression Runtime Efficiency Report.
 *
 * Collects runtime metrics for each platform on current and optionally
 * a previous milestone. Calculates deltas, flags degradation in
 * long-running tests (>20%), and produces a cross-platform comparison.
 */

import {
  type ReportContext,
  type ReportInput,
  type ReportOutput,
  type RuntimeData,
  COLORS,
} from "./types.js";
import { generatePngChart, type ChartConfig } from "../../utils/chart-generator.js";

interface RuntimeComparison {
  current: RuntimeData;
  previous?: RuntimeData;
  deltas: {
    avgRuntimePerTest: number | null;
    avgRuntimePerTestCase: number | null;
    wri: number | null;
    longPercent: number | null;
  };
  degraded: boolean;
}

export async function generateRuntimeReport(
  ctx: ReportContext,
  input: ReportInput,
): Promise<ReportOutput> {
  const { projects, milestone, previous_milestone } = input;
  const projectContexts = await ctx.resolveProjects(projects);

  const comparisons: RuntimeComparison[] = [];

  for (const pCtx of projectContexts) {
    const current = await ctx.fetchRuntime(pCtx, milestone);

    let previous: RuntimeData | undefined;
    if (previous_milestone) {
      previous = await ctx.fetchRuntime(pCtx, previous_milestone);
    }

    const deltas = {
      avgRuntimePerTest: calcDelta(current.avgRuntimePerTest, previous?.avgRuntimePerTest),
      avgRuntimePerTestCase: calcDelta(current.avgRuntimePerTestCase, previous?.avgRuntimePerTestCase),
      wri: calcDelta(current.wri, previous?.wri),
      longPercent: calcDelta(current.longPercent, previous?.longPercent),
    };

    const degraded = deltas.longPercent !== null && deltas.longPercent > 20;

    comparisons.push({ current, previous, deltas, degraded });
  }

  const contentBlocks: any[] = [];
  contentBlocks.push({
    type: "text" as const,
    text: buildRuntimeMarkdown(comparisons, ctx, milestone, previous_milestone),
  });

  try {
    const chartConfig = buildRuntimeChart(comparisons);
    const pngBuffer = await generatePngChart(chartConfig);
    contentBlocks.push({
      type: "image" as const,
      data: pngBuffer.toString('base64'),
      mimeType: "image/png",
    });
  } catch {
    // PNG generation failed
  }

  return { content: contentBlocks };
}

function calcDelta(current: number, previous?: number): number | null {
  if (previous === undefined || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function fmtDelta(d: number | null): string {
  if (d === null) return '—';
  const sign = d > 0 ? '+' : '';
  const icon = d > 20 ? ' ⚠️' : d < -10 ? ' ✅' : '';
  return `${sign}${d}%${icon}`;
}

function buildRuntimeMarkdown(
  comparisons: RuntimeComparison[],
  ctx: ReportContext,
  milestone?: string,
  previousMilestone?: string,
): string {
  const lines: string[] = [];
  lines.push('# Regression Runtime Efficiency Report');
  if (milestone) lines.push(`**Milestone:** ${milestone}${previousMilestone ? ` | **Baseline:** ${previousMilestone}` : ''}`);
  lines.push('');

  lines.push('## Current Metrics');
  lines.push('| Platform | Tests | Test Cases | Total Time | Avg/Test | Avg/TC | WRI | Short | Medium | Long |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');

  for (const c of comparisons) {
    const rt = c.current;
    lines.push(`| ${rt.project} | ${rt.totalTests} | ${rt.totalTestCases} | ${ctx.fmtSeconds(rt.totalElapsedSec)} | ${ctx.fmtSeconds(rt.avgRuntimePerTest)} | ${ctx.fmtSeconds(rt.avgRuntimePerTestCase)} | ${rt.wri} | ${rt.shortPercent}% (${rt.short}) | ${rt.mediumPercent}% (${rt.medium}) | ${rt.longPercent}% (${rt.long}) |`);
  }
  lines.push('');

  if (previousMilestone) {
    lines.push('## Delta vs Previous Milestone');
    lines.push('| Platform | Avg/Test Delta | Avg/TC Delta | WRI Delta | Long % Delta | Status |');
    lines.push('| --- | ---: | ---: | ---: | ---: | :---: |');

    for (const c of comparisons) {
      const status = c.degraded ? '⚠️ DEGRADED' : '✅ OK';
      lines.push(`| ${c.current.project} | ${fmtDelta(c.deltas.avgRuntimePerTest)} | ${fmtDelta(c.deltas.avgRuntimePerTestCase)} | ${fmtDelta(c.deltas.wri)} | ${fmtDelta(c.deltas.longPercent)} | ${status} |`);
    }
    lines.push('');

    const degradedPlatforms = comparisons.filter(c => c.degraded);
    if (degradedPlatforms.length > 0) {
      lines.push('### Degradation Alerts');
      for (const c of degradedPlatforms) {
        lines.push(`- **${c.current.project}**: Long-running tests increased by ${fmtDelta(c.deltas.longPercent)} (threshold: 20%)`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildRuntimeChart(comparisons: RuntimeComparison[]): ChartConfig {
  return {
    type: 'stacked_bar',
    title: 'Duration Distribution by Platform',
    labels: comparisons.map(c => c.current.project),
    datasets: [
      { label: 'Short (<5m)', values: comparisons.map(c => c.current.short), color: COLORS.short },
      { label: 'Medium (5-10m)', values: comparisons.map(c => c.current.medium), color: COLORS.medium },
      { label: 'Long (>10m)', values: comparisons.map(c => c.current.long), color: COLORS.long },
    ],
    width: 800,
    height: 400,
  };
}
