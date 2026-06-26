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
import { getConfig } from "./utils/config-loader.js";
import type { LocaleTestRunRulesSettings } from "./utils/locale-test-run-rules.js";
import { LOCALE_TEST_RUN_RULES_TOOL_NOTE } from "./utils/locale-test-run-rules.js";
import type { RelaunchFailuresSettings } from "./utils/relaunch-failures-config.js";
import {
  formatLaunchExcludeCheckDescription,
  formatLaunchExcludeRegexHint,
  formatSkippedLaunchesTableLabel,
  formatLaunchExcludePatternsList,
} from "./utils/relaunch-failures-config.js";

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

export function buildRegressionSummaryPrompt(project: string, milestone?: string, build?: string, previous_milestone?: string): string {
  const filterParts: string[] = [];
  if (milestone) filterParts.push(`milestone: "${milestone}"`);
  if (build) filterParts.push(`build: "${build}"`);
  const filterDesc = filterParts.join(", ") || "the latest available";

  const prevClause = previous_milestone
    ? `\n- previous_milestone: "${previous_milestone}"`
    : "";

  const prevMilestoneInstruction = !previous_milestone
    ? `\n\nIMPORTANT: You must determine the previous milestone for new-bugs detection. If the milestone looks like a version (e.g. "26.19.0"), use the immediately preceding version (e.g. "26.18.0"). The tool will auto-detect it if omitted, but providing it explicitly improves accuracy. Always pass previous_milestone to detect new bugs.`
    : "";

  return `Analyze regression test results for the ${project} platform (${filterDesc}).

Use the regression_results_analyzer tool with:
- project: "${project}"${milestone ? `\n- milestone: "${milestone}"` : ""}${build ? `\n- build: "${build}"` : ""}${prevClause}
- sections: ["overview", "new_bugs", "top_bugs", "bugs_per_suite", "slowest_tests"]
- output_format: "markdown"${prevMilestoneInstruction}

The tool will produce a comprehensive report including:
1. Summary table with aggregated pass/fail/skip/untested counts and pass rate
2. Per-run overview with coverage status (✅ when all failures have linked bugs)
3. New bugs (issues not seen in the previous milestone, with affected test case context)
4. Top 5 most frequent bugs across all runs with percentages
5. Known issues per suite (bugs grouped by test run with affected test counts)
6. Top 5 slowest tests across the milestone

Present the output as-is — it is already formatted as a structured regression summary report.`;
}

export function buildRelaunchRegressionFailuresPrompt(
  projects: string,
  milestone?: string,
  build?: string,
  period?: string,
  relaunchSettings?: RelaunchFailuresSettings,
  localeSettings?: LocaleTestRunRulesSettings,
): string {
  const relaunchCfg = relaunchSettings ?? getConfig().relaunchFailures;
  const localeCfg = localeSettings ?? getConfig().localeTestRunRules;
  const excludePatterns = relaunchCfg.excludeLaunchNamePatterns;
  const maxLaunches = relaunchCfg.maxLaunchesPerPlatform;
  const excludeDescription = formatLaunchExcludeCheckDescription(excludePatterns);
  const excludeRegexHint = formatLaunchExcludeRegexHint(excludePatterns);
  const skippedTableLabel = formatSkippedLaunchesTableLabel(excludePatterns);
  const patternList = formatLaunchExcludePatternsList(excludePatterns);

  const isLast7Days = period?.toLowerCase() === "last_7_days";

  let scopeSection: string;
  if (isLast7Days) {
    scopeSection = `**Scope: Last 7 days** (rolling window from now — NOT calendar week)
- Use time-based discovery — do NOT filter by milestone or build`;
  } else if (milestone || build) {
    const parts: string[] = [];
    if (milestone) parts.push(`milestone: "${milestone}"`);
    if (build) parts.push(`build: "${build}"`);
    scopeSection = `**Scope: Milestone/build regression**
- ${parts.join(", ")}`;
  } else {
    scopeSection = `**Scope: NOT YET RESOLVED**
- Ask the user to choose ONE:
  1. **Milestone/build regression** — provide milestone (e.g. "26.19.0") and/or build number
  2. **Last 7 days** — all failed launches in the rolling last 7 days (period: "last_7_days")
- Optionally call adv_get_project_milestones to suggest recent milestones`;
  }

  const milestoneDiscovery = milestone || build
    ? `Use adv_get_all_launches_with_filter with:
- project: current platform
${milestone ? `- milestone: "${milestone}"` : ""}
${build ? `- query: "${build}"` : ""}
- pageSize: 100, paginate until all pages fetched`
    : `When user provides milestone and/or build: paginate adv_get_all_launches_with_filter with milestone/query filters.`;

  const last7Discovery = isLast7Days
    ? `1. Compute windowStartMs = Date.now() - 7 * 24 * 60 * 60 * 1000
2. Paginate adv_get_all_launches_with_filter WITHOUT milestone/query (pageSize: 100)
3. Keep launches where startedAt >= windowStartMs
4. Early stop: if an entire page's newest startedAt is below windowStartMs, stop paginating (launches are typically newest-first)
5. Apply configured launch name exclusion filter and failure eligibility below`
    : `When period is last_7_days: paginate without milestone/query, filter client-side on startedAt within rolling 7 days.`;

  const localeNote = localeCfg.enabled
    ? `\n6. **Locale note:** For Build Now (adv_start_launch) with non-en_US locale on configured projects (${localeCfg.projectKeys.join(", ")}), see zebrunner-config.json \`localeTestRunRules\` — ${LOCALE_TEST_RUN_RULES_TOOL_NOTE} This rerun workflow does not use Build Now.`
    : "";

  return `Relaunch failed tests for platform(s): ${projects}.

${scopeSection}

## Configuration (zebrunner-config.json)
- \`relaunchFailures.excludeLaunchNamePatterns\`: ${patternList}
- \`relaunchFailures.maxLaunchesPerPlatform\`: ${maxLaunches}
${localeCfg.enabled ? `- \`localeTestRunRules\`: enabled for ${localeCfg.projectKeys.join(", ")} (Build Now only; not this rerun workflow)` : ""}

## CRITICAL RULES (always follow)
1. **ALWAYS exclude configured launch name patterns** — skip launches where ${excludeDescription}. List excluded launches in a "${skippedTableLabel}" table. Never rerun them. Patterns from config: ${patternList}.
2. **Never call confirm: true** without explicit user approval after showing the preview.
3. **Never skip the preview step** before any rerun.
4. **Do NOT use adv_start_launch** — that triggers Jenkins Build Now (different workflow). Use adv_rerun_launch_failures only.
5. Batch rerun cap is **${maxLaunches} launches** per platform (relaunchFailures.maxLaunchesPerPlatform) — warn and offer follow-up if more exist.

## Phase 0 — Resolve inputs
- Parse projects: "${projects}" (comma-separated platforms; process each sequentially)
${!milestone && !build && !isLast7Days ? "- If scope is unclear, ask the user before proceeding" : ""}

## Phase 1 — Discovery (per platform)

### Launch name exclusion filter (apply first to every launch)
Skip launch when ${excludeDescription}.
${excludePatterns.length === 1 ? `Match hint: launch.name matches ${excludeRegexHint}` : `Match each configured pattern (case-insensitive): ${patternList}`}

### Milestone/build mode
${milestoneDiscovery}

### Last 7 days mode
${last7Discovery}${localeNote}

### Failure eligibility (after launch name exclusions)
Keep launches where:
- (failed ?? 0) + (aborted ?? 0) >= 1
- status is NOT IN_PROGRESS or RUNNING
- isRelaunchPossible is not false

Build two tables per platform:
1. **Eligible for rerun** — launch ID, name, failed, aborted, status, startedAt (if period mode)
2. **${skippedTableLabel}** — launch ID, name, failed count (even if they had failures)

## Phase 2 — Rerun (per platform with eligible launches)

Choose execution strategy:

| Condition | Approach |
|-----------|----------|
| Milestone/build scope AND zero excluded-pattern launches were skipped from discovery | Single batch adv_rerun_launch_failures: { project, milestone?, query?, max_launches: ${maxLaunches}, min_failed: 1 } |
| last_7_days scope OR any excluded-pattern launches were skipped from a milestone/build set | Rerun ONLY filtered launch IDs via single-launch mode: { project, launch_id } — preview → user approval → confirm, one at a time (up to ${maxLaunches} per platform) |

**Why not blind batch rerun when exclusions were skipped?** Batch mode re-fetches by milestone/query and would include excluded launches with failures.

Steps for each platform:
1. If zero eligible launches → report "nothing to rerun"
2. If count > ${maxLaunches} → warn; process first ${maxLaunches}; list remainder IDs for follow-up
3. Call adv_rerun_launch_failures WITHOUT confirm → show preview
4. **STOP and wait for explicit user approval**
5. On approval: call with ONLY { confirm: true, confirmation_token }
6. Collect per-launch results

## Phase 3 — Final report
- Platforms processed
- Total launches found, eligible count, skipped excluded-pattern count
- Rerun success/failure counts per platform
- Links to launches where returned
- Reminder: triggers real CI reruns; requires reporting:test-runs:rerun permission

Present discovery summary BEFORE any mutation preview.`;
}

export type FeatureScopedLaunchSettings = {
  rootSuiteLaunchPaths: Record<string, string>;
};

export function buildFeatureScopedLaunchPrompt(
  project: string,
  feature: string,
  suiteName?: string,
  suitePath?: string,
  build?: string,
  locale?: string,
  templateQuery?: string,
  featureScopedLaunch?: FeatureScopedLaunchSettings,
  localeSettings?: LocaleTestRunRulesSettings,
): string {
  const launchPaths = featureScopedLaunch ?? getConfig().featureScopedLaunch;
  const localeCfg = localeSettings ?? getConfig().localeTestRunRules;
  const configuredPaths = Object.entries(launchPaths.rootSuiteLaunchPaths);
  const configuredPathsBlock = configuredPaths.length > 0
    ? configuredPaths.map(([name, path]) => `- "${name}" → suite_path: "${path}"`).join("\n")
    : "- (none configured — resolve suite_path from user input or past launches)";

  const scopeSection = suiteName || suitePath
    ? `**Suite scope:** ${suiteName ? `root suite name "${suiteName}"` : ""}${suiteName && suitePath ? " + " : ""}${suitePath ? `suite_path "${suitePath}"` : ""}`
    : `**Suite scope:** Whole project — discover all root suites containing matches, then one Build Now per root suite`;

  const buildClause = build ? `- build: "${build}"` : "- build: ask user or use \".*\" for latest";
  const localeClause = locale ? `- locale: "${locale}"` : "- locale: omit unless user specifies (non-en_US triggers localeTestRunRules when configured)";
  const templateClause = templateQuery
    ? `- template_query: "${templateQuery}"`
    : "- template_query: infer from root suite name or featureScopedLaunch.rootSuiteLaunchPaths in zebrunner-config.json";

  return `Find tests related to feature "${feature}" in project ${project}, build test_run_rules filters per root suite, preview Build Now (adv_start_launch), and trigger after user approval.

${scopeSection}

## Configuration (zebrunner-config.json)
**featureScopedLaunch.rootSuiteLaunchPaths** (Jenkins hidden \`suite\` param hints):
${configuredPathsBlock}
${localeCfg.enabled ? `\n**localeTestRunRules:** enabled for ${localeCfg.projectKeys.join(", ")} — adv_start_launch preview auto-handles non-en_US NOT_TAGS when applicable.` : ""}

## CRITICAL RULES
1. **Never call adv_start_launch with confirm: true** without explicit user approval after each preview.
2. **Never skip preview** before triggering CI.
3. **One Build Now launch per root suite** that has matching tests — separate test_run_rules and separate preview/confirm for each.
4. Use **adv_aggregate_test_cases_by_feature** for discovery — do not manually grep test lists unless the tool returns zero matches.
5. **Jenkins Build Now only** — adv_start_launch does not work with Launch Launchers.

## Phase 0 — Resolve project and scope
- project: "${project}" (resolve alias via adv_get_available_projects if needed)
- feature keyword: "${feature}" (case-insensitive search in title, description, preconditions, steps)
${suiteName ? `- Filter results to root suite whose name matches "${suiteName}" (case-insensitive)` : ""}
${suitePath ? `- Use suite_path "${suitePath}" for adv_start_launch template resolution when launching this scope` : ""}
${buildClause}
${localeClause}
${templateClause}

If suite scope is ambiguous (e.g. user said "Minimal Acceptance" but multiple suites match), ask before proceeding.

## Phase 1 — Discover feature tests and suites

1. Call **adv_aggregate_test_cases_by_feature** with:
   - project_key: resolved project key for "${project}"
   - feature_keyword: "${feature}"
   - output_format: "test_run_rules"
   - tags_format: "by_root_suite"

2. Parse the output:
   - Root suites with matching test cases
   - Feature suite IDs per root suite
   - TAGS lines: \`TAGS=>featureSuiteId=X||featureSuiteId=Y\`

3. ${suiteName || suitePath ? "Keep only root suites matching the requested scope." : "Include every root suite that has at least one match."}

4. Present a **discovery summary table** per root suite:
   - Root suite name and RootSuiteId
   - Feature suites (name, featureSuiteId, test case count)
   - Matching test case keys/titles (top examples)
   - Proposed **test_run_rules** value: \`TAGS=>featureSuiteId=...;;\` (use || between IDs in the same root suite)

If zero matches: stop and suggest alternate keywords or broader suite scope.

## Phase 2 — Resolve Build Now template per root suite

For each root suite with matches:

1. Determine **suite_path** (hidden Jenkins param), in priority order:
   - User-provided suite_path arg${suitePath ? ` ("${suitePath}")` : ""}
   - featureScopedLaunch.rootSuiteLaunchPaths[root suite name] from config
   - Past launch: adv_get_all_launches_with_filter + adv_get_launch_details with includeJobParameters: true
   - Ask user if still unknown

2. Optionally confirm template via adv_get_launch_details on a recent launch from that suite.

## Phase 3 — Preview and trigger (one root suite at a time)

For **each** root suite (sequential, not parallel):

1. Call **adv_start_launch** WITHOUT confirm:
   - project: "${project}"
   - suite_path: resolved path for this root suite
   - test_run_rules: TAGS filter from Phase 1 for this root suite only
   ${build ? `- build: "${build}"` : ""}
   ${locale ? `- locale: "${locale}"` : ""}
   ${templateQuery ? `- template_query: "${templateQuery}"` : ""}

2. Show preview to user: template launch, suite path, build, test_run_rules, test count scope.

3. **STOP — wait for explicit user approval** for this root suite.

4. On approval: call adv_start_launch with ONLY { confirm: true, confirmation_token }.

5. Record new launch ID and link before moving to the next root suite.

If user declines a root suite, skip it and continue with others only if user asks.

## Phase 4 — Final report
- Feature keyword and project
- Root suites processed vs skipped
- test_run_rules used per launch
- Launch IDs and links for triggered builds
- Reminder: monitor via adv_get_launch_details; failures via adv_rerun_launch_failures

Present Phase 1 discovery summary BEFORE any adv_start_launch preview.`;
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
    { name: "relaunch-regression-failures", title: "Relaunch Regression Failures", description: "Find failed launches (milestone/build or last 7 days), apply relaunchFailures config exclusions, and batch-rerun failures", category: "Analysis", args: ["projects", "milestone?", "build?", "period?"] },
    { name: "feature-scoped-launch", title: "Feature-Scoped Build Now", description: "Find tests by feature keyword, build test_run_rules per root suite, preview and trigger adv_start_launch", category: "Analysis", args: ["project", "feature", "suite_name?", "suite_path?", "build?", "locale?", "template_query?"] },
    { name: "flaky-review", title: "Flaky Test Review", description: "Find flaky tests, analyze execution history, and recommend stabilization priorities", category: "Analysis", args: ["project"] },
    { name: "find-duplicates", title: "Find Duplicate Test Cases", description: "Analyze test cases for duplicates using structural and optional semantic analysis", category: "Analysis", args: ["project", "suite_id?"] },
    { name: "daily-qa-standup", title: "Daily QA Standup", description: "Prepare a concise daily QA standup summary with pass rates, blockers, flaky tests, and action items", category: "Role-Specific", args: ["projects"] },
    { name: "automation-gaps", title: "Automation Gaps Analysis", description: "Identify suites and test cases with lowest automation coverage and prioritize automation work", category: "Role-Specific", args: ["projects"] },
    { name: "project-overview", title: "Project Overview", description: "Comprehensive project health card: suites, coverage, recent launches, milestones, flaky tests", category: "Role-Specific", args: ["project"] },
    { name: "regression-summary", title: "Regression Results Summary", description: "Analyze regression test results for a milestone or build: overview, new bugs, top bugs, bugs per suite, slowest tests", category: "E2E Metrics", args: ["project", "milestone?", "build?", "previous_milestone?"] },
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
    "regression-summary",
    {
      title: "Regression Results Summary",
      description: "Analyze regression test results for a milestone or build: test run overview, new bugs, top bugs, bugs per suite, and slowest tests",
      argsSchema: {
        project: z.string().describe("Platform/project key, e.g. 'ios'"),
        milestone: z.string().optional().describe("Milestone name, e.g. '26.19.0'"),
        build: z.string().optional().describe("Build number, e.g. '73614'"),
        previous_milestone: z.string().optional().describe("Previous milestone for new-bugs detection"),
      },
    },
    async ({ project, milestone, build, previous_milestone }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildRegressionSummaryPrompt(project, milestone, build, previous_milestone) },
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
    "relaunch-regression-failures",
    {
      title: "Relaunch Regression Failures",
      description: "Find failed launches (milestone/build or last 7 days), apply relaunchFailures.excludeLaunchNamePatterns from zebrunner-config.json, and batch-rerun failures",
      argsSchema: {
        projects: z.string().describe("Platform(s), e.g. 'android' or 'android,ios,api'"),
        milestone: z.string().optional().describe("Regression milestone, e.g. '26.19.0'"),
        build: z.string().optional().describe("Build number filter, e.g. 'mcp-app-2.1.0-45915'"),
        period: z.string().optional().describe("Time scope: 'last_7_days' for rolling 7-day window (omit milestone/build)"),
      },
    },
    async ({ projects, milestone, build, period }) => ({
      messages: [{
        role: "user" as const,
        content: { type: "text" as const, text: buildRelaunchRegressionFailuresPrompt(projects, milestone, build, period) },
      }],
    }),
  );

  server.registerPrompt(
    "feature-scoped-launch",
    {
      title: "Feature-Scoped Build Now",
      description: "Find tests by feature keyword, build test_run_rules TAGS filters per root suite, preview and trigger adv_start_launch (Jenkins Build Now)",
      argsSchema: {
        project: z.string().describe("Platform/project key or alias, e.g. 'android' or 'MFPAND'"),
        feature: z.string().describe("Feature keyword to search (case-insensitive), e.g. 'Water'"),
        suite_name: z.string().optional().describe("Optional root suite name scope, e.g. 'Minimal Acceptance'"),
        suite_path: z.string().optional().describe("Optional Jenkins suite path for template, e.g. 'mfp/android/minimal-acceptance'"),
        build: z.string().optional().describe("Build number override, e.g. '50977' or '.*' for latest"),
        locale: z.string().optional().describe("Locale override, e.g. 'en_US' or 'de_DE'"),
        template_query: z.string().optional().describe("Optional launch name substring to resolve template"),
      },
    },
    async ({ project, feature, suite_name, suite_path, build, locale, template_query }) => ({
      messages: [{
        role: "user" as const,
        content: {
          type: "text" as const,
          text: buildFeatureScopedLaunchPrompt(project, feature, suite_name, suite_path, build, locale, template_query),
        },
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
