/**
 * Coverage Report.
 *
 * Builds a per-suite test coverage table for each platform showing:
 * Implemented (Automated), Manual Only, Deprecated, Total, Coverage %.
 * Includes TOTAL and TOTAL REGRESSION summary rows.
 */

import {
  type ReportContext,
  type ReportInput,
  type ReportOutput,
  type ProjectContext,
} from "./types.js";

interface SuiteCoverage {
  suiteName: string;
  suiteId: number;
  implemented: number;
  manualOnly: number;
  deprecated: number;
  total: number;
  coverage: number;
}

interface PlatformCoverage {
  platform: string;
  suites: SuiteCoverage[];
  totalRow: SuiteCoverage;
  regressionRow: SuiteCoverage;
}

const DEFAULT_EXCLUDE_PATTERNS = ['MA', 'Minimal Acceptance', 'Critical', 'Performance'];

const CONCURRENCY = 5;

export async function generateCoverageReport(
  ctx: ReportContext,
  input: ReportInput,
): Promise<ReportOutput> {
  const { projects, exclude_suite_patterns } = input;
  const excludePatterns = exclude_suite_patterns ?? DEFAULT_EXCLUDE_PATTERNS;

  const projectContexts = await ctx.resolveProjects(projects);

  const platformResults: PlatformCoverage[] = [];

  for (const pCtx of projectContexts) {
    try {
      const result = await buildPlatformCoverage(ctx, pCtx, excludePatterns);
      platformResults.push(result);
    } catch (error: any) {
      platformResults.push({
        platform: pCtx.alias,
        suites: [],
        totalRow: emptySuiteRow('TOTAL'),
        regressionRow: emptySuiteRow('TOTAL REGRESSION'),
      });
    }
  }

  const markdown = buildCoverageMarkdown(platformResults);
  return { content: [{ type: "text" as const, text: markdown }] };
}

async function buildPlatformCoverage(
  ctx: ReportContext,
  pCtx: ProjectContext,
  excludePatterns: string[],
): Promise<PlatformCoverage> {
  const states = await ctx.reportingClient.getAutomationStates(pCtx.projectId);
  const stateMap = new Map(states.map(s => [s.name.toLowerCase(), s.id]));
  const automatedId = stateMap.get('automated');
  const manualOnlyStateId = stateMap.get('manual only');

  const allSuites = await fetchAllSuites(ctx, pCtx.projectKey);
  const suites: SuiteCoverage[] = [];

  for (let i = 0; i < allSuites.length; i += CONCURRENCY) {
    const batch = allSuites.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(suite =>
        collectSuiteCoverage(ctx, pCtx, suite, automatedId, manualOnlyStateId),
      ),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') suites.push(r.value);
    }
  }

  suites.sort((a, b) => a.suiteName.localeCompare(b.suiteName));

  const totalRow = aggregateRows(suites, 'TOTAL');
  const regressionSuites = suites.filter(s =>
    !excludePatterns.some(p => s.suiteName.toLowerCase().includes(p.toLowerCase())),
  );
  const regressionRow = aggregateRows(regressionSuites, 'TOTAL REGRESSION');

  return { platform: pCtx.alias, suites, totalRow, regressionRow };
}

async function fetchAllSuites(
  ctx: ReportContext,
  projectKey: string,
): Promise<{ id: number; name: string }[]> {
  const result: { id: number; name: string }[] = [];
  let pageToken: string | undefined;
  let pageCount = 0;

  do {
    const response = await ctx.publicClient.getTestSuites(projectKey, {
      size: 100,
      pageToken,
    });
    for (const s of response.items || []) {
      result.push({ id: s.id, name: s.name });
    }
    pageToken = response._meta?.nextPageToken;
    pageCount++;
  } while (pageToken && pageCount < 100);

  return result;
}

async function collectSuiteCoverage(
  ctx: ReportContext,
  pCtx: ProjectContext,
  suite: { id: number; name: string },
  automatedId: number | undefined,
  manualOnlyStateId: number | undefined,
): Promise<SuiteCoverage> {
  const countByFilter = async (filter: string): Promise<number> => {
    try {
      const result = await ctx.publicClient.getTestCases(pCtx.projectKey, {
        filter,
        size: 1,
      });
      return (result._meta as any)?.total ?? result._meta?.totalElements ?? result.items?.length ?? 0;
    } catch {
      return 0;
    }
  };

  const totalP = countByFilter(`testSuite.id = ${suite.id}`);
  const implementedP = automatedId
    ? countByFilter(`automationState.id = ${automatedId} AND testSuite.id = ${suite.id}`)
    : Promise.resolve(0);
  const deprecatedP = countByFilter(`deprecated = true AND testSuite.id = ${suite.id}`);

  let manualOnlyP: Promise<number>;
  if (manualOnlyStateId) {
    manualOnlyP = countByFilter(`automationState.id = ${manualOnlyStateId} AND testSuite.id = ${suite.id}`);
  } else {
    manualOnlyP = countManualOnlyByCustomField(ctx, pCtx, suite.id);
  }

  const [total, implemented, manualOnly, deprecated] = await Promise.all([
    totalP, implementedP, manualOnlyP, deprecatedP,
  ]);

  const denominator = total - manualOnly - deprecated;
  const coverage = denominator > 0 ? Math.round((implemented / denominator) * 1000) / 10 : 0;

  return {
    suiteName: suite.name,
    suiteId: suite.id,
    implemented,
    manualOnly,
    deprecated,
    total,
    coverage,
  };
}

async function countManualOnlyByCustomField(
  ctx: ReportContext,
  pCtx: ProjectContext,
  suiteId: number,
): Promise<number> {
  let count = 0;
  let pageToken: string | undefined;
  let pages = 0;

  try {
    do {
      const result = await ctx.publicClient.getTestCases(pCtx.projectKey, {
        filter: `testSuite.id = ${suiteId}`,
        size: 100,
        pageToken,
      });

      for (const tc of result.items || []) {
        const cf = (tc as any).customField;
        if (!cf) continue;
        const key = Object.keys(cf).find(k => k.toLowerCase().replace(/[\s_]/g, '') === 'manualonly');
        if (key) {
          const val = cf[key];
          if (val === true || val === 'true' || val === 'True' || val === 'Yes' || val === 'yes') {
            count++;
          }
        }
      }

      pageToken = result._meta?.nextPageToken;
      pages++;
    } while (pageToken && pages < 50);
  } catch {
    // Safe fallback — return 0
  }

  return count;
}

function aggregateRows(suites: SuiteCoverage[], label: string): SuiteCoverage {
  const implemented = suites.reduce((s, r) => s + r.implemented, 0);
  const manualOnly = suites.reduce((s, r) => s + r.manualOnly, 0);
  const deprecated = suites.reduce((s, r) => s + r.deprecated, 0);
  const total = suites.reduce((s, r) => s + r.total, 0);
  const denominator = total - manualOnly - deprecated;
  const coverage = denominator > 0 ? Math.round((implemented / denominator) * 1000) / 10 : 0;

  return { suiteName: label, suiteId: 0, implemented, manualOnly, deprecated, total, coverage };
}

function emptySuiteRow(label: string): SuiteCoverage {
  return { suiteName: label, suiteId: 0, implemented: 0, manualOnly: 0, deprecated: 0, total: 0, coverage: 0 };
}

function buildCoverageMarkdown(platforms: PlatformCoverage[]): string {
  const lines: string[] = [];
  lines.push('# Test Coverage Report');
  lines.push('');

  for (const p of platforms) {
    lines.push(`## ${p.platform}`);
    lines.push('');

    if (p.suites.length === 0) {
      lines.push('No suite data available.');
      lines.push('');
      continue;
    }

    lines.push('| Suite Name | Implemented | Manual Only | Deprecated | Total | Coverage % |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');

    for (const s of p.suites) {
      lines.push(`| ${s.suiteName} | ${s.implemented} | ${s.manualOnly} | ${s.deprecated} | ${s.total} | ${s.coverage}% |`);
    }

    lines.push(`| **${p.totalRow.suiteName}** | **${p.totalRow.implemented}** | **${p.totalRow.manualOnly}** | **${p.totalRow.deprecated}** | **${p.totalRow.total}** | **${p.totalRow.coverage}%** |`);
    lines.push(`| **${p.regressionRow.suiteName}** | **${p.regressionRow.implemented}** | **${p.regressionRow.manualOnly}** | **${p.regressionRow.deprecated}** | **${p.regressionRow.total}** | **${p.regressionRow.coverage}%** |`);
    lines.push('');
  }

  return lines.join('\n');
}
