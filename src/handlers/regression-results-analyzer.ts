/**
 * Regression Results Analyzer — comprehensive execution summary
 * for a milestone and/or build number.
 *
 * Sections: overview, new_bugs, top_bugs, bugs_per_suite, slowest_tests.
 * Data sourced entirely from TCM Public API (test runs + test cases).
 */

import type { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import type { ZebrunnerReportingClient } from "../api/reporting-client.js";
import { sanitizeRqlString } from "../utils/security.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface RegressionAnalyzerInput {
  project: string | number;
  projectKey: string;
  projectId: number;
  milestone?: string;
  build?: string;
  previous_milestone?: string;
  previous_build?: string;
  sections: string[];
  top_bugs_limit: number;
  slowest_tests_limit: number;
  jira_base_url?: string;
  output_format: "jira" | "json" | "markdown" | "detailed";
  count_only: boolean;
  zebrunnerBaseUrl: string;
  max_test_duration_ms?: number;
  include_empty_suites: boolean;
}

interface RunSummary {
  id: number;
  title: string;
  url: string;
  passed: number;
  failed: number;
  skipped: number;
  untested: number;
  total: number;
  covered: boolean;
  uncoveredCount: number;
}

interface TestCaseResult {
  testCaseKey: string;
  testCaseTitle: string;
  statusName: string;
  issueId: string | null;
  issueType: string | null;
  executionTimeMs: number | null;
  runId: number;
  runTitle: string;
}

interface BugAggregation {
  issueId: string;
  issueType: string;
  count: number;
  percentage: number;
  affectedRuns: string[];
}

interface SlowestTest {
  testCaseKey: string;
  title: string;
  runTitle: string;
  durationMs: number;
}

interface BugsPerRun {
  runTitle: string;
  runId: number;
  totalFailuresLinked: number;
  uniqueBugs: number;
  bugs: Array<{ issueId: string; count: number }>;
}

interface NewBugInfo {
  issueId: string;
  sampleTestTitle: string;
}

interface AnalysisResult {
  header: string;
  milestoneUrl: string | null;
  resolvedMilestoneName: string | null;
  totalRuns: number;
  totalTestCases: number;
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  totalUntested: number;
  passRate: string;
  overview: RunSummary[];
  newBugs: NewBugInfo[];
  topBugs: BugAggregation[];
  bugsPerSuite: BugsPerRun[];
  slowestTests: SlowestTest[];
  totalFailuresWithIssues: number;
  uniqueBugsCount: number;
  timestamp: string;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

interface MilestoneRecord {
  id: number;
  name: string;
  startDate?: string;
}

export interface RegressionAnalyzerDeps {
  client: EnhancedZebrunnerClient;
  reportingClient: ZebrunnerReportingClient;
}

type MilestoneCache = Map<number, MilestoneRecord[]>;

// ── Main Entry ───────────────────────────────────────────────────────────────

export async function analyzeRegressionResults(
  deps: RegressionAnalyzerDeps,
  input: RegressionAnalyzerInput,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const timestamp = new Date().toISOString();
  const milestoneCache: MilestoneCache = new Map();
  return executeAnalysis(deps, input, timestamp, milestoneCache);
}

async function executeAnalysis(
  deps: RegressionAnalyzerDeps,
  input: RegressionAnalyzerInput,
  timestamp: string,
  cache: MilestoneCache,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { client, reportingClient } = deps;
  const {
    projectKey, projectId, milestone, build, previous_milestone, previous_build,
    sections, top_bugs_limit, slowest_tests_limit, jira_base_url,
    output_format, count_only, zebrunnerBaseUrl, max_test_duration_ms,
    include_empty_suites,
  } = input;

  if (!milestone && !build) {
    return errorResponse("At least one of 'milestone' or 'build' must be provided.");
  }

  // Resolve milestone name → ID
  let milestoneId: number | undefined;
  let resolvedMilestoneName: string | null = null;

  if (milestone) {
    const resolved = await resolveMilestoneByName(reportingClient, projectId, milestone, cache);
    if (!resolved) {
      return errorResponse(`Milestone '${milestone}' not found. Use get_project_milestones to see available milestones.`);
    }
    milestoneId = resolved.id;
    resolvedMilestoneName = resolved.name;
  }

  // Fetch all runs for current milestone/build
  const runs = await fetchAllTestRuns(client, projectKey, milestoneId, build);

  if (runs.length === 0) {
    const filterDesc = [
      milestone ? `milestone='${resolvedMilestoneName || milestone}'` : null,
      build ? `build='${build}'` : null,
    ].filter(Boolean).join(" AND ");
    return errorResponse(`No test runs found matching ${filterDesc}. Check milestone/build values.`);
  }

  // Build initial overview from executionSummaries (counts only, coverage computed after test cases fetch)
  const overviewInitial = buildOverviewCounts(runs, projectKey, zebrunnerBaseUrl);
  const totalTestCases = overviewInitial.reduce((sum, r) => sum + r.total, 0);

  if (count_only) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          total_runs: runs.length,
          total_test_cases: totalTestCases,
          project_key: projectKey,
          milestone: resolvedMilestoneName || milestone,
          build,
        }),
      }],
    };
  }

  // Fetch test cases for all runs in parallel batches
  const testCasesMap = await fetchAllTestCasesForRuns(client, projectKey, runs);

  // Compute per-run coverage status
  const overview = computeRunCoverage(overviewInitial, testCasesMap, runs);

  // Flatten into a single list with run context
  const allTestCases = flattenTestCases(testCasesMap, runs);

  // Compute sections
  const allIssueIds = new Set(
    allTestCases.filter(tc => tc.issueId).map(tc => tc.issueId!)
  );
  const totalFailuresWithIssues = allTestCases.filter(tc => tc.issueId).length;

  let topBugs: BugAggregation[] = [];
  if (sections.includes("top_bugs")) {
    topBugs = buildTopBugs(allTestCases, top_bugs_limit);
  }

  let bugsPerSuite: BugsPerRun[] = [];
  if (sections.includes("bugs_per_suite")) {
    bugsPerSuite = buildBugsPerSuite(allTestCases, runs, include_empty_suites);
  }

  let slowestTests: SlowestTest[] = [];
  if (sections.includes("slowest_tests")) {
    slowestTests = buildSlowestTests(allTestCases, slowest_tests_limit, max_test_duration_ms);
  }

  // Auto-detect previous milestone if not provided
  let effectivePrevMilestone = previous_milestone;
  if (sections.includes("new_bugs") && !effectivePrevMilestone && !previous_build && resolvedMilestoneName) {
    effectivePrevMilestone = await autoDetectPreviousMilestone(reportingClient, projectId, resolvedMilestoneName, cache);
  }

  let newBugs: NewBugInfo[] = [];
  if (sections.includes("new_bugs") && (effectivePrevMilestone || previous_build)) {
    newBugs = await detectNewBugs(
      deps, projectKey, projectId, allTestCases,
      effectivePrevMilestone, previous_build, cache,
    );
  }

  // Build milestone URL
  let milestoneUrl: string | null = null;
  if (resolvedMilestoneName) {
    milestoneUrl = `${zebrunnerBaseUrl}/projects/${projectKey}/automation-launches?page=1&milestone=${encodeURIComponent(resolvedMilestoneName)}`;
  }

  // Compute aggregated totals
  const totalPassed = overview.reduce((s, r) => s + r.passed, 0);
  const totalFailed = overview.reduce((s, r) => s + r.failed, 0);
  const totalSkipped = overview.reduce((s, r) => s + r.skipped, 0);
  const totalUntested = overview.reduce((s, r) => s + r.untested, 0);
  const executed = totalPassed + totalFailed;
  const passRate = executed > 0 ? ((totalPassed / executed) * 100).toFixed(1) : "N/A";

  const result: AnalysisResult = {
    header: buildHeader(projectKey, resolvedMilestoneName, build),
    milestoneUrl,
    resolvedMilestoneName,
    totalRuns: runs.length,
    totalTestCases,
    totalPassed,
    totalFailed,
    totalSkipped,
    totalUntested,
    passRate,
    overview,
    newBugs,
    topBugs,
    bugsPerSuite,
    slowestTests,
    totalFailuresWithIssues,
    uniqueBugsCount: allIssueIds.size,
    timestamp,
  };

  // Resolve JIRA URLs for output
  let jiraBaseResolved: string | null = null;
  try {
    jiraBaseResolved = await reportingClient.resolveJiraBaseUrl(projectId, jira_base_url);
  } catch { /* JIRA URL not available */ }

  const formatted = formatOutput(result, sections, output_format, jiraBaseResolved);

  return { content: [{ type: "text" as const, text: formatted }] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveMilestoneByName(
  reportingClient: ZebrunnerReportingClient,
  projectId: number,
  milestoneName: string,
  cache: MilestoneCache,
): Promise<{ id: number; name: string } | null> {
  const allMilestones = await fetchAllMilestones(reportingClient, projectId, cache);
  const match = allMilestones.find(
    (m) => m.name === milestoneName || m.name.startsWith(milestoneName),
  );
  return match ? { id: match.id, name: match.name } : null;
}

async function fetchAllMilestones(
  reportingClient: ZebrunnerReportingClient,
  projectId: number,
  cache: MilestoneCache,
): Promise<MilestoneRecord[]> {
  if (cache.has(projectId)) {
    return cache.get(projectId)!;
  }

  const allItems: MilestoneRecord[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const resp = await reportingClient.getMilestones(projectId, {
      page,
      pageSize: 100,
      completed: "all",
    });
    allItems.push(...(resp.items as MilestoneRecord[]));
    totalPages = resp._meta?.totalPages || 1;
    page++;
  } while (page <= totalPages);

  cache.set(projectId, allItems);
  return allItems;
}

async function autoDetectPreviousMilestone(
  reportingClient: ZebrunnerReportingClient,
  projectId: number,
  currentMilestoneName: string,
  cache: MilestoneCache,
): Promise<string | undefined> {
  const allMilestones = await fetchAllMilestones(reportingClient, projectId, cache);
  if (allMilestones.length < 2) return undefined;

  // Sort by startDate (descending), then by name (descending) as fallback
  const sorted = [...allMilestones].sort((a, b) => {
    if (a.startDate && b.startDate) {
      return b.startDate.localeCompare(a.startDate);
    }
    if (a.startDate && !b.startDate) return -1;
    if (!a.startDate && b.startDate) return 1;
    return b.name.localeCompare(a.name);
  });

  const currentIdx = sorted.findIndex(
    m => m.name === currentMilestoneName || m.name.startsWith(currentMilestoneName),
  );

  if (currentIdx < 0 || currentIdx >= sorted.length - 1) return undefined;

  return sorted[currentIdx + 1].name;
}

async function fetchAllTestRuns(
  client: EnhancedZebrunnerClient,
  projectKey: string,
  milestoneId?: number,
  build?: string,
): Promise<any[]> {
  const filters: string[] = [];

  if (milestoneId) {
    filters.push(`milestone.id = ${milestoneId}`);
  }
  if (build) {
    const sanitized = sanitizeRqlString(build);
    filters.push(`(configurations.optionName ~= '${sanitized}' OR title ~= '${sanitized}' OR description ~= '${sanitized}')`);
  }

  const filter = filters.length > 0 ? filters.join(" AND ") : undefined;
  const allRuns: any[] = [];
  let pageToken: string | undefined;

  do {
    const response = await client.listPublicTestRuns({
      projectKey,
      maxPageSize: 100,
      filter,
      sortBy: "createdAt",
      pageToken,
    });
    allRuns.push(...(response.items || []));
    pageToken = response._meta?.nextPageToken;
  } while (pageToken);

  return allRuns;
}

function buildOverviewCounts(runs: any[], projectKey: string, baseUrl: string): RunSummary[] {
  return runs.map((run) => {
    const summaries: any[] = run.executionSummaries || [];
    let passed = 0, failed = 0, skipped = 0, untested = 0;

    for (const s of summaries) {
      const name = (s.status?.name || "").toLowerCase();
      const count = s.testCasesCount || 0;
      if (name === "passed") passed += count;
      else if (name === "failed") failed += count;
      else if (name === "skipped") skipped += count;
      else if (name === "untested" || name === "not tested") untested += count;
    }

    return {
      id: run.id,
      title: run.title || `Run #${run.id}`,
      url: `${baseUrl}/projects/${projectKey}/test-runs/${run.id}`,
      passed,
      failed,
      skipped,
      untested,
      total: passed + failed + skipped + untested,
      covered: false,
      uncoveredCount: 0,
    };
  });
}

function computeRunCoverage(
  overview: RunSummary[],
  testCasesMap: Map<number, any[]>,
  runs: any[],
): RunSummary[] {
  const closedMap = new Map(runs.map(r => [r.id, r.closed === true]));

  return overview.map((run) => {
    const isClosed = closedMap.get(run.id) ?? false;
    const items = testCasesMap.get(run.id) || [];

    const failedWithoutIssue = items.filter(item => {
      const status = (item.result?.status?.name || "").toLowerCase();
      return status === "failed" && !item.result?.issue;
    });

    const uncoveredCount = failedWithoutIssue.length;
    const covered = isClosed && run.failed > 0 ? uncoveredCount === 0 : isClosed && run.failed === 0;

    return { ...run, covered, uncoveredCount };
  });
}

const PARALLEL_BATCH_SIZE = 5;
const PARALLEL_BATCH_SIZE_FAST = 10;

async function fetchAllTestCasesForRuns(
  client: EnhancedZebrunnerClient,
  projectKey: string,
  runs: Array<{ id: number }>,
  batchSize: number = PARALLEL_BATCH_SIZE,
): Promise<Map<number, any[]>> {
  const result = new Map<number, any[]>();

  for (let i = 0; i < runs.length; i += batchSize) {
    const batch = runs.slice(i, i + batchSize);
    const responses = await Promise.all(
      batch.map(async (run) => {
        try {
          const resp = await client.listPublicTestRunTestCases({
            testRunId: run.id,
            projectKey,
          });
          return { runId: run.id, items: resp.items || [] };
        } catch (err: any) {
          console.warn(`[regression-analyzer] Failed to fetch test cases for run ${run.id}: ${err?.message || err}`);
          return { runId: run.id, items: [] };
        }
      }),
    );

    for (const { runId, items } of responses) {
      result.set(runId, items);
    }
  }

  return result;
}

function flattenTestCases(
  testCasesMap: Map<number, any[]>,
  runs: any[],
): TestCaseResult[] {
  const results: TestCaseResult[] = [];
  const runTitleMap = new Map(runs.map((r) => [r.id, r.title || `Run #${r.id}`]));

  for (const [runId, items] of testCasesMap) {
    for (const item of items) {
      const tc = item.testCase || {};
      const result = item.result;

      results.push({
        testCaseKey: tc.key || "N/A",
        testCaseTitle: tc.title || "Unknown",
        statusName: result?.status?.name || "UNTESTED",
        issueId: result?.issue?.id || null,
        issueType: result?.issue?.type || null,
        executionTimeMs: result?.executionTimeInMillis ?? null,
        runId,
        runTitle: runTitleMap.get(runId) || `Run #${runId}`,
      });
    }
  }

  return results;
}

function buildTopBugs(allTestCases: TestCaseResult[], limit: number): BugAggregation[] {
  const bugCounts = new Map<string, { count: number; type: string; runs: Set<string> }>();

  for (const tc of allTestCases) {
    if (!tc.issueId) continue;
    const existing = bugCounts.get(tc.issueId);
    if (existing) {
      existing.count++;
      existing.runs.add(tc.runTitle);
    } else {
      bugCounts.set(tc.issueId, { count: 1, type: tc.issueType || "JIRA", runs: new Set([tc.runTitle]) });
    }
  }

  const totalWithIssues = allTestCases.filter(tc => tc.issueId).length;
  const sorted = [...bugCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit);

  return sorted.map(([issueId, data]) => ({
    issueId,
    issueType: data.type,
    count: data.count,
    percentage: totalWithIssues > 0 ? Math.round((data.count / totalWithIssues) * 10000) / 100 : 0,
    affectedRuns: [...data.runs],
  }));
}

function buildBugsPerSuite(allTestCases: TestCaseResult[], runs: any[], includeEmpty: boolean): BugsPerRun[] {
  const runOrder = runs.map((r) => r.id);
  const grouped = new Map<number, Map<string, number>>();

  for (const tc of allTestCases) {
    if (!tc.issueId) continue;
    if (!grouped.has(tc.runId)) grouped.set(tc.runId, new Map());
    const runBugs = grouped.get(tc.runId)!;
    runBugs.set(tc.issueId, (runBugs.get(tc.issueId) || 0) + 1);
  }

  const runTitleMap = new Map(runs.map((r) => [r.id, r.title || `Run #${r.id}`]));
  const results: BugsPerRun[] = [];

  for (const runId of runOrder) {
    const runBugs = grouped.get(runId);
    if (!runBugs || runBugs.size === 0) {
      if (includeEmpty) {
        results.push({
          runTitle: runTitleMap.get(runId) || `Run #${runId}`,
          runId,
          totalFailuresLinked: 0,
          uniqueBugs: 0,
          bugs: [],
        });
      }
      continue;
    }

    const bugs = [...runBugs.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([issueId, count]) => ({ issueId, count }));

    results.push({
      runTitle: runTitleMap.get(runId) || `Run #${runId}`,
      runId,
      totalFailuresLinked: bugs.reduce((sum, b) => sum + b.count, 0),
      uniqueBugs: bugs.length,
      bugs,
    });
  }

  return results;
}

function buildSlowestTests(allTestCases: TestCaseResult[], limit: number, maxDurationMs?: number): SlowestTest[] {
  let filtered = allTestCases.filter(tc => tc.executionTimeMs != null && tc.executionTimeMs > 0);

  if (maxDurationMs != null) {
    filtered = filtered.filter(tc => tc.executionTimeMs! <= maxDurationMs);
  }

  return filtered
    .sort((a, b) => (b.executionTimeMs || 0) - (a.executionTimeMs || 0))
    .slice(0, limit)
    .map(tc => ({
      testCaseKey: tc.testCaseKey,
      title: tc.testCaseTitle,
      runTitle: tc.runTitle,
      durationMs: tc.executionTimeMs!,
    }));
}

async function detectNewBugs(
  deps: RegressionAnalyzerDeps,
  projectKey: string,
  projectId: number,
  currentTestCases: TestCaseResult[],
  previousMilestone?: string,
  previousBuild?: string,
  cache?: MilestoneCache,
): Promise<NewBugInfo[]> {
  if (!previousMilestone && !previousBuild) return [];

  let prevMilestoneId: number | undefined;
  if (previousMilestone) {
    const resolved = await resolveMilestoneByName(deps.reportingClient, projectId, previousMilestone, cache || new Map());
    if (resolved) prevMilestoneId = resolved.id;
  }

  const prevRuns = await fetchAllTestRuns(deps.client, projectKey, prevMilestoneId, previousBuild);

  // Build current milestone maps: issueId -> set of testCaseKeys, and issueId -> sample title
  const currentIssueToTestCases = new Map<string, Set<string>>();
  const currentIssueToSampleTitle = new Map<string, string>();

  for (const tc of currentTestCases) {
    if (!tc.issueId) continue;
    if (!currentIssueToTestCases.has(tc.issueId)) {
      currentIssueToTestCases.set(tc.issueId, new Set());
    }
    currentIssueToTestCases.get(tc.issueId)!.add(tc.testCaseKey);
    if (!currentIssueToSampleTitle.has(tc.issueId)) {
      currentIssueToSampleTitle.set(tc.issueId, tc.testCaseTitle);
    }
  }

  if (prevRuns.length === 0) {
    return [...currentIssueToTestCases.keys()].map(issueId => ({
      issueId,
      sampleTestTitle: currentIssueToSampleTitle.get(issueId) || "Unknown",
    }));
  }

  // Use higher parallelism for previous milestone (read-only, less critical)
  const prevTestCasesMap = await fetchAllTestCasesForRuns(deps.client, projectKey, prevRuns, PARALLEL_BATCH_SIZE_FAST);

  // Build previous milestone maps: issueId -> set of testCaseKeys, testCaseKey -> status
  const prevIssueIds = new Set<string>();
  const prevIssueToTestCases = new Map<string, Set<string>>();
  const prevTestCaseStatus = new Map<string, string>();

  for (const [, items] of prevTestCasesMap) {
    for (const item of items) {
      const tc = item.testCase || {};
      const result = item.result;
      const key = tc.key;
      if (key) {
        prevTestCaseStatus.set(key, result?.status?.name || "UNTESTED");
      }
      const issueId = result?.issue?.id;
      if (issueId) {
        prevIssueIds.add(issueId);
        if (!prevIssueToTestCases.has(issueId)) {
          prevIssueToTestCases.set(issueId, new Set());
        }
        prevIssueToTestCases.get(issueId)!.add(key);
      }
    }
  }

  // A bug is "new" if:
  // 1. The issue ID did not exist in the previous milestone at all, OR
  // 2. The issue existed but is now linked to test cases that were passing/untested in previous milestone
  const newBugs: NewBugInfo[] = [];

  for (const [issueId, currentTcKeys] of currentIssueToTestCases) {
    if (!prevIssueIds.has(issueId)) {
      newBugs.push({
        issueId,
        sampleTestTitle: currentIssueToSampleTitle.get(issueId) || "Unknown",
      });
      continue;
    }

    const prevTcKeys = prevIssueToTestCases.get(issueId)!;

    // Check if there are newly affected test cases that were passing/untested before
    let hasNewlyAffected = false;
    for (const key of currentTcKeys) {
      if (prevTcKeys.has(key)) continue;
      const prevStatus = (prevTestCaseStatus.get(key) || "").toLowerCase();
      if (prevStatus === "passed" || prevStatus === "untested" || prevStatus === "not tested" || prevStatus === "") {
        hasNewlyAffected = true;
        break;
      }
    }

    if (hasNewlyAffected) {
      newBugs.push({
        issueId,
        sampleTestTitle: currentIssueToSampleTitle.get(issueId) || "Unknown",
      });
    }
  }

  return newBugs;
}

// ── Formatting ───────────────────────────────────────────────────────────────

function buildHeader(projectKey: string, milestoneName: string | null, build: string | undefined | null): string {
  const parts: string[] = [projectKey.toUpperCase()];
  if (milestoneName) parts.push(milestoneName);
  if (build) parts.push(build);
  return parts.join(": ");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
}

function formatOutput(
  result: AnalysisResult,
  sections: string[],
  format: string,
  jiraBase: string | null,
): string {
  if (format === "json") {
    return JSON.stringify(result);
  }

  const lines: string[] = [];
  const issueLink = (id: string) =>
    jiraBase ? `[${id}](${jiraBase}/browse/${id})` : id;

  // Header
  if (result.milestoneUrl && result.resolvedMilestoneName) {
    lines.push(`## ${result.header.replace(result.resolvedMilestoneName, `[${result.resolvedMilestoneName}](${result.milestoneUrl})`)}`);
  } else {
    lines.push(`## ${result.header}`);
  }
  lines.push("");

  // Summary section
  if (sections.includes("overview")) {
    lines.push("### Summary");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|---|---|`);
    lines.push(`| Total test runs | ${result.totalRuns} |`);
    lines.push(`| Total test cases | ${result.totalTestCases.toLocaleString()} |`);
    lines.push(`| Passed | ${result.totalPassed.toLocaleString()} |`);
    lines.push(`| Failed | ${result.totalFailed.toLocaleString()} |`);
    lines.push(`| Skipped | ${result.totalSkipped.toLocaleString()} |`);
    lines.push(`| Untested | ${result.totalUntested.toLocaleString()} |`);
    lines.push(`| **Pass rate (executed)** | **${result.passRate}%** |`);
    lines.push(`| Total failures linked to bugs | ${result.totalFailuresWithIssues} |`);
    lines.push(`| Unique bugs | ${result.uniqueBugsCount} |`);
    lines.push(`| New bugs vs previous milestone | **${result.newBugs.length}** |`);
    lines.push("");

    // Per-run overview
    lines.push("---");
    lines.push("");
    lines.push(`### TCM Test Runs`);
    lines.push("");
    for (let i = 0; i < result.overview.length; i++) {
      const run = result.overview[i];
      const statusIcon = run.covered
        ? " ✅"
        : (run.failed > 0 && run.uncoveredCount > 0 ? ` ⚠️ (${run.uncoveredCount} uncovered)` : "");
      lines.push(`${i + 1}. ${run.title}${statusIcon}`);
      lines.push(`   ${run.url}`);
      lines.push(`   (Passed: ${run.passed}, Skipped: ${run.skipped}, Untested: ${run.untested}, Failed: ${run.failed})`);
      lines.push("");
    }
  }

  // New Bugs
  if (sections.includes("new_bugs")) {
    lines.push("---");
    lines.push("");
    if (result.newBugs.length > 0) {
      lines.push(`### New Bugs (${result.newBugs.length})`);
      lines.push("");
      for (const bug of result.newBugs) {
        lines.push(`- ${issueLink(bug.issueId)} — affects: "${bug.sampleTestTitle}"`);
      }
    } else {
      lines.push("### New Bugs (0)");
      lines.push("");
      lines.push("No new bugs detected compared to the previous milestone.");
    }
    lines.push("");
  }

  // Top Bugs
  if (sections.includes("top_bugs")) {
    lines.push("---");
    lines.push("");
    lines.push(`### Top ${result.topBugs.length} Bugs (${result.totalFailuresWithIssues} total failures linked to ${result.uniqueBugsCount} unique bugs)`);
    lines.push("");
    for (let i = 0; i < result.topBugs.length; i++) {
      const bug = result.topBugs[i];
      lines.push(`${i + 1}. ${issueLink(bug.issueId)} — ${bug.count} of ${result.totalFailuresWithIssues} (${bug.percentage}%)`);
    }
    lines.push("");
  }

  // Bugs Per Suite
  if (sections.includes("bugs_per_suite")) {
    lines.push("---");
    lines.push("");
    lines.push("### Known Issues Per Suite");
    lines.push("");
    for (const suite of result.bugsPerSuite) {
      if (suite.bugs.length === 0) {
        lines.push(`**${suite.runTitle}** — No known issues`);
      } else {
        lines.push(`**${suite.runTitle}** — ${suite.totalFailuresLinked} failures linked to ${suite.uniqueBugs} bugs`);
        for (const bug of suite.bugs) {
          const countText = bug.count > 1 ? ` (${bug.count} tests)` : "";
          lines.push(`- ${issueLink(bug.issueId)}${countText}`);
        }
      }
      lines.push("");
    }
  }

  // Slowest Tests
  if (sections.includes("slowest_tests")) {
    lines.push("---");
    lines.push("");
    lines.push(`### Top ${result.slowestTests.length} Slowest Tests`);
    lines.push("> Durations are as recorded in TCM (may include idle/setup time for manual runs)");
    lines.push("");
    for (let i = 0; i < result.slowestTests.length; i++) {
      const test = result.slowestTests[i];
      lines.push(`${i + 1}. ${test.testCaseKey}: "${test.title}" — ${formatDuration(test.durationMs)} (in ${test.runTitle})`);
    }
    lines.push("");
  }

  // Timestamp footer
  lines.push("---");
  lines.push(`> Data reflects live TCM state as of ${result.timestamp}`);

  return lines.join("\n");
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `❌ ${message}` }],
  };
}
