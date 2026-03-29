/**
 * Release Readiness Assessment Report.
 *
 * Evaluates readiness criteria for specified platforms and produces
 * a Go / No-Go recommendation with supporting evidence.
 *
 * Checks:
 * 1. Pass rate vs target
 * 2. Unresolved failures (failed - known issues)
 * 3. Runtime efficiency (delta vs previous milestone)
 * 4. Automation coverage %
 * 5. Top defect patterns
 */

import {
  type ReportContext,
  type ReportInput,
  type ReportOutput,
  type PassRateData,
  type RuntimeData,
  type CoverageData,
  type BugsData,
  type PassRateTargets,
  type ProjectContext,
  DEFAULT_TARGETS,
} from "./types.js";

type CheckStatus = 'PASS' | 'FAIL' | 'WARN';

interface ReadinessCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface PlatformReadiness {
  platform: string;
  checks: ReadinessCheck[];
  recommendation: 'GO' | 'NO-GO' | 'CONDITIONAL';
  summary: string;
}

export async function generateReleaseReadinessReport(
  ctx: ReportContext,
  input: ReportInput,
): Promise<ReportOutput> {
  const { projects, period, milestone, previous_milestone, targets } = input;
  const mergedTargets: PassRateTargets = { ...DEFAULT_TARGETS, ...(targets ?? {}) };

  const projectContexts = await ctx.resolveProjects(projects);

  const assessments: PlatformReadiness[] = [];

  for (const pCtx of projectContexts) {
    const assessment = await assessPlatform(ctx, pCtx, period, milestone, previous_milestone, mergedTargets);
    assessments.push(assessment);
  }

  const markdown = buildReadinessMarkdown(assessments, milestone);
  return { content: [{ type: "text" as const, text: markdown }] };
}

async function assessPlatform(
  ctx: ReportContext,
  pCtx: ProjectContext,
  period: string,
  milestone: string | undefined,
  previousMilestone: string | undefined,
  targets: PassRateTargets,
): Promise<PlatformReadiness> {
  const checks: ReadinessCheck[] = [];

  // 1. Pass Rate
  let passRate: PassRateData | null = null;
  try {
    passRate = await ctx.fetchPassRate(pCtx, period, milestone);
    const target = targets[pCtx.alias.toLowerCase()] ?? targets[pCtx.alias] ?? 90;
    if (passRate.passRate >= target) {
      checks.push({ name: 'Pass Rate', status: 'PASS', detail: `${passRate.passRate}% (target: ${target}%)` });
    } else if (passRate.passRateExclKnown >= target) {
      checks.push({ name: 'Pass Rate', status: 'WARN', detail: `${passRate.passRate}% raw (${passRate.passRateExclKnown}% excl. known issues) — target: ${target}%` });
    } else {
      checks.push({ name: 'Pass Rate', status: 'FAIL', detail: `${passRate.passRate}% (target: ${target}%)` });
    }
  } catch {
    checks.push({ name: 'Pass Rate', status: 'WARN', detail: 'Unable to fetch pass rate data' });
  }

  // 2. Unresolved Failures
  if (passRate) {
    const unresolvedFailures = passRate.failed - passRate.knownIssue;
    if (unresolvedFailures <= 0) {
      checks.push({ name: 'Unresolved Failures', status: 'PASS', detail: `All ${passRate.failed} failures have linked issues` });
    } else if (unresolvedFailures <= 5) {
      checks.push({ name: 'Unresolved Failures', status: 'WARN', detail: `${unresolvedFailures} failures without linked issues (${passRate.failed} total, ${passRate.knownIssue} with issues)` });
    } else {
      checks.push({ name: 'Unresolved Failures', status: 'FAIL', detail: `${unresolvedFailures} failures without linked issues` });
    }
  }

  // 3. Runtime Efficiency
  try {
    const currentRuntime = await ctx.fetchRuntime(pCtx, milestone);
    if (previousMilestone) {
      const previousRuntime = await ctx.fetchRuntime(pCtx, previousMilestone);
      if (previousRuntime.avgRuntimePerTest > 0 && currentRuntime.avgRuntimePerTest > 0) {
        const delta = ((currentRuntime.avgRuntimePerTest - previousRuntime.avgRuntimePerTest) / previousRuntime.avgRuntimePerTest) * 100;
        const rounded = Math.round(delta * 10) / 10;
        if (rounded <= 10) {
          checks.push({ name: 'Runtime Efficiency', status: 'PASS', detail: `Avg/test: ${ctx.fmtSeconds(currentRuntime.avgRuntimePerTest)} (delta: ${rounded > 0 ? '+' : ''}${rounded}%)` });
        } else if (rounded <= 20) {
          checks.push({ name: 'Runtime Efficiency', status: 'WARN', detail: `Avg/test increased by ${rounded}% vs previous milestone` });
        } else {
          checks.push({ name: 'Runtime Efficiency', status: 'FAIL', detail: `Avg/test degraded by ${rounded}% vs previous milestone` });
        }
      } else {
        checks.push({ name: 'Runtime Efficiency', status: 'PASS', detail: `Avg/test: ${ctx.fmtSeconds(currentRuntime.avgRuntimePerTest)}` });
      }
    } else {
      checks.push({ name: 'Runtime Efficiency', status: 'PASS', detail: `Avg/test: ${ctx.fmtSeconds(currentRuntime.avgRuntimePerTest)} (no baseline for comparison)` });
    }
  } catch {
    checks.push({ name: 'Runtime Efficiency', status: 'WARN', detail: 'Unable to fetch runtime data' });
  }

  // 4. Automation Coverage
  try {
    const coverage = await ctx.fetchCoverage(pCtx);
    const pct = coverage.total > 0 ? Math.round((coverage.automated / coverage.total) * 1000) / 10 : 0;
    if (pct >= 70) {
      checks.push({ name: 'Automation Coverage', status: 'PASS', detail: `${pct}% automated (${coverage.automated}/${coverage.total})` });
    } else if (pct >= 50) {
      checks.push({ name: 'Automation Coverage', status: 'WARN', detail: `${pct}% automated — consider increasing coverage` });
    } else {
      checks.push({ name: 'Automation Coverage', status: 'FAIL', detail: `Only ${pct}% automated (${coverage.automated}/${coverage.total})` });
    }
  } catch {
    checks.push({ name: 'Automation Coverage', status: 'WARN', detail: 'Unable to fetch coverage data' });
  }

  // 5. Top Defects
  try {
    const bugs = await ctx.fetchBugs(pCtx, period, 5, milestone);
    if (bugs.bugs.length === 0) {
      checks.push({ name: 'Top Defects', status: 'PASS', detail: 'No recurring defects found' });
    } else {
      const topBug = bugs.bugs[0];
      const detail = `${bugs.bugs.length} recurring defects — top: ${topBug.key} (${topBug.failures} failures, ${topBug.percentage}% repro rate)`;
      checks.push({ name: 'Top Defects', status: bugs.bugs.length > 3 ? 'WARN' : 'PASS', detail });
    }
  } catch {
    checks.push({ name: 'Top Defects', status: 'WARN', detail: 'Unable to fetch defect data' });
  }

  // Recommendation
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const warnCount = checks.filter(c => c.status === 'WARN').length;

  let recommendation: 'GO' | 'NO-GO' | 'CONDITIONAL';
  let summary: string;

  if (failCount > 0) {
    recommendation = 'NO-GO';
    summary = `${failCount} check(s) failed. Release not recommended.`;
  } else if (warnCount > 1) {
    recommendation = 'CONDITIONAL';
    summary = `${warnCount} warnings detected. Release possible with caveats.`;
  } else {
    recommendation = 'GO';
    summary = 'All checks passed. Release is recommended.';
  }

  return { platform: pCtx.alias, checks, recommendation, summary };
}

function buildReadinessMarkdown(assessments: PlatformReadiness[], milestone?: string): string {
  const lines: string[] = [];
  lines.push('# Release Readiness Assessment');
  if (milestone) lines.push(`**Milestone:** ${milestone}`);
  lines.push('');

  for (const a of assessments) {
    const recIcon = a.recommendation === 'GO' ? '✅' : a.recommendation === 'CONDITIONAL' ? '⚠️' : '🛑';
    lines.push(`## ${a.platform} — ${recIcon} ${a.recommendation}`);
    lines.push(`> ${a.summary}`);
    lines.push('');

    lines.push('| Check | Status | Detail |');
    lines.push('| --- | :---: | --- |');
    for (const c of a.checks) {
      const icon = c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌';
      lines.push(`| ${c.name} | ${icon} ${c.status} | ${c.detail} |`);
    }
    lines.push('');
  }

  // Overall recommendation
  const allGo = assessments.every(a => a.recommendation === 'GO');
  const anyNoGo = assessments.some(a => a.recommendation === 'NO-GO');

  lines.push('## Overall Recommendation');
  if (allGo) {
    lines.push('**✅ GO** — All platforms pass readiness criteria.');
  } else if (anyNoGo) {
    const failed = assessments.filter(a => a.recommendation === 'NO-GO').map(a => a.platform);
    lines.push(`**🛑 NO-GO** — Platform(s) not ready: ${failed.join(', ')}`);
  } else {
    lines.push('**⚠️ CONDITIONAL** — Release possible with known caveats. Review warnings above.');
  }

  return lines.join('\n');
}
