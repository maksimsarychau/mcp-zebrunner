/**
 * Pass Rate Report.
 *
 * Collects pass rate metrics for each platform on the latest milestone.
 * Shows total executed, passed, failed, known issues, pass rate,
 * pass rate excluding known issues, and target comparison.
 */

import {
  type ReportContext,
  type ReportInput,
  type ReportOutput,
  type PassRateData,
  type PassRateTargets,
  DEFAULT_TARGETS,
  COLORS,
} from "./types.js";
import { generatePngChart, type ChartConfig } from "../../utils/chart-generator.js";

export async function generatePassRateReport(
  ctx: ReportContext,
  input: ReportInput,
): Promise<ReportOutput> {
  const { projects, period, milestone, targets } = input;
  const mergedTargets: PassRateTargets = { ...DEFAULT_TARGETS, ...(targets ?? {}) };

  const projectContexts = await ctx.resolveProjects(projects);

  const data: PassRateData[] = [];
  const fetchWarnings: string[] = [];

  const results = await Promise.allSettled(
    projectContexts.map(pCtx => ctx.fetchPassRate(pCtx, period, milestone)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      data.push(r.value);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      fetchWarnings.push(`⚠️ [${projectContexts[i].alias}] Pass rate fetch failed: ${reason}`);
    }
  }

  const contentBlocks: any[] = [];
  if (fetchWarnings.length > 0) {
    contentBlocks.push({ type: "text" as const, text: fetchWarnings.join('\n') });
  }
  contentBlocks.push({ type: "text" as const, text: buildPassRateMarkdown(data, mergedTargets, period, milestone) });

  try {
    const chartConfig = buildPassRateChart(data, mergedTargets);
    const pngBuffer = await generatePngChart(chartConfig);
    contentBlocks.push({
      type: "image" as const,
      data: pngBuffer.toString('base64'),
      mimeType: "image/png",
    });
  } catch {
    // PNG generation failed — markdown is still available
  }

  return { content: contentBlocks };
}

function buildPassRateMarkdown(
  data: PassRateData[],
  targets: PassRateTargets,
  period: string,
  milestone?: string,
): string {
  const lines: string[] = [];
  lines.push('# Pass Rate Report');
  lines.push(`**Period:** ${period}${milestone ? ` | **Milestone:** ${milestone}` : ''}`);
  lines.push('');

  lines.push('| Platform | Total | Passed | Failed | Known Issues | Skipped | Pass Rate | excl. Known | Target | Status |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |');

  for (const d of data) {
    const target = targets[d.project.toLowerCase()] ?? targets[d.project] ?? 90;
    const icon = d.passRate >= target ? '✅' : '⚠️';
    lines.push(`| ${d.project} | ${d.total} | ${d.passed} | ${d.failed} | ${d.knownIssue} | ${d.skipped} | ${d.passRate}% | ${d.passRateExclKnown}% | ${target}% | ${icon} |`);
  }

  lines.push('');

  const allMeet = data.every(d => {
    const target = targets[d.project.toLowerCase()] ?? targets[d.project] ?? 90;
    return d.passRate >= target;
  });

  if (allMeet) {
    lines.push('**All platforms are on target.**');
  } else {
    const below = data.filter(d => {
      const target = targets[d.project.toLowerCase()] ?? targets[d.project] ?? 90;
      return d.passRate < target;
    });
    lines.push(`**Platforms below target:** ${below.map(d => d.project).join(', ')}`);
  }

  return lines.join('\n');
}

function buildPassRateChart(data: PassRateData[], targets: PassRateTargets): ChartConfig {
  return {
    type: 'stacked_bar',
    title: 'Pass Rate by Platform',
    labels: data.map(d => d.project),
    datasets: [
      { label: 'Passed', values: data.map(d => d.passed), color: COLORS.passed },
      { label: 'Failed', values: data.map(d => d.failed), color: COLORS.failed },
      { label: 'Skipped', values: data.map(d => d.skipped), color: COLORS.skipped },
      { label: 'Known Issue', values: data.map(d => d.knownIssue), color: COLORS.knownIssue },
      { label: 'Aborted', values: data.map(d => d.aborted), color: COLORS.aborted },
    ].filter(ds => ds.values.some(v => v > 0)),
    width: 800,
    height: 400,
  };
}
