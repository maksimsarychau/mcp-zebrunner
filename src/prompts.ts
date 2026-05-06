/**
 * MCP Prompts for Zebrunner MCP Server.
 *
 * Provides pre-built, tested workflow instructions triggered via '/' commands:
 * - E2E metric prompts (multi-tool orchestration from docs/TEST_PROMPTS.md)
 * - Analysis prompts (single-tool workflows with expert instructions)
 *
 * Prompts are user-controlled — the user selects them, and the text is
 * injected into the conversation to guide the LLM through the workflow.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Prompt text builders (exported for unit testing) ─────────────────────────

export function buildPassRatePrompt(projects: string): string {
  return `Collect Pass Rate metrics for these platforms: ${projects}.

For each platform, for the latest milestone:
- Total Executed Tests
- Passed Tests
- Failed Tests
- Pass Rate = (Passed / Total) × 100
- Pass Rate excluding known issues (if available)

Targets:
- Android >= 90%
- iOS >= 90%
- Web >= 65% (>= 95% excluding known issues)

Steps:
1. Use get_all_launches_with_filter to find launches by latest milestone for each platform
2. Use get_launch_test_summary for each launch to collect pass/fail/known-issue counts
3. Calculate pass rates with and without known issues
4. Compare against targets

Present results in a comparison table with status indicators (on target / below target).`;
}

export function buildRuntimeEfficiencyPrompt(projects: string): string {
  return `Collect Regression Runtime Efficiency metrics for these platforms: ${projects}.

For the latest milestone and the previous milestone, collect:
- Total execution time (wall-clock)
- Number of executed tests
- Number of test cases covered
- Average Runtime per Test
- Average Runtime per Test Case
- WRI and WRI per Test Case
- Duration distribution: how many tests/test cases in Short (<5min), Medium (5-10min), Long (>=10min)
- Delta vs previous milestone (%)

Flag any suite where long-running tests degraded by more than 20%.

Steps:
1. Use analyze_regression_runtime for each platform with previous_milestone for baseline comparison
2. Aggregate and compare metrics

Present results as a cross-platform comparison with trend indicators.`;
}

export function buildAutomationCoveragePrompt(projects: string): string {
  return `Collect Automation Coverage metrics for these platforms: ${projects}.

For each platform:
1. Total test cases in the TCM system
2. Total automated test cases (automation state = "Automated")
3. Baseline Coverage = (Automated / Total) x 100
4. Coverage excluding "Manual only" and "Deprecated" test cases
5. Test cases added in the last 30 days (new test cases)
6. Of those new test cases, how many are automated?
7. Automation Intake Rate = (New Automated / New Total) x 100

Steps:
1. Use get_automation_states to discover state IDs for each platform
2. Use get_test_cases_by_automation_state with get_all: true, count_only: true for efficient counts per state
3. For total excluding deprecated/draft: use get_all_tcm_test_cases_by_project with exclude_deprecated: true, count_only: true
4. For 30-day window: use get_test_case_by_filter with created_after (30 days ago), get_all: true, count_only: true

Present results with both "with manual/deprecated" and "without manual/deprecated" perspectives.
Track coverage trend: is the automation intake rate keeping up with new test case creation?`;
}

export function buildExecutiveDashboardPrompt(projects: string): string {
  return `Generate an executive QA dashboard for these platforms: ${projects} — on the latest milestone.

Include these 5 sections:
1. Pass Rate — per platform with target comparison (Android/iOS >= 90%, Web >= 65%)
2. Regression Runtime — average runtime per test, WRI, delta vs previous milestone
3. Top 5 Bugs — most frequent defects per platform with Jira links
4. Test Case Coverage — automation coverage rate per platform
5. Flaky Tests — any tests that flip-flopped pass/fail in the latest launch

Steps:
1. Use get_launch_test_summary for pass rate data per platform
2. Use analyze_regression_runtime for runtime metrics per platform
3. Use get_top_bugs for defect patterns per platform
4. Use get_automation_states + get_test_cases_by_automation_state with count_only: true for coverage
5. Use find_flaky_tests for flaky test detection

Present as a single structured report suitable for a weekly standup.`;
}

export function buildReleaseReadinessPrompt(project: string, milestone?: string): string {
  const milestoneClause = milestone ? ` for milestone ${milestone}` : " for the latest milestone";
  return `Assess release readiness for the ${project} platform${milestoneClause}.

Check these 5 areas:
1. Pass rate — is it above 90%?
2. Are there any test failures without linked Jira issues? (unresolved blockers)
3. Runtime efficiency — has average runtime per test increased vs previous milestone?
4. Coverage — what % of test cases are automated?
5. Top defects — what are the most common failure patterns?

Steps:
1. Use get_all_launches_with_filter + get_launch_test_summary for pass rate
2. Use detailed_analyze_launch_failures with filterType "without_issues" for unlinked failures
3. Use analyze_regression_runtime with previous milestone for runtime delta
4. Use get_test_cases_by_automation_state with count_only: true for coverage percentage
5. Use get_top_bugs for defect patterns

Provide a Go / No-Go recommendation with supporting evidence for each check.`;
}

export function buildSuiteCoveragePrompt(projects: string): string {
  return `Build a test coverage table for these platforms: ${projects}.

For each platform:
1. Get all test suites
2. Get automation states to check if "Manual Only" is an automation state
3. For each suite, collect counts using count_only: true, get_all: true:
   - Implemented: automation state = "Automated"
   - Manual Only:
     * If "Manual Only" automation state exists: use get_test_cases_by_automation_state
     * Otherwise: use get_test_cases_advanced with field_path "customField.manualOnly", field_value "Yes", field_match "exact"
   - Deprecated: filter deprecated = true
   - Total: all test cases in the suite
   - Coverage % = Implemented / (Total - Manual Only - Deprecated) x 100

Present one table per platform:
| Suite Name | Implemented | Manual Only | Deprecated | Total | Coverage % |

For each platform add:
- TOTAL row: sum all suites
- TOTAL REGRESSION row: sum only regression suites (exclude suites like MA, Minimal Acceptance, Critical, Performance, or any non-regression suite)

Note: "Manual Only" may exist as an automation state on some projects and as a custom field on others. Check automation states first.`;
}

export function buildReviewTestCasePrompt(caseKey: string): string {
  return `Review and improve test case ${caseKey}. Follow these steps:

1. Use get_test_case_by_key to fetch the full test case details including suite hierarchy and custom fields with display names
2. Use validate_test_case to check against quality standards and best practices
3. Analyze the validation results and identify improvement areas
4. Use improve_test_case to generate specific improvement suggestions

Provide a structured report with:
- Current quality score and validation results
- Specific issues found (missing steps, vague language, etc.)
- Actionable improvement suggestions with priority
- If high-confidence fixes are available, list them for user approval`;
}

export function buildLaunchTriagePrompt(project: string): string {
  return `Perform post-regression failure triage for the ${project} platform.

Steps:
1. Use get_all_launches_with_filter for ${project} to find the latest launch
2. Use get_launch_test_summary to get overall pass/fail statistics
3. Use detailed_analyze_launch_failures with filterType "without_issues" to find failures without linked Jira issues
4. For the top 3-5 most impactful failures, use analyze_test_failure to get root cause analysis

Present a structured triage report with:
- Launch summary (pass rate, total tests, duration)
- Failures needing attention (no linked Jira issues)
- Root cause analysis for top failures
- Recommended actions (link to existing bugs, create new tickets, mark as known issues)`;
}

export function buildFlakyReviewPrompt(project: string): string {
  return `Find and analyze flaky tests in the ${project} platform.

Steps:
1. Use find_flaky_tests for ${project} with period_days: 30, include_history: true
2. For the top flaky tests (highest flip count), review their execution history
3. Use get_test_execution_history for the worst offenders to understand the pattern

Present a structured report with:
- Total flaky tests found and severity distribution
- Top 10 flakiest tests with flip counts and pass rates
- Execution history timeline for worst offenders
- Recommendations: which tests to stabilize first, potential root causes`;
}

export function buildFindDuplicatesPrompt(project: string, suiteId?: string): string {
  const scopeClause = suiteId
    ? `in suite ${suiteId} of the ${project} project`
    : `in the ${project} project`;
  return `Analyze test cases for duplicates ${scopeClause}.

Steps:
1. Use analyze_test_cases_duplicates with similarity_threshold: 80 to find structurally similar test cases
2. If structural analysis finds potential duplicates, optionally use analyze_test_cases_duplicates_semantic for deeper analysis
3. Review the duplicate groups

Present a structured report with:
- Number of potential duplicate groups found
- For each group: test case keys, similarity score, and which steps overlap
- Recommendations: which test cases to merge, retire, or differentiate`;
}

// ── Role-specific prompt builders ────────────────────────────────────────────

export function buildDailyQaStandupPrompt(projects: string): string {
  return `Prepare a daily QA standup summary for these platforms: ${projects}.

Collect and present concisely:
1. Latest launch results per platform (pass rate, total tests, new failures)
2. Any test failures without linked Jira issues (unresolved blockers)
3. Flaky tests detected in the last 7 days
4. Runtime trend: any degradation vs previous run?

Steps:
1. Use get_all_launches_with_filter for each platform to find the most recent launch
2. Use get_launch_test_summary for pass/fail breakdown
3. Use detailed_analyze_launch_failures with filterType "without_issues" if there are failures
4. Use find_flaky_tests with period_days: 7 for recent flaky tests

Present as a concise daily standup update:
- Platform | Pass Rate | New Failures | Blockers
- Action items for the team`;
}

export function buildAutomationGapsPrompt(projects: string): string {
  return `Identify automation gaps across these platforms: ${projects}.

For each platform, analyze:
1. Overall automation coverage (automated vs total test cases)
2. Suites with lowest automation coverage
3. Recently created test cases that are not yet automated
4. Manual-only test cases that could be automated

Steps:
1. Use get_automation_states to discover state IDs
2. Use get_test_cases_by_automation_state with count_only: true for per-state counts
3. Use list_test_suites to get all suites
4. For the 5 largest suites, check automation coverage per suite
5. Use get_test_case_by_filter with created_after (30 days ago), count_only: true for recent manual test cases

Present a prioritized list of automation gaps:
- Suites needing the most automation work
- Recently added manual test cases (candidates for automation)
- Overall automation health score per platform`;
}

export function buildProjectOverviewPrompt(project: string): string {
  return `Generate a comprehensive overview of the ${project} project.

Collect:
1. Project metadata (key, name, ID)
2. Test suite structure (root suites and their counts)
3. Automation coverage (total TCs, automated, manual, deprecated)
4. Recent launch activity (last 5 launches with pass rates)
5. Active milestones
6. Configured priorities and automation states
7. Recent flaky tests (last 14 days)

Steps:
1. Use get_available_projects to confirm project exists
2. Use list_test_suites for suite overview
3. Use get_automation_states + get_test_cases_by_automation_state with count_only: true for coverage
4. Use get_all_launches_for_project with limit: 5 for recent launches
5. Use get_project_milestones for active milestones
6. Use get_automation_priorities for priority levels
7. Use find_flaky_tests with period_days: 14, count_only: true for flaky test count

Present as a structured project health card suitable for onboarding or project review.`;
}

export function buildSessionMetricsPrompt(): string {
  return `Show current MCP session tool usage metrics and performance stats.

Steps:
1. Call about_mcp_tools with mode "metrics" to retrieve server-side session metrics
2. Present the results as a clear summary including:
   - Total tool calls made in this session
   - Per-tool breakdown: call count, avg/min/max duration, response size, errors
   - Highlight any tools with errors or unusually high durations
3. If no tools have been called yet, report that the session has no recorded calls

This is useful for understanding which tools were used, how they performed, and whether any errors occurred during the current MCP session.`;
}

// ── Prompt catalog (used by about_mcp_tools) ────────────────────────────────

export type PromptMeta = {
  name: string;
  title: string;
  description: string;
  category: string;
  args: string[];
};

export function getPromptsCatalog(): PromptMeta[] {
  return [
    { name: "pass-rate", title: "Pass Rate Metrics", description: "Collect pass rate metrics across platforms with target comparison (multi-tool orchestration)", category: "E2E Metrics", args: ["projects"] },
    { name: "runtime-efficiency", title: "Runtime Efficiency Metrics", description: "Collect regression runtime efficiency metrics with delta comparison across platforms", category: "E2E Metrics", args: ["projects"] },
    { name: "automation-coverage", title: "Automation Coverage Metrics", description: "Collect automation coverage and intake rate metrics across platforms", category: "E2E Metrics", args: ["projects"] },
    { name: "executive-dashboard", title: "Executive QA Dashboard", description: "Generate a standup-ready executive dashboard with pass rate, runtime, bugs, coverage, and flaky tests", category: "E2E Metrics", args: ["projects"] },
    { name: "release-readiness", title: "Release Readiness Assessment", description: "Assess release readiness with Go/No-Go recommendation based on 5 quality checks", category: "E2E Metrics", args: ["project", "milestone?"] },
    { name: "suite-coverage", title: "Suite Coverage Table", description: "Build per-suite automation coverage table across platforms with TOTAL and TOTAL REGRESSION rows", category: "E2E Metrics", args: ["projects"] },
    { name: "review-test-case", title: "Review Test Case", description: "Validate and improve a test case against quality standards with actionable suggestions", category: "Analysis", args: ["case_key"] },
    { name: "launch-triage", title: "Launch Failure Triage", description: "Post-regression failure analysis: find unlinked failures, analyze root causes, recommend actions", category: "Analysis", args: ["project"] },
    { name: "flaky-review", title: "Flaky Test Review", description: "Find flaky tests, analyze execution history, and recommend stabilization priorities", category: "Analysis", args: ["project"] },
    { name: "find-duplicates", title: "Find Duplicate Test Cases", description: "Analyze test cases for duplicates using structural and optional semantic analysis", category: "Analysis", args: ["project", "suite_id?"] },
    { name: "daily-qa-standup", title: "Daily QA Standup", description: "Prepare a concise daily QA standup summary with pass rates, blockers, flaky tests, and action items", category: "Role-Specific", args: ["projects"] },
    { name: "automation-gaps", title: "Automation Gaps Analysis", description: "Identify suites and test cases with lowest automation coverage and prioritize automation work", category: "Role-Specific", args: ["projects"] },
    { name: "project-overview", title: "Project Overview", description: "Comprehensive project health card: suites, coverage, recent launches, milestones, flaky tests", category: "Role-Specific", args: ["project"] },
    { name: "session-metrics", title: "Session Metrics", description: "Show tool usage metrics for the current MCP session: call counts, durations, errors", category: "Utility", args: [] },
  ];
}

// ── Prompt registration ──────────────────────────────────────────────────────

export function registerPrompts(server: McpServer): void {

  // ── E2E Metric Prompts ───────────────────────────────────────────────────

  server.registerPrompt(
    "pass-rate",
    {
      title: "Pass Rate Metrics",
      description: "Collect pass rate metrics across platforms with target comparison (multi-tool orchestration)",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildPassRatePrompt(projects) },
      }],
    }),
  );

  server.registerPrompt(
    "runtime-efficiency",
    {
      title: "Runtime Efficiency Metrics",
      description: "Collect regression runtime efficiency metrics with delta comparison across platforms",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildRuntimeEfficiencyPrompt(projects) },
      }],
    }),
  );

  server.registerPrompt(
    "automation-coverage",
    {
      title: "Automation Coverage Metrics",
      description: "Collect automation coverage and intake rate metrics across platforms",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildAutomationCoveragePrompt(projects) },
      }],
    }),
  );

  server.registerPrompt(
    "executive-dashboard",
    {
      title: "Executive QA Dashboard",
      description: "Generate a standup-ready executive dashboard with pass rate, runtime, bugs, coverage, and flaky tests",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildExecutiveDashboardPrompt(projects) },
      }],
    }),
  );

  server.registerPrompt(
    "release-readiness",
    {
      title: "Release Readiness Assessment",
      description: "Assess release readiness with Go/No-Go recommendation based on 5 quality checks",
      argsSchema: {
        project: z.string().describe("Platform/project key, e.g. 'android'"),
        milestone: z.string().optional().describe("Milestone to assess, e.g. '25.40.0'. Defaults to latest."),
      },
    },
    async ({ project, milestone }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildReleaseReadinessPrompt(project, milestone) },
      }],
    }),
  );

  server.registerPrompt(
    "suite-coverage",
    {
      title: "Suite Coverage Table",
      description: "Build per-suite automation coverage table across platforms with TOTAL and TOTAL REGRESSION rows",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildSuiteCoveragePrompt(projects) },
      }],
    }),
  );

  // ── Analysis Prompts ─────────────────────────────────────────────────────

  server.registerPrompt(
    "review-test-case",
    {
      title: "Review Test Case",
      description: "Validate and improve a test case against quality standards with actionable suggestions",
      argsSchema: {
        case_key: z.string().describe("Test case key, e.g. 'MCP-5' or 'ANDROID-100'"),
      },
    },
    async ({ case_key }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildReviewTestCasePrompt(case_key) },
      }],
    }),
  );

  server.registerPrompt(
    "launch-triage",
    {
      title: "Launch Failure Triage",
      description: "Post-regression failure analysis: find unlinked failures, analyze root causes, recommend actions",
      argsSchema: {
        project: z.string().describe("Platform/project key, e.g. 'android'"),
      },
    },
    async ({ project }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildLaunchTriagePrompt(project) },
      }],
    }),
  );

  server.registerPrompt(
    "flaky-review",
    {
      title: "Flaky Test Review",
      description: "Find flaky tests, analyze execution history, and recommend stabilization priorities",
      argsSchema: {
        project: z.string().describe("Platform/project key, e.g. 'android'"),
      },
    },
    async ({ project }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildFlakyReviewPrompt(project) },
      }],
    }),
  );

  server.registerPrompt(
    "find-duplicates",
    {
      title: "Find Duplicate Test Cases",
      description: "Analyze test cases for duplicates using structural and optional semantic analysis",
      argsSchema: {
        project: z.string().describe("Platform/project key, e.g. 'android'"),
        suite_id: z.string().optional().describe("Optional suite ID to scope the analysis"),
      },
    },
    async ({ project, suite_id }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildFindDuplicatesPrompt(project, suite_id) },
      }],
    }),
  );

  // ── Role-Specific Prompts ────────────────────────────────────────────────

  server.registerPrompt(
    "daily-qa-standup",
    {
      title: "Daily QA Standup",
      description: "Prepare a concise daily QA standup summary with pass rates, blockers, flaky tests, and action items",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildDailyQaStandupPrompt(projects) },
      }],
    }),
  );

  server.registerPrompt(
    "automation-gaps",
    {
      title: "Automation Gaps Analysis",
      description: "Identify suites and test cases with lowest automation coverage and prioritize automation work",
      argsSchema: {
        projects: z.string().describe("Comma-separated platforms, e.g. 'android,ios,web'"),
      },
    },
    async ({ projects }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildAutomationGapsPrompt(projects) },
      }],
    }),
  );

  server.registerPrompt(
    "project-overview",
    {
      title: "Project Overview",
      description: "Comprehensive project health card: suites, coverage, recent launches, milestones, flaky tests",
      argsSchema: {
        project: z.string().describe("Platform/project key, e.g. 'android'"),
      },
    },
    async ({ project }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildProjectOverviewPrompt(project) },
      }],
    }),
  );

  // ── Utility Prompts ─────────────────────────────────────────────────────

  server.registerPrompt(
    "session-metrics",
    {
      title: "Session Metrics",
      description: "Show tool usage metrics for the current MCP session: call counts, durations, errors",
    },
    async () => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildSessionMetricsPrompt() },
      }],
    }),
  );
}
