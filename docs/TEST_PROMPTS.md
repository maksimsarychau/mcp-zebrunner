# Test Prompts for Zebrunner MCP Tools

> **Version:** 6.5.4
>
> This document contains 1–3 test prompts per tool with expected behavior, plus end-to-end metric collection prompts. All prompts use generic platform references (iOS / Android / Web) without specific project keys, launch IDs, or milestones.

---

## Table of Contents

1. [TCM / Test Case Management Tools](#1-tcm--test-case-management-tools)
2. [Launch / Reporting Tools](#2-launch--reporting-tools)
3. [Analysis / Bug Tools](#3-analysis--bug-tools)
4. [Utility / Connection Tools](#4-utility--connection-tools)
5. [Test Run Management Tools](#5-test-run-management-tools)
6. [Duplicate Analysis Tools](#6-duplicate-analysis-tools)
7. [E2E Metric Collection Prompts](#7-e2e-metric-collection-prompts)

---

## 1. TCM / Test Case Management Tools

### `list_test_suites`

**Prompt 1 — Basic listing**
> List all test suites for the Android project.

**Expected:** Returns paginated list of test suites with IDs and titles.

**Prompt 2 — With hierarchy**
> List test suites for the iOS project and include their hierarchy structure.

**Expected:** Returns suites with `include_hierarchy: true`, showing parent-child relationships.

**Prompt 3 — Count only**
> How many test suites are in the Android project? Just the count.

**Expected:** Uses `count_only: true`. Paginates through all pages via pageToken loop. Returns `{total_count: N, pages_traversed: M}` without suite data.

---

### `get_test_case_by_key`

**Prompt 1 — Full details**
> Get the full details of test case ANDROID-100 including suite hierarchy.

**Expected:** Returns complete test case with steps, priority, automation state, suite path, and all metadata.

**Prompt 2 — Markdown format**
> Show me test case IOS-500 in markdown format with clickable links.

**Expected:** Returns formatted markdown with a link to the Zebrunner web UI for the test case.

**Prompt 3 — Custom fields with display names** *(v6.5.3)*
> Get details for test case WEB-50. I want to see all custom fields with their proper display names, not API keys.

**Expected:** Custom fields section shows human-readable display names (e.g., "Manual Only" instead of `manualOnly`) ordered by their configured position in the Zebrunner UI. System properties (Deprecated, Draft, Priority, Automation State) are listed prominently and separately from custom fields.

**Prompt 4 — With execution history** *(v6.5.3)*
> Get details for test case IOS-500 including its execution history. Show me the last manual and automated runs.

**Expected:** Returns full test case details plus a table of up to 10 most recent TCM executions (manual and automated), each showing date, status, type (MANUAL/AUTOMATED), environment, and configurations (Platform, Build). Includes a pass rate summary.

---

### `get_all_subsuites`

**Prompt 1 — Flat list of subsuites**
> Get all subsuites under root suite 1 in the Android project as a flat list.

**Expected:** Returns all nested suites under the given root as a flat paginated array.

**Prompt 2 — Count only**
> How many subsuites are under root suite 1 in the Android project? Just the count.

**Expected:** Uses `count_only: true`. Returns `{total_count: N, root_suite_id: 1, root_suite_name: "..."}` without suite data.

---

### `get_test_cases_advanced`

**Prompt 1 — By suite with steps**
> Get all test cases in suite 1234 of the iOS project, including test steps. Filter to only automated ones.

**Expected:** Returns test cases with steps, filtered by `automation_states` and `suite_id`.

**Prompt 2 — By date and automation state**
> Get test cases in the Web project that were modified in the last 7 days and are marked as "Automated".

**Expected:** Combines `modified_after` with `automation_states` filter. Response includes `createdAt` for verification.

**Prompt 3 — Excluding deprecated** *(v6.5.1)*
> Get all non-deprecated, non-draft automated test cases in the Android project created after 2026-01-01.

**Expected:** Uses `automation_states`, `created_after`, `exclude_deprecated: true`, `exclude_draft: true`. Server-side RQL filtering.

**Prompt 4 — Count only** *(v6.5.4)*
> How many test cases are in root suite 42 of the iOS project? Just the count.

**Expected:** Uses `count_only: true` with `root_suite_id: 42`. Paginates through all pages accumulating only the count. Returns `{total_count: N}` without test case data.

---

### `get_suite_hierarchy`

**Prompt 1 — Full tree**
> Show the complete test suite tree for the iOS project with depth up to 5 levels.

**Expected:** Returns hierarchical tree structure with nested suites showing parent-child relationships.

**Prompt 2 — Subtree from root**
> Show the suite hierarchy starting from root suite 42 in the Android project, max 3 levels deep.

**Expected:** Returns a subtree rooted at suite 42 with `max_depth: 3`.

---

### `get_test_cases_by_automation_state`

**Prompt 1 — Automated tests only**
> Get all automated test cases in the Android project.

**Expected:** Returns test cases with automation state "Automated". Resolves name to ID via API.

**Prompt 2 — Not automated**
> Get all test cases that are NOT automated in the iOS project. Show the first page.

**Expected:** Returns test cases with "Not Automated" state (uses state IDs from `get_automation_states`).

**Prompt 3 — Get all, excluding deprecated** *(v6.5.1)*
> Get ALL automated test cases in the Web project, excluding deprecated ones. I need the complete list, not just one page.

**Expected:** Uses `get_all: true` to auto-paginate, `exclude_deprecated: true` for server-side filtering. Response includes `page_count` and `has_more_pages: false`.

**Prompt 4 — Count only (efficient for metrics)** *(v6.5.4)*
> How many automated test cases are in the Android project? Just the count, not the full data.

**Expected:** Uses `get_all: true, count_only: true`. Returns `{total_count: N}` without fetching full payloads. Efficient for metrics collection on large projects.

---

### `get_automation_states`

**Prompt 1 — List states**
> Get all available automation states for the iOS project. List every state with its ID and name.

**Expected:** Returns array of automation states (e.g., Automated, Manual, Not Automated, To Be Automated) with IDs.

---

### `get_test_case_by_title`

**Prompt 1 — Search by keyword**
> Find all test cases in the Android project with "login" in the title.

**Expected:** Returns test cases matching partial title search "login" with pagination.

**Prompt 2 — Get all matches**
> Find ALL test cases in the Web project with "checkout" in the title. Get every page.

**Expected:** Uses `get_all: true` to auto-paginate through all matching test cases.

**Prompt 3 — Count only** *(v6.5.4)*
> How many test cases in the iOS project have "payment" in the title? Just the count.

**Expected:** Uses `get_all: true, count_only: true`. Returns `{total_count: N}` without full payloads.

---

### `get_test_case_by_filter`

**Prompt 1 — By date range**
> Get test cases in the iOS project created in the last 30 days.

**Expected:** Returns test cases filtered by `created_after` date. Response includes `createdAt` for verification.

**Prompt 2 — By priority and automation state**
> Get all high-priority automated test cases in the Android project.

**Expected:** Combines `priority_id` and `automation_state_id` filters.

**Prompt 3 — Excluding deprecated and draft** *(v6.5.1)*
> Get all automated test cases in the Web project, excluding deprecated and draft ones.

**Expected:** Uses `automation_state_id`, `exclude_deprecated: true`, `exclude_draft: true`. Server-side RQL filtering.

**Prompt 4 — Count only for date range** *(v6.5.4)*
> How many test cases were created in the Android project in the last 30 days? Just the count.

**Expected:** Uses `get_all: true, count_only: true, created_after: <30 days ago>`. Returns `{total_count: N}` without full payloads.

---

### `get_automation_priorities`

**Prompt 1 — List priorities**
> Get all available priorities for the Android project with their IDs.

**Expected:** Returns priority list (e.g., Critical, High, Medium, Low) with IDs.

---

### `get_tcm_test_suites_by_project`

**Prompt 1 — Paginated suites**
> Get the first page of test suites for the Web project, 50 per page.

**Expected:** Returns paginated suite list with `nextPageToken` for continuation.

**Prompt 2 — Count only**
> How many TCM test suites are in the Web project? Just the count.

**Expected:** Uses `count_only: true`. Paginates through all pages and returns `{total_count: N, pages_traversed: M}`.

---

### `get_all_tcm_test_case_suites_by_project`

**Prompt 1 — All suites with hierarchy**
> Get ALL test case suites for the iOS project, including their hierarchy information.

**Expected:** Auto-paginates through all suites and returns them with parent/child relationships.

**Prompt 2 — Count only**
> How many total suites are in the iOS project? Just the count, skip hierarchy processing.

**Expected:** Uses `count_only: true`. Paginates internally, returns `{total_count: N, pages_traversed: M}` without hierarchy processing or formatting.

---

### `get_root_suites`

**Prompt 1 — List root suites**
> What are the root (top-level) test suites in the Android project?

**Expected:** Returns only suites with no parent (root level).

---

### `get_tcm_suite_by_id`

**Prompt 1 — Find suite by ID**
> Find test suite with ID 42 in the iOS project.

**Expected:** Returns suite details including title, description, and parent info.

---

### `get_all_tcm_test_cases_by_project`

**Prompt 1 — Full export**
> Get ALL test cases in the iOS project. How many are there in total?

**Expected:** Auto-paginates through all test cases (up to 10,000). Response includes `total_fetched`, `was_truncated`, and `has_more_pages`.

**Prompt 2 — Excluding deprecated/draft/deleted** *(v6.5.1)*
> Get all active test cases in the Android project, excluding deprecated, draft, and deleted ones. How many are there?

**Expected:** Uses `exclude_deprecated: true`, `exclude_draft: true`, `exclude_deleted: true`. Server-side RQL filtering applied. Response includes `filters_applied` metadata.

**Prompt 3 — Count only** *(v6.5.4)*
> How many total test cases are in the Web project, excluding deleted ones? Just the count.

**Expected:** Uses `count_only: true, exclude_deleted: true`. Returns `{total_count: N}` without fetching all test case objects. Efficient for coverage metrics.

---

### `get_all_tcm_test_cases_with_root_suite_id`

**Prompt 1 — With root suite info**
> Get all test cases in the Web project, and for each one, include which root suite it belongs to.

**Expected:** Returns test cases enriched with `rootSuiteId` information for categorization.

**Prompt 2 — Count only** *(v6.5.4)*
> How many test cases are in the Android project? Just the count, skip the hierarchy enrichment.

**Expected:** Uses `count_only: true`. Paginates to count but skips suite hierarchy processing for speed. Returns `{total_count: N}`.

---

### `get_root_id_by_suite_id`

**Prompt 1 — Resolve root**
> What is the root suite for suite ID 150 in the Android project?

**Expected:** Returns the root (top-level) suite ID that contains suite 150.

---

### `get_test_cases_by_suite_smart`

**Prompt 1 — Auto-detect suite type**
> Get all test cases in suite 42 of the iOS project, including sub-suites.

**Expected:** Auto-detects whether 42 is a root or child suite, then fetches test cases from it and all sub-suites.

**Prompt 2 — Single suite only**
> Get test cases ONLY in suite 42 of the Android project (no sub-suites).

**Expected:** Uses `include_sub_suites: false` to return only direct children of suite 42.

**Prompt 3 — Count only** *(v6.5.4)*
> How many test cases are in suite 42 of the iOS project, including sub-suites? Just the count.

**Expected:** Uses `count_only: true`. Auto-detects suite type, builds filter, and paginates to count without returning test case data. Returns `{total_count: N, suite_name: "...", is_root_suite: true/false}`.

---

### `validate_test_case`

**Prompt 1 — Quality check**
> Validate test case IOS-200 against quality standards and suggest improvements.

**Expected:** Runs validation rules, generates quality score, and provides improvement suggestions in markdown.

**Prompt 2 — Verify system vs custom field handling** *(v6.5.3)*
> Validate test case ANDROID-300. Make sure the "Manual Only" custom field is detected correctly even if the project uses a different field name.

**Expected:** Validator dynamically discovers the "Manual Only" field from the project's fields layout instead of hardcoding the API key. Validation result includes the `manualOnly` value if the field exists.

---

### `improve_test_case`

**Prompt 1 — Auto-improve**
> Analyze and improve test case ANDROID-300 with automatic high-confidence fixes.

**Expected:** Analyzes the test case, suggests improvements, and applies high-confidence changes automatically.

---

### `aggregate_test_cases_by_feature`

**Prompt 1 — Feature search**
> Find all test cases related to "payment" in the Web project, grouped by root suite.

**Expected:** Searches title, body, and steps for "payment", returns grouped results by root suite.

**Prompt 2 — Test run rules format**
> Find all test cases related to "login" in the Android project and output in test_run_rules format.

**Expected:** Returns results formatted for test run rule configuration.

---

## 2. Launch / Reporting Tools

### `get_launch_details`

**Prompt 1 — Full launch info**
> Get the full details for the latest Android launch including all test sessions.

**Expected:** Returns launch metadata, test sessions with durations, pass/fail counts, and environment info.

---

### `get_launch_test_summary`

**Prompt 1 — Summary statistics**
> Get a test summary for the latest iOS launch. Just give me the statistics.

**Expected:** Returns pass/fail/skip counts, pass rate, total duration using `summaryOnly: true`.

**Prompt 2 — Failed tests sorted by stability**
> Get the test summary for the latest Web launch. Show only failed tests sorted by stability.

**Expected:** Uses `statusFilter: ['FAILED']`, `sortBy: 'stability'` to return failed tests ordered by flakiness.

**Prompt 3 — Count only**
> How many tests ran in launch 119783 of the MCP project? Just give me the total and per-status breakdown.

**Expected:** Uses `count_only: true`. Fetches all test runs but skips session resolution and JIRA URL lookups. Returns `{total_count: N, filtered_count: N, by_status: {PASSED: X, FAILED: Y, ...}}`.

---

### `generate_weekly_regression_stability_report`

**Prompt 1 — Compare two builds**
> Generate a weekly regression stability report for the Android project comparing the current build to the previous one.

**Expected:** Produces a formatted report (default: Jira-ready) showing pass rate deltas, suite-level comparison, and status indicators.

**Prompt 2 — Count only (build pre-check)**
> How many suites will be matched for the Android project comparing build 49117 vs 48886? Don't generate the full report.

**Expected:** Uses `count_only: true` with `builds`. Resolves launches from build identifiers, returns `{suites_found: N, matched_suites: M}` without generating the comparison report.

---

### `get_launch_summary`

**Prompt 1 — Quick overview**
> Give me a quick summary of the latest iOS launch.

**Expected:** Returns launch name, environment, status, duration, and pass/fail counts without detailed test sessions.

---

### `analyze_regression_runtime`

**Prompt 1 — Runtime with baseline comparison**
> Analyze the regression runtime for the Android platform. Compare the current milestone to the previous one and flag any tests that got slower by more than 20%.

**Expected:** Returns average runtime per test, WRI, duration distribution (short/medium/long), and delta vs baseline.

**Prompt 2 — With custom thresholds**
> Analyze regression runtime for iOS with custom thresholds: medium = 3 minutes, long = 8 minutes.

**Expected:** Uses `medium_threshold_seconds: 180`, `long_threshold_seconds: 480` for custom duration classification.

---

### `get_all_launches_for_project`

**Prompt 1 — Recent launches**
> Show me the 10 most recent launches for the Web project.

**Expected:** Returns paginated list of launches with names, dates, and status.

**Prompt 2 — Count only**
> How many total launches are in the Android project? Just the count.

**Expected:** Uses `count_only: true`. Single API call with `pageSize=1`, returns `{total_count: N}` from `_meta.total`.

---

### `get_all_launches_with_filter`

**Prompt 1 — By milestone**
> Get all launches for the Android project on the latest milestone.

**Expected:** Filters launches by milestone name, returns matching launches with metadata.

**Prompt 2 — By build number**
> Find all iOS launches for build 26.6.0.

**Expected:** Uses query/milestone filter to find launches matching the build number.

**Prompt 3 — Count only**
> How many launches for the Web project match milestone "26.0.0"? Just the count.

**Expected:** Uses `count_only: true`. Returns `{total_count: N, filter: "milestone \"26.0.0\""}` from API metadata.

---

### `get_platform_results_by_period`

**Prompt 1 — Last 7 days**
> Get test results by platform for the Android project over the last 7 days.

**Expected:** Returns pass/fail/skip statistics aggregated by platform for the period.

**Prompt 2 — Custom period**
> Get test results for the Web project for the last 30 days.

**Expected:** Uses `period: "Last 30 Days"` to return monthly aggregated results.

---

### `get_project_milestones`

**Prompt 1 — Active milestones**
> List all active (incomplete) milestones for the iOS project.

**Expected:** Returns milestones with status "incomplete", showing name, due date, and progress.

**Prompt 2 — All milestones**
> Show all milestones for the Android project, including completed ones.

**Expected:** Uses `status: 'all'` to return every milestone regardless of status.

**Prompt 3 — Count only**
> How many overdue milestones does the Web project have? Just the count.

**Expected:** Uses `count_only: true, status: 'overdue'`. Paginates through incomplete milestones, applies client-side overdue filter, returns `{total_count: N, status: "overdue"}`.

---

## 3. Analysis / Bug Tools

### `get_test_coverage_by_test_case_steps_by_key`

**Prompt 1 — Full coverage analysis**
> Analyze the test coverage of test case ANDROID-100 against its implementation. The test covers the login flow including username entry, password entry, and submit.

**Expected:** Returns step-by-step coverage analysis with recommendations for gaps.

---

### `generate_draft_test_by_key`

**Prompt 1 — Auto-detect framework**
> Generate draft test code for test case IOS-200. The implementation uses a mobile testing framework for iOS app testing.

**Expected:** Auto-detects the framework and generates test code with setup/teardown and assertion templates.

---

### `get_enhanced_test_coverage_with_rules`

**Prompt 1 — With rules validation**
> Analyze test coverage for WEB-50 with rules validation enabled. The test covers the checkout page flow.

**Expected:** Returns coverage analysis with quality scoring and rules-based validation results.

---

### `analyze_test_failure`

**Prompt 1 — Forensic analysis**
> Analyze the failure for the latest failed test in the Android launch. Include screenshots and logs.

**Expected:** Returns root cause analysis with screenshot annotations, log excerpts, and similar failure patterns.

**Prompt 2 — Compare with last passed**
> Analyze the test failure and compare it with the last time this test passed. What changed?

**Expected:** Uses `compareWithLastPassed: { enabled: true }` to show diff between passing and failing executions.

---

### `get_test_execution_history`

**Prompt 1 — Pass/fail trend**
> Show the execution history for this test across the last 10 launches. What is its pass rate?

**Expected:** Returns chronological pass/fail history with overall pass rate and stability assessment.

> **Note:** For TCM-level execution history (including manual test runs), use `get_test_case_by_key` with `include_execution_history: true` instead. The `get_test_execution_history` tool is for launch-level automated test history.

**Prompt 2 — Count only**
> What is the pass rate and execution count for this test? Just the numbers, no history details.

**Expected:** Uses `count_only: true`. Returns `{total_executions: N, passed: X, failed: Y, pass_rate: "Z%"}` without formatted per-execution output.

---

### `download_test_screenshot`

**Prompt 1 — Download screenshot**
> Download the screenshot for the failed test and save it locally.

**Expected:** Downloads screenshot from Zebrunner with authentication and saves to specified path.

---

### `analyze_screenshot`

**Prompt 1 — Visual analysis**
> Analyze the screenshot from the last failed iOS test. What UI elements are visible? Is there an error message?

**Expected:** Returns visual analysis using Claude Vision with element identification and error detection.

---

### `analyze_test_execution_video`

**Prompt 1 — Failure-focused video analysis**
> Analyze the execution video for the failed Android test, focusing on the failure moment.

**Expected:** Extracts frames around the failure, performs visual analysis, and correlates with test logs.

---

### `detailed_analyze_launch_failures`

**Prompt 1 — Unlinked failures**
> Show me all failed tests in the latest Android launch that don't have linked Jira issues.

**Expected:** Returns failed tests filtered by `filterType: 'without_issues'`, highlighting tests needing bug triage.

**Prompt 2 — All failures with screenshots**
> Analyze all failures in the latest Web launch. Include screenshot analysis for each.

**Expected:** Uses `filterType: 'all'`, `includeScreenshotAnalysis: true` for comprehensive failure analysis.

**Prompt 3 — Count only**
> How many failed tests without linked Jira issues are in launch 120806? Just the count, don't analyze them.

**Expected:** Uses `count_only: true`. Fetches all tests and filters to failed/aborted without issues, returns `{total_tests: N, total_failed: M, filter_type: "without_issues"}` without performing expensive per-test analysis.

---

### `get_top_bugs`

**Prompt 1 — Top 10 defects**
> What are the top 10 most frequent bugs in the iOS project over the last 30 days?

**Expected:** Returns ranked list of defects by frequency with failure counts and optional Jira links.

**Prompt 2 — With issue links**
> Show the top 5 bugs for the Android project in the last 7 days with Jira links.

**Expected:** Returns bugs with clickable Jira issue URLs using the `issueUrlPattern` parameter.

---

### `get_bug_review`

**Prompt 1 — Detailed bug review**
> Give me a detailed bug review for the Web project covering the last 14 days.

**Expected:** Returns bugs with failure counts, reproduction dates, and defect categorization.

---

### `get_bug_failure_info`

**Prompt 1 — Specific bug deep-dive**
> Get detailed failure information for a specific bug hashcode in the Android project.

**Expected:** Returns failure summary, affected test runs, and reproduction details for the specific defect.

---

## 4. Utility / Connection Tools

### `test_reporting_connection`

**Prompt 1 — Connection check**
> Test the connection to the Zebrunner Reporting API.

**Expected:** Authenticates via Bearer token (JWT refresh) and confirms connection status.

---

### `about_mcp_tools`

**Prompt 1 — Tool summary**
> Give me a summary of all available Zebrunner MCP tools.

**Expected:** Returns categorized list of all 52 tools with brief descriptions.

**Prompt 2 — Specific tool details**
> Show me detailed info for the analyze_regression_runtime tool with examples.

**Expected:** Returns full parameter documentation, usage examples, and approximate token estimates.

---

### `get_available_projects`

**Prompt 1 — List all projects**
> What projects are available in Zebrunner?

**Expected:** Returns list of projects with keys and IDs for use in other tools.

---

## 5. Test Run Management Tools

### `list_test_runs`

**Prompt 1 — Recent test runs**
> List the 10 most recent test runs for the Android project.

**Expected:** Returns test runs sorted by creation date (descending) with status, name, and metadata.

**Prompt 2 — Filtered by milestone**
> List all test runs in the iOS project for a specific milestone.

**Expected:** Uses `milestoneFilter` to narrow results to a specific release cycle.

**Prompt 3 — Count only**
> How many test runs are in the Android project? Just the count.

**Expected:** Uses `count_only: true`. Paginates through all pages via pageToken loop, returns `{total_count: N, pages_traversed: M}`.

---

### `get_test_run_by_id`

**Prompt 1 — Run details**
> Get the details for test run #42 in the Web project.

**Expected:** Returns full test run info including name, milestone, build, environment, and execution summary.

---

### `list_test_run_test_cases`

**Prompt 1 — Cases in a run**
> List all test cases included in test run #42 of the Android project.

**Expected:** Returns test cases with their result status, assignee, and configuration.

---

### `get_test_run_result_statuses`

**Prompt 1 — Available statuses**
> What result statuses are configured for the iOS project?

**Expected:** Returns list of available statuses (e.g., Passed, Failed, Skipped, Blocked) with their IDs.

---

### `get_test_run_configuration_groups`

**Prompt 1 — Configuration options**
> What configuration groups and options are available for the Web project?

**Expected:** Returns configuration groups (e.g., Browser, OS, Device) with their option values.

---

## 6. Duplicate Analysis Tools

### `analyze_test_cases_duplicates`

**Prompt 1 — Step similarity**
> Analyze test cases in the iOS project for duplicates using 80% step similarity threshold.

**Expected:** Returns groups of similar test cases with similarity scores and step comparison details.

**Prompt 2 — Within a suite**
> Check for duplicate test cases in suite 42 of the Android project.

**Expected:** Uses `suite_id` to scope the analysis to a specific suite.

---

### `analyze_test_cases_duplicates_semantic`

**Prompt 1 — Semantic analysis**
> Do a semantic duplicate analysis of test cases in the Web project using hybrid mode.

**Expected:** Uses LLM-powered step clustering for more intelligent duplicate detection than pure step matching.

**Prompt 2 — Specific test cases**
> Check if these test cases are duplicates: ANDROID-100, ANDROID-101, ANDROID-102.

**Expected:** Uses `test_case_keys` array to analyze specific test cases for similarity.

---

## 7. E2E Metric Collection Prompts

These prompts combine multiple tools to collect real business metrics. The LLM should automatically select the right tools.

---

### E2E Prompt 1: Pass Rate

> **Collect Pass Rate metrics for all three platforms (Android, iOS, Web) for the latest milestone.**
>
> For each platform:
> - Total Executed Tests
> - Passed Tests
> - Failed Tests
> - Pass Rate = (Passed / Total) × 100
> - Pass Rate excluding known issues (if available)
>
> Targets:
> - Android ≥ 90%
> - iOS ≥ 90%
> - Web ≥ 65% (≥ 95% excluding known issues)
>
> Present results in a comparison table with status indicators (✅ on target / ⚠️ below target).

**Expected tools:** `get_all_launches_with_filter` to find launches by milestone, then `get_launch_test_summary` or `get_launch_details` for each launch to collect pass/fail counts. For known issues, look at `KNOWN_ISSUE` status. Aggregate across all suites per platform.

**Expected output:** Table per platform with total tests, passed, failed, known issues, pass rate, pass rate excluding known issues, and target comparison.

---

### E2E Prompt 2: Regression Runtime Efficiency

> **Collect Regression Runtime Efficiency metrics for all three platforms (Android, iOS, Web).**
>
> For the latest milestone and the previous milestone, collect:
> - Total execution time (wall-clock)
> - Number of executed tests
> - Number of test cases covered
> - Average Runtime per Test
> - Average Runtime per Test Case
> - WRI and WRI per Test Case
> - Duration distribution: how many tests/test cases in Short (<5min), Medium (5–10min), Long (≥10min)
> - Delta vs previous milestone (%)
>
> Flag any suite where long-running tests degraded by more than 20%.
>
> Present results as a cross-platform comparison with trend indicators.

**Expected tools:** `analyze_regression_runtime` called 3 times (once per platform) with `previous_milestone` for baseline comparison.

**Expected output:** Per-platform summary with all metrics, aggregated comparison table, delta percentages, and degradation alerts for long-running tests.

---

### E2E Prompt 3: Automation Coverage Sustainability

> **Collect Automation Coverage metrics for all three platforms (Android, iOS, Web).**
>
> For each platform:
> 1. Total test cases in the TCM system
> 2. Total automated test cases (automation state = "Automated")
> 3. Baseline Coverage = (Automated / Total) × 100
> 4. Coverage excluding "Manual only" and "Deprecated" test cases
> 5. Test cases added in the last 30 days (new test cases)
> 6. Of those new test cases, how many are automated?
> 7. Automation Intake Rate = (New Automated / New Total) × 100
>
> Present results with both "with manual/deprecated" and "without manual/deprecated" perspectives.
>
> Targets: Track coverage trend — is the automation intake rate keeping up with new test case creation?

**Expected tools:** `get_automation_states` to discover state IDs, then `get_test_cases_by_automation_state` with `get_all: true, count_only: true` for efficient total counts per state. For total excluding deprecated/draft: `get_all_tcm_test_cases_by_project` with `exclude_deprecated: true, count_only: true`. For 30-day window counts: `get_test_case_by_filter` with `created_after, get_all: true, count_only: true`. The `count_only` flag avoids the 1MB MCP response limit on large projects.

**Expected output:** Per-platform table with total TCs, automated TCs, coverage %, coverage excluding manual/deprecated, new TCs in 30 days, new automated TCs, intake rate, and trend assessment.

---

### E2E Prompt 4: Combined Executive Dashboard

> **Generate an executive QA dashboard for all three platforms (Android, iOS, Web) on the latest milestone.**
>
> Include:
> 1. **Pass Rate** — per platform with target comparison (Android/iOS ≥ 90%, Web ≥ 65%)
> 2. **Regression Runtime** — average runtime per test, WRI, delta vs previous milestone
> 3. **Top 5 Bugs** — most frequent defects per platform with Jira links
> 4. **Test Case Coverage** — automation coverage rate per platform
> 5. **Flaky Tests** — any tests that flip-flopped pass/fail in the latest launch
>
> Present as a single structured report suitable for a weekly standup.

**Expected tools:** Combination of `get_launch_test_summary`, `analyze_regression_runtime`, `get_top_bugs`, `get_automation_states` + `get_test_cases_by_automation_state` with `count_only: true` for coverage metrics, and `get_test_execution_history` for flaky test detection.

**Expected output:** Structured executive report with sections for each metric area, cross-platform comparison tables, and actionable highlights.

---

### E2E Prompt 5: Release Readiness Assessment

> **Assess release readiness for the Android platform on the latest milestone.**
>
> Check:
> 1. Pass rate — is it above 90%?
> 2. Are there any test failures without linked Jira issues? (unresolved blockers)
> 3. Runtime efficiency — has average runtime per test increased vs previous milestone?
> 4. Coverage — what % of test cases are automated?
> 5. Top defects — what are the most common failure patterns?
>
> Provide a Go / No-Go recommendation with supporting evidence.

**Expected tools:** `get_all_launches_with_filter` + `get_launch_test_summary` for pass rate, `detailed_analyze_launch_failures` for unlinked failures, `analyze_regression_runtime` with baseline comparison, `get_test_cases_by_automation_state` with `count_only: true` for coverage percentage, `get_top_bugs` for defect patterns.

**Expected output:** Structured assessment with per-check status, evidence, and a clear Go/No-Go recommendation.
