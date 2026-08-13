# Test Prompts for Zebrunner MCP Tools

> This document contains 1–3 test prompts per tool with expected behavior, plus end-to-end metric collection prompts. **§18** documents all **22 Zebrunner dashboard widget templates** with MCP tool mapping and verification commands (**v9.2.5**). All prompts use generic platform references (iOS / Android / Web) without specific project keys, launch IDs, or milestones.

---

## Table of Contents

1. [TCM / Test Case Management Tools](#1-tcm--test-case-management-tools)
2. [Launch / Reporting Tools](#2-launch--reporting-tools)
3. [Analysis / Bug Tools](#3-analysis--bug-tools)
4. [Utility / Connection Tools](#4-utility--connection-tools)
5. [Test Run Management Tools](#5-test-run-management-tools)
6. [Duplicate Analysis Tools](#6-duplicate-analysis-tools)
7. [E2E Metric Collection Prompts](#7-e2e-metric-collection-prompts)
8. [Flaky Test Detection](#8-flaky-test-detection)
9. [Chart Visualization](#9-chart-visualization)
10. [Field-Path Filtering](#10-field-path-filtering)
11. [Reports (adv_generate_report)](#11-reports-adv_generate_report)
12. [Suite Coverage Report](#12-suite-coverage-report)
13. [Mutation Tools (Beta)](#13-mutation-tools-beta)
14. [MCP Resources](#14-mcp-resources-v721)
15. [MCP Prompts](#15-mcp-prompts-v910)
16. [Tool Annotations](#16-tool-annotations-v721)
17. [Tool Metrics & Token Tracking](#17-tool-metrics--token-tracking-v721)
18. [Dashboard Widgets (22 templates)](#18-dashboard-widgets-22-templates--v925)

---

## 1. TCM / Test Case Management Tools

### `adv_list_test_suites`

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

### `adv_get_test_case_by_key`

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

### `adv_get_all_subsuites`

**Prompt 1 — Flat list of subsuites**
> Get all subsuites under root suite 1 in the Android project as a flat list.

**Expected:** Returns all nested suites under the given root as a flat paginated array.

**Prompt 2 — Count only**
> How many subsuites are under root suite 1 in the Android project? Just the count.

**Expected:** Uses `count_only: true`. Returns `{total_count: N, root_suite_id: 1, root_suite_name: "..."}` without suite data.

---

### `adv_get_test_cases_advanced`

**Prompt 1 — By suite with steps**
> Get all test cases in suite 1234 of the iOS project, including test steps. Filter to only automated ones.

**Expected:** Returns test cases with steps, filtered by `automation_states` and `suite_id`.

**Prompt 2 — By date and automation state**
> Get test cases in the Web project that were modified in the last 7 days and are marked as "Automated".

**Expected:** Combines `modified_after` with `automation_states` filter. Response includes `createdAt` for verification.

**Prompt 3 — Excluding deprecated** *(v6.5.1)*
> Get all non-deprecated, non-draft automated test cases in the Android project created after 2026-01-01.

**Expected:** Uses `automation_states`, `created_after`, `exclude_deprecated: true`, `exclude_draft: true`. Server-side RQL filtering.

**Prompt 4 — Count only** *(v6.6.0)*
> How many test cases are in root suite 42 of the iOS project? Just the count.

**Expected:** Uses `count_only: true` with `root_suite_id: 42`. Paginates through all pages accumulating only the count. Returns `{total_count: N}` without test case data.

---

### `adv_get_suite_hierarchy`

**Prompt 1 — Full tree**
> Show the complete test suite tree for the iOS project with depth up to 5 levels.

**Expected:** Returns hierarchical tree structure with nested suites showing parent-child relationships.

**Prompt 2 — Subtree from root**
> Show the suite hierarchy starting from root suite 42 in the Android project, max 3 levels deep.

**Expected:** Returns a subtree rooted at suite 42 with `max_depth: 3`.

---

### `adv_get_test_cases_by_automation_state`

**Prompt 1 — Automated tests only**
> Get all automated test cases in the Android project.

**Expected:** Returns test cases with automation state "Automated". Resolves name to ID via API.

**Prompt 2 — Not automated**
> Get all test cases that are NOT automated in the iOS project. Show the first page.

**Expected:** Returns test cases with "Not Automated" state (uses state IDs from `adv_get_automation_states`).

**Prompt 3 — Get all, excluding deprecated** *(v6.5.1)*
> Get ALL automated test cases in the Web project, excluding deprecated ones. I need the complete list, not just one page.

**Expected:** Uses `get_all: true` to auto-paginate, `exclude_deprecated: true` for server-side filtering. Response includes `page_count` and `has_more_pages: false`.

**Prompt 4 — Count only (efficient for metrics)** *(v6.6.0)*
> How many automated test cases are in the Android project? Just the count, not the full data.

**Expected:** Uses `get_all: true, count_only: true`. Returns `{total_count: N}` without fetching full payloads. Efficient for metrics collection on large projects.

---

### `adv_get_automation_states`

**Prompt 1 — List states**
> Get all available automation states for the iOS project. List every state with its ID and name.

**Expected:** Returns array of automation states (e.g., Automated, Manual, Not Automated, To Be Automated) with IDs.

---

### `adv_get_test_case_by_title`

**Prompt 1 — Search by keyword**
> Find all test cases in the Android project with "login" in the title.

**Expected:** Returns test cases matching partial title search "login" with pagination.

**Prompt 2 — Get all matches**
> Find ALL test cases in the Web project with "checkout" in the title. Get every page.

**Expected:** Uses `get_all: true` to auto-paginate through all matching test cases.

**Prompt 3 — Count only** *(v6.6.0)*
> How many test cases in the iOS project have "payment" in the title? Just the count.

**Expected:** Uses `get_all: true, count_only: true`. Returns `{total_count: N}` without full payloads.

---

### `adv_get_test_case_by_filter`

**Prompt 1 — By date range**
> Get test cases in the iOS project created in the last 30 days.

**Expected:** Returns test cases filtered by `created_after` date. Response includes `createdAt` for verification.

**Prompt 2 — By priority and automation state**
> Get all high-priority automated test cases in the Android project.

**Expected:** Combines `priority_id` and `automation_state_id` filters.

**Prompt 3 — Excluding deprecated and draft** *(v6.5.1)*
> Get all automated test cases in the Web project, excluding deprecated and draft ones.

**Expected:** Uses `automation_state_id`, `exclude_deprecated: true`, `exclude_draft: true`. Server-side RQL filtering.

**Prompt 4 — Count only for date range** *(v6.6.0)*
> How many test cases were created in the Android project in the last 30 days? Just the count.

**Expected:** Uses `get_all: true, count_only: true, created_after: <30 days ago>`. Returns `{total_count: N}` without full payloads.

---

### `adv_get_automation_priorities`

**Prompt 1 — List priorities**
> Get all available priorities for the Android project with their IDs.

**Expected:** Returns priority list (e.g., Critical, High, Medium, Low) with IDs.

---

### `adv_get_tcm_test_suites_by_project`

**Prompt 1 — Paginated suites**
> Get the first page of test suites for the Web project, 50 per page.

**Expected:** Returns paginated suite list with `nextPageToken` for continuation.

**Prompt 2 — Count only**
> How many TCM test suites are in the Web project? Just the count.

**Expected:** Uses `count_only: true`. Paginates through all pages and returns `{total_count: N, pages_traversed: M}`.

---

### `adv_get_all_tcm_test_case_suites_by_project`

**Prompt 1 — All suites with hierarchy**
> Get ALL test case suites for the iOS project, including their hierarchy information.

**Expected:** Auto-paginates through all suites and returns them with parent/child relationships.

**Prompt 2 — Count only**
> How many total suites are in the iOS project? Just the count, skip hierarchy processing.

**Expected:** Uses `count_only: true`. Paginates internally, returns `{total_count: N, pages_traversed: M}` without hierarchy processing or formatting.

---

### `adv_get_root_suites`

**Prompt 1 — List root suites**
> What are the root (top-level) test suites in the Android project?

**Expected:** Returns only suites with no parent (root level).

---

### `adv_get_tcm_suite_by_id`

**Prompt 1 — Find suite by ID**
> Find test suite with ID 42 in the iOS project.

**Expected:** Returns suite details including title, description, and parent info.

---

### `adv_get_all_tcm_test_cases_by_project`

**Prompt 1 — Full export**
> Get ALL test cases in the iOS project. How many are there in total?

**Expected:** Auto-paginates through all test cases (up to 10,000). Response includes `total_fetched`, `was_truncated`, and `has_more_pages`. If the ~900 KB safety net truncates the payload: **`format=json`** returns a bare array slice; **`format=compact`** returns the same wrapper object with fewer `test_cases` and `was_truncated: true`.

**Prompt 2 — Excluding deprecated/draft/deleted** *(v6.5.1)*
> Get all active test cases in the Android project, excluding deprecated, draft, and deleted ones. How many are there?

**Expected:** Uses `exclude_deprecated: true`, `exclude_draft: true`, `exclude_deleted: true`. Server-side RQL filtering applied. Response includes `filters_applied` metadata.

**Prompt 3 — Count only** *(v6.6.0)*
> How many total test cases are in the Web project, excluding deleted ones? Just the count.

**Expected:** Uses `count_only: true, exclude_deleted: true`. Returns `{total_count: N}` without fetching all test case objects. Efficient for coverage metrics.

**Prompt 4 — Fair compact vs json A/B** *(v9.2.1)*
> Call `adv_get_all_tcm_test_cases_by_project` for project MCP twice with identical args except format: `detail=summary`, `max_results=500`, `include_call_metrics=true`. First call `format=json`, second `format=compact`. Do not summarize the test case bodies. For each response, read the `_mcp_metrics` footer and report: `format | rowsReturned | wasTruncated | responseChars | approxTokens | bytesPerRow`. State whether compact is cheaper per row and in total, and whether `rowsReturned` matched.

**Expected:** Same `rowsReturned` on both calls; `bytesPerRow` and `approxTokens` lower on `compact`. If `rowsReturned` differs, the comparison is unfair. See [§17 Test 8](#per-call-compact-vs-json-comparison-v921).

---

### `adv_get_all_tcm_test_cases_with_root_suite_id`

**Prompt 1 — With root suite info**
> Get all test cases in the Web project, and for each one, include which root suite it belongs to.

**Expected:** Returns test cases enriched with `rootSuiteId` information for categorization.

**Prompt 2 — Count only** *(v6.6.0)*
> How many test cases are in the Android project? Just the count, skip the hierarchy enrichment.

**Expected:** Uses `count_only: true`. Paginates to count but skips suite hierarchy processing for speed. Returns `{total_count: N}`.

---

### `adv_get_root_id_by_suite_id`

**Prompt 1 — Resolve root**
> What is the root suite for suite ID 150 in the Android project?

**Expected:** Returns the root (top-level) suite ID that contains suite 150.

---

### `adv_get_test_cases_by_suite_smart`

**Prompt 1 — Auto-detect suite type**
> Get all test cases in suite 42 of the iOS project, including sub-suites.

**Expected:** Auto-detects whether 42 is a root or child suite, then fetches test cases from it and all sub-suites.

**Prompt 2 — Single suite only**
> Get test cases ONLY in suite 42 of the Android project (no sub-suites).

**Expected:** Uses `include_sub_suites: false` to return only direct children of suite 42.

**Prompt 3 — Count only** *(v6.6.0)*
> How many test cases are in suite 42 of the iOS project, including sub-suites? Just the count.

**Expected:** Uses `count_only: true`. Auto-detects suite type, builds filter, and paginates to count without returning test case data. Returns `{total_count: N, suite_name: "...", is_root_suite: true/false}`.

**Prompt 4 — Fair compact vs json A/B** *(v9.2.1)*
> Pick one suite in the MCP project with a decent number of cases. Call `adv_get_test_cases_by_suite_smart` twice for that suite with `project_key: "MCP"`, `detail=summary`, `get_all=true`, `include_call_metrics=true` — first `format=json`, then `format=compact`. Compare only the `_mcp_metrics` footers: `rowsReturned`, `responseChars`, `approxTokens`, `bytesPerRow`. Confirm compact used fewer chars/tokens per row; if `rowsReturned` differs, say why the comparison is unfair.

**Expected:** Equal `rowsReturned`; compact wins on `bytesPerRow`. See [§17 Test 9](#per-call-compact-vs-json-comparison-v921).

---

### `adv_validate_test_case`

**Prompt 1 — Quality check**
> Validate test case IOS-200 against quality standards and suggest improvements.

**Expected:** Runs validation rules, generates quality score, and provides improvement suggestions in markdown.

**Prompt 2 — Verify system vs custom field handling** *(v6.5.3)*
> Validate test case ANDROID-300. Make sure the "Manual Only" custom field is detected correctly even if the project uses a different field name.

**Expected:** Validator dynamically discovers the "Manual Only" field from the project's fields layout instead of hardcoding the API key. Validation result includes the `manualOnly` value if the field exists.

---

### `adv_improve_test_case`

**Prompt 1 — Auto-improve**
> Analyze and improve test case ANDROID-300 with automatic high-confidence fixes.

**Expected:** Analyzes the test case, suggests improvements, and applies high-confidence changes automatically.

---

### `adv_aggregate_test_cases_by_feature`

**Prompt 1 — Feature search**
> Find all test cases related to "payment" in the Web project, grouped by root suite.

**Expected:** Searches title, body, and steps for "payment", returns grouped results by root suite.

**Prompt 2 — Test run rules format**
> Find all test cases related to "login" in the Android project and output in test_run_rules format.

**Expected:** Returns results formatted for test run rule configuration.

---

## 2. Launch / Reporting Tools

### `adv_get_launch_details`

**Prompt 1 — Full launch info**
> Get the full details for the latest Android launch including all test sessions.

**Expected:** Returns launch metadata, test sessions with durations, pass/fail counts, and environment info.

**Prompt 2 — Jenkins job parameters (v9.1.0)**
> Get launch details for launch 132452 in the Android project with job parameters included.

**Expected:** Uses `includeJobParameters: true`. Returns Jenkins Build Now parameters from the launch's job record (for use with `adv_start_launch` template resolution). Does not apply to Launch Launchers.

---

### `adv_rerun_launch_failures` *(v9.1.0)*

**Prompt 1 — Single launch preview**
> Preview rerunning failures for launch 132522 in the Android project.

**Expected:** Returns preview table with failed/aborted count and confirmation token. Does not POST until `confirm: true`.

**Prompt 2 — Batch by milestone**
> Rerun failed tests for the latest launches in milestone 26.19.0 for Android, max 5 launches.

**Expected:** Batch mode without `launch_id`. Filters by milestone, caps at `max_launches: 5`, preview then confirm.

---

### `adv_start_launch` *(v9.1.0)*

**Prompt 1 — Build Now preview**
> Preview Build Now for Android regression using template launch 132452, build 50977.

**Expected:** Resolves Jenkins template launch, merges parameters, shows preview with confirmation token. Does not trigger CI until confirmed.

**Prompt 2 — With test_run_rules**
> Preview adv_start_launch for Android with test_run_rules TAGS=>featureSuiteId=12345;; and suite_path from recent Minimal Acceptance launch.

**Expected:** Merges `test_run_rules` into job parameters. If locale ≠ en_US and `localeTestRunRules` enabled for project, preview warns about en_US-only suite exclusions.

---

### `adv_get_launch_test_summary`

**Prompt 1 — Summary statistics**
> Get a test summary for the latest iOS launch. Just give me the statistics.

**Expected:** Returns pass/fail/skip counts, pass rate, total duration using `summaryOnly: true`.

**Prompt 2 — Failed tests sorted by stability**
> Get the test summary for the latest Web launch. Show only failed tests sorted by stability.

**Expected:** Uses `statusFilter: ['FAILED']`, `sortBy: 'stability'` to return failed tests ordered by flakiness.

**Prompt 3 — Count only**
> How many tests ran in launch 119783 of the MCP project? Just give me the total and per-status breakdown.

**Expected:** Uses `count_only: true`. Fetches all test runs but skips session resolution and JIRA URL lookups. Returns `{total_count: N, filtered_count: N, by_status: {PASSED: X, FAILED: Y, ...}}`.

**Prompt 4 — Manual pass / known issue union**
> For launch 134978, how many tests were passed manually, have known issues assigned, or match either condition?

**Expected:** Uses `includeDetailedStatuses: true` with `count_only: true` (or `summaryOnly: true`). Returns separate launch-source buckets and a test-run-source `manualAndKnownIssue` block containing `passedManually`, `knownIssue`, `bothConditions`, and deduplicated `eitherCondition` counts. Message text does not override the API booleans.

---

### `adv_generate_weekly_regression_stability_report`

**Prompt 1 — Compare two builds**
> Generate a weekly regression stability report for the Android project comparing the current build to the previous one.

**Expected:** Produces a formatted report (default: Jira-ready) showing pass rate deltas, suite-level comparison, and status indicators.

**Prompt 2 — Count only (build pre-check)**
> How many suites will be matched for the Android project comparing build 49117 vs 48886? Don't generate the full report.

**Expected:** Uses `count_only: true` with `builds`. Resolves launches from build identifiers, returns `{suites_found: N, matched_suites: M}` without generating the comparison report.

---

### `adv_regression_results_analyzer`

**Prompt 1 — Full milestone analysis**
> Analyze regression results for iOS milestone 26.19.0 and compare with the previous milestone.

**Expected:** Calls `adv_regression_results_analyzer` with `project: "ios"`, `milestone: "26.19.0"`, auto-detects or passes `previous_milestone`. Returns a multi-section report: summary table, per-run overview with coverage indicators, new bugs, top bugs, bugs per suite, and slowest tests.

**Prompt 2 — Detailed format with explicit previous milestone**
> Show regression analysis in detailed format for milestone "26.19.0 RC - 73614" in the iOS project, comparing bugs with previous milestone "26.18.0 RC - 73213". Include top 10 bugs and top 10 slowest tests.

**Expected:** Uses `output_format: "detailed"`, `top_bugs_limit: 10`, `slowest_tests_limit: 10`, `previous_milestone: "26.18.0 RC - 73213"`. Returns comprehensive report with clickable Jira links for all bugs.

**Prompt 3 — Count only (scope pre-check)**
> How many test runs are in milestone 26.19.0 for iOS? Just give me the count.

**Expected:** Uses `count_only: true`. Returns `{total_runs: N, total_test_cases: M}` without generating the full analysis.

---

### `adv_get_launch_summary`

**Prompt 1 — Quick overview**
> Give me a quick summary of the latest iOS launch.

**Expected:** Returns launch name, environment, status, duration, and pass/fail counts without detailed test sessions.

---

### `adv_analyze_regression_runtime`

**Prompt 1 — Runtime with baseline comparison**
> Analyze the regression runtime for the Android platform. Compare the current milestone to the previous one and flag any tests that got slower by more than 20%.

**Expected:** Returns average runtime per test, WRI, duration distribution (short/medium/long), and delta vs baseline.

**Prompt 2 — With custom thresholds**
> Analyze regression runtime for iOS with custom thresholds: medium = 3 minutes, long = 8 minutes.

**Expected:** Uses `medium_threshold_seconds: 180`, `long_threshold_seconds: 480` for custom duration classification.

---

### `adv_get_all_launches_for_project`

**Prompt 1 — Recent launches**
> Show me the 10 most recent launches for the Web project.

**Expected:** Returns paginated list of launches with names, dates, and status.

**Prompt 2 — Count only**
> How many total launches are in the Android project? Just the count.

**Expected:** Uses `count_only: true`. Single API call with `pageSize=1`, returns `{total_count: N}` from `_meta.total`.

---

### `adv_get_all_launches_with_filter`

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

### `adv_get_platform_results_by_period`

**Pass-rate views (v9.2.4):** `view` selects the dashboard widget template — `pie` (8, default), `line` (5), `bar` (3), `calendar` (90), `pie_line` (17), `summary` (14). Optional: `group_by` (bar/summary), `grouping_period` (line/pie_line), `passed_value_threshold` (calendar). Omitting `view` keeps pre-v9.2.4 pie behavior (template 8, Last 7 Days default).

**Prompt 1 — Last 7 days (default pie)**
> Get test results by platform for the Android project over the last 7 days.

**Expected:** `view: pie` (implicit), template 8. Returns pass/fail/skip statistics and pass rate percentage.

**Prompt 2 — Custom period**
> Get test results for the Web project for the last 30 days.

**Expected:** Uses `period: "Last 30 Days"` to return monthly aggregated results.

**Prompt 3 — Bar chart by priority (template 3)**
> Show pass rate broken down by priority for the iOS project over the last 14 days as a bar chart.

**Expected:** `view: "bar"`, `group_by: "PRIORITY"` (default when omitted). Template 3 widget SQL.

**Prompt 4 — Daily trend line (template 5)**
> Daily pass and fail counts for Android over the last 14 days as a trend line.

**Expected:** `view: "line"`, `grouping_period: "DAY"`. Columns `STARTED_AT`, `PASSED`, `FAILED`.

**Prompt 5 — Calendar heatmap (template 90)**
> Calendar heatmap of daily pass rate for Web in 2026 Q2; flag days below 75%.

**Expected:** `view: "calendar"`, `period: "2026-Q2"`, `passed_value_threshold: 75`.

**Prompt 6 — Tests summary table (template 14)**
> Summarize passed, failed, and total tests grouped by build for Android over the last 7 days.

**Expected:** `view: "summary"`, `group_by: "BUILD"`.

**Prompt 7 — Pie + line combo (template 17)**
> Combined pass-rate pie and daily trend for iOS over the last 14 days.

**Expected:** `view: "pie_line"`, `grouping_period: "DAY"`.

**Prompt 8 — Dynamic period (v9.2.2+)**
> Pass rate for iOS from start of last month through today using a dynamic widget period.

**Expected:** `period_mode: "dynamic"`, expressions like `START_OF_MONTH -1 MONTH` → `TODAY`; still `view: pie` unless another view is requested.

---

### `adv_get_project_milestones`

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

### `adv_get_test_coverage_by_test_case_steps_by_key`

**Prompt 1 — Full coverage analysis**
> Analyze the test coverage of test case ANDROID-100 against its implementation. The test covers the login flow including username entry, password entry, and submit.

**Expected:** Returns step-by-step coverage analysis with recommendations for gaps.

---

### `adv_generate_draft_test_by_key`

**Prompt 1 — Auto-detect framework**
> Generate draft test code for test case IOS-200. The implementation uses a mobile testing framework for iOS app testing.

**Expected:** Auto-detects the framework and generates test code with setup/teardown and assertion templates.

---

### `adv_get_enhanced_test_coverage_with_rules`

**Prompt 1 — With rules validation**
> Analyze test coverage for WEB-50 with rules validation enabled. The test covers the checkout page flow.

**Expected:** Returns coverage analysis with quality scoring and rules-based validation results.

---

### `adv_analyze_test_failure`

**Prompt 1 — Forensic analysis**
> Analyze the failure for the latest failed test in the Android launch. Include screenshots and logs.

**Expected:** Returns root cause analysis with screenshot annotations, log excerpts, and similar failure patterns.

**Prompt 2 — Compare with last passed**
> Analyze the test failure and compare it with the last time this test passed. What changed?

**Expected:** Uses `compareWithLastPassed: { enabled: true }` to show diff between passing and failing executions.

---

### `adv_get_test_execution_history`

**Prompt 1 — Pass/fail trend**
> Show the execution history for this test across the last 10 launches. What is its pass rate?

**Expected:** Returns chronological pass/fail history with overall pass rate and stability assessment.

> **Note:** For TCM-level execution history (including manual test runs), use `adv_get_test_case_by_key` with `include_execution_history: true` instead. The `adv_get_test_execution_history` tool is for launch-level automated test history.

**Prompt 2 — Count only**
> What is the pass rate and execution count for this test? Just the numbers, no history details.

**Expected:** Uses `count_only: true`. Returns `{total_executions: N, passed: X, failed: Y, pass_rate: "Z%"}` without formatted per-execution output.

---

### `adv_download_test_screenshot`

**Prompt 1 — Download screenshot**
> Download the screenshot for the failed test and save it locally.

**Expected:** Downloads screenshot from Zebrunner with authentication and saves to specified path.

---

### `adv_analyze_screenshot`

**Prompt 1 — Visual analysis**
> Analyze the screenshot from the last failed iOS test. What UI elements are visible? Is there an error message?

**Expected:** Returns visual analysis using Claude Vision with element identification and error detection.

---

### `adv_analyze_test_execution_video`

**Prompt 1 — Failure-focused video analysis**
> Analyze the execution video for the failed Android test, focusing on the failure moment.

**Expected:** Extracts frames around the failure, performs visual analysis, and correlates with test logs.

---

### `adv_detailed_analyze_launch_failures`

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

### `adv_get_top_bugs`

**Prompt 1 — Top 10 defects**
> What are the top 10 most frequent bugs in the iOS project over the last 30 days?

**Expected:** Returns ranked list of defects by frequency with failure counts and optional Jira links.

**Prompt 2 — With issue links**
> Show the top 5 bugs for the Android project in the last 7 days with Jira links.

**Expected:** Returns bugs with clickable Jira issue URLs using the `issueUrlPattern` parameter.

---

### `adv_get_bug_review`

**Prompt 1 — Detailed bug review**
> Give me a detailed bug review for the Web project covering the last 14 days.

**Expected:** Returns bugs with failure counts, reproduction dates, and defect categorization.

---

### `adv_get_bug_failure_info`

**Prompt 1 — Specific bug deep-dive**
> Get detailed failure information for a specific bug hashcode in the Android project.

**Expected:** Returns failure summary, affected test runs, and reproduction details for the specific defect.

---

### `adv_get_test_case_distribution_by_field` *(v9.2.3 — TCM widget 37780)*

**Prompt 1 — Automation state pie**
> Show test case distribution by automation state for the Android project as a pie breakdown.

**Expected:** Calls `adv_get_test_case_distribution_by_field` with `system_field: "AUTOMATION_STATE"`. Returns label/count/% table (or pie chart when `chart` is set). Not a paginated case list.

**Prompt 2 — Priority field by display name**
> Get the dashboard-style test case distribution by Priority field for the iOS project.

**Expected:** Resolves "Priority" via fields-layout. Returns counts per priority value with percentages.

**Prompt 3 — Scoped to a root suite**
> Show automation state distribution for test cases under root suite 42 in the Web project, including all subsuites.

**Expected:** Uses `root_suite_ids: [42]` with descendant expansion. Summary includes `suiteFilter.count`.

---

### `adv_get_tcm_case_analytics` *(v9.2.4 — TCM widgets 37777–37779)*

**Modes:** `net_change` | `created_by_user` | `updated_by_user`

**Prompt 1 — Net case change (37777)**
> Show net change in test case count for the Android project over the last 90 days, grouped by week.

**Expected:** `mode: "net_change"`, `grouping_period: "Week"`. Rows include period boundaries and case counts — not a paginated case list.

**Prompt 2 — Created by user (37779)**
> Which authors created the most new test cases on iOS in the last 30 days?

**Expected:** `mode: "created_by_user"`. TCM widget `test-cases-created-by-user`.

**Prompt 3 — Updated by user (37778)**
> Who updated the most test cases on the Web project in the last 30 days?

**Expected:** `mode: "updated_by_user"`. TCM widget `test-cases-updated-by-user`.

**Prompt 4 — Do not confuse with distribution**
> TCM net change widget for Android — use case analytics net_change, NOT distribution-by-field pie.

**Expected:** `adv_get_tcm_case_analytics`, not `adv_get_test_case_distribution_by_field`.

---

### `adv_get_failure_analytics` *(v9.2.4 — templates 40112, 55991, 57086)*

**Modes:** `tag_distribution` | `tags_by_maintainer` | `jira_by_maintainer`

**Prompt 1 — Failure tag pie (40112)**
> Pie chart of failure tags by test count on Android in the last 24 hours.

**Expected:** `mode: "tag_distribution"`. Columns `tag`, `tests_count`. Not `adv_get_top_bugs` (template 4).

**Prompt 2 — Tags × maintainer (55991)**
> Cross-tab of failure tags and maintainers for iOS today.

**Expected:** `mode: "tags_by_maintainer"`. Columns `tag`, `username`, `tests_count`.

**Prompt 3 — Jira × maintainer (57086)**
> Map Jira issues to maintainers by failure count on Web for the last 14 days.

**Expected:** `mode: "jira_by_maintainer"`. Columns `ISSUES`, `MAINTAINER`, `COUNT`.

---

### `adv_get_execution_analytics` *(v9.2.4 — templates 1, 131, 57085, 16)*

**Modes:** `roi` | `duration_trend` | `launch_duration` | `stability_table`

**Prompt 1 — Execution ROI (1)**
> What is the execution ROI (time saved vs manual effort) for the Android project over the last 7 days?

**Expected:** `mode: "roi"`. Template 1; columns include `TIME` or `STARTED_AT`.

**Prompt 2 — Duration trend (131)**
> Daily test execution duration trend for Android over the last 7 days.

**Expected:** `mode: "duration_trend"`. Column `TESTED_AT`; empty array valid when no executions match.

**Prompt 3 — Launch duration (57085)**
> Launch duration trend for suite "Regression" on iOS this quarter.

**Expected:** `mode: "launch_duration"`, optional `run` filter with suite/run name. Not `adv_analyze_regression_runtime`.

**Prompt 4 — Stability table (16)**
> Which tests fell below 99% stability on Web in the last 24 hours?

**Expected:** `mode: "stability_table"`, `stability_threshold: 99`. Not `adv_find_flaky_tests` (flip-flop detection).

### `adv_get_test_authoring_trend` *(v9.2.5 — TAM widget template 7)*

**Prompt 1 — Daily trend**
> How many test cases were created per day on the Web project over the last 14 days?

**Expected:** Template 7 widget SQL; `grouping_period: "DAY"`. Rows `CREATED_AT`, `AMOUNT`. Not TCM net-change (37777) or distribution pie (37780).

**Prompt 2 — Weekly buckets**
> Show test case authoring velocity for Android this quarter grouped by week.

**Expected:** `period: "Quarter"`, `grouping_period: "WEEK"`.

**Prompt 3 — Do not confuse with net change**
> TC development trend for iOS — use authoring trend widget, NOT adv_get_tcm_case_analytics net_change.

**Expected:** `adv_get_test_authoring_trend`, not hub TCM analytics.

**Prompt 4 — Absolute period (v9.2.2+)**
> Test case creation trend for Web from 2026-07-01 through 2026-07-09 using period_mode absolute.

**Expected:** `period_mode: "absolute"`, `period_start_date`, `period_end_date`. Eval cloud prompt: `authoring.period.absolute`.

---

## 4. Utility / Connection Tools

### `adv_test_reporting_connection`

**Prompt 1 — Connection check**
> Test the connection to the Zebrunner Reporting API.

**Expected:** Authenticates via Bearer token (JWT refresh) and confirms connection status.

---

### `adv_about_mcp_tools`

**Prompt 1 — Tool summary (default)**
> Give me a summary of all available Zebrunner MCP tools.

**Expected:** Returns categorized list of all 69 tools with brief descriptions. The summary footer includes "Additional MCP Capabilities" with prompt and resource counts.

**Prompt 2 — Specific tool details**
> Show me detailed info for the adv_analyze_regression_runtime tool with examples.

**Expected:** Returns full parameter documentation, usage examples, and approximate token estimates.

**Prompt 3 — List all prompts** *(v7.2.2)*
> What prompts are available in Zebrunner MCP? Use mode "prompts".

**Expected:** Returns a table of all 13 `/prompts` grouped by category (E2E Metrics, Analysis, Role-Specific) with titles, descriptions, and accepted arguments.

**Prompt 4 — List all resources** *(v7.2.2)*
> What MCP resources are available? Use mode "resources".

**Expected:** Returns two tables: 5 static resources (no parameters) and 8 template resources (require project_key) with URIs and descriptions.

**Prompt 5 — Session tool metrics** *(v7.2.2)*
> Show me tool usage metrics for this session. Use mode "metrics".

**Expected:** Returns a markdown table with per-tool call counts, average/min/max durations, total response sizes, and error counts for all tools invoked in the current MCP session. If no tools have been called yet, shows "No tool calls recorded in this session." The output starts with the MCP version header.

**Prompt 6 — Quick token check workflow** *(v7.2.2)*
> First list all projects, then show me the tool metrics.

**Expected:** After `adv_get_available_projects` returns data, the second call with `mode: "metrics"` shows at least 1 tool call recorded (`adv_get_available_projects` with its duration and response size).

---

### `adv_get_available_projects`

**Prompt 1 — List all projects**
> What projects are available in Zebrunner?

**Expected:** Returns list of projects with keys and IDs for use in other tools.

---

## 5. Test Run Management Tools

### `adv_list_test_runs`

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

### `adv_get_test_run_by_id`

**Prompt 1 — Run details**
> Get the details for test run #42 in the Web project.

**Expected:** Returns full test run info including name, milestone, build, environment, and execution summary.

---

### `adv_list_test_run_test_cases`

**Prompt 1 — Cases in a run**
> List all test cases included in test run #42 of the Android project.

**Expected:** Returns test cases with their result status, assignee, and configuration.

---

### `adv_get_test_run_result_statuses`

**Prompt 1 — Available statuses**
> What result statuses are configured for the iOS project?

**Expected:** Returns list of available statuses (e.g., Passed, Failed, Skipped, Blocked) with their IDs.

---

### `adv_get_test_run_configuration_groups`

**Prompt 1 — Configuration options**
> What configuration groups and options are available for the Web project?

**Expected:** Returns configuration groups (e.g., Browser, OS, Device) with their option values.

---

## 6. Duplicate Analysis Tools

### `adv_analyze_test_cases_duplicates`

**Prompt 1 — Step similarity**
> Analyze test cases in the iOS project for duplicates using 80% step similarity threshold.

**Expected:** Returns groups of similar test cases with similarity scores and step comparison details.

**Prompt 2 — Within a suite**
> Check for duplicate test cases in suite 42 of the Android project.

**Expected:** Uses `suite_id` to scope the analysis to a specific suite.

---

### `adv_analyze_test_cases_duplicates_semantic`

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

**Expected tools:** `adv_get_all_launches_with_filter` to find launches by milestone, then `adv_get_launch_test_summary` or `adv_get_launch_details` for each launch to collect pass/fail counts. For known issues, look at `KNOWN_ISSUE` status. Aggregate across all suites per platform.

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

**Expected tools:** `adv_analyze_regression_runtime` called 3 times (once per platform) with `previous_milestone` for baseline comparison.

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

**Expected tools:** `adv_get_automation_states` to discover state IDs, then `adv_get_test_cases_by_automation_state` with `get_all: true, count_only: true` for efficient total counts per state. For total excluding deprecated/draft: `adv_get_all_tcm_test_cases_by_project` with `exclude_deprecated: true, count_only: true`. For 30-day window counts: `adv_get_test_case_by_filter` with `created_after, get_all: true, count_only: true`. The `count_only` flag avoids the 1MB MCP response limit on large projects.

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

**Expected tools:** Combination of `adv_get_launch_test_summary`, `adv_analyze_regression_runtime`, `adv_get_top_bugs`, `adv_get_automation_states` + `adv_get_test_cases_by_automation_state` with `count_only: true` for coverage metrics, and `adv_get_test_execution_history` for flaky test detection.

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

**Expected tools:** `adv_get_all_launches_with_filter` + `adv_get_launch_test_summary` for pass rate, `adv_detailed_analyze_launch_failures` for unlinked failures, `adv_analyze_regression_runtime` with baseline comparison, `adv_get_test_cases_by_automation_state` with `count_only: true` for coverage percentage, `adv_get_top_bugs` for defect patterns.

**Expected output:** Structured assessment with per-check status, evidence, and a clear Go/No-Go recommendation.

---

## 8. Flaky Test Detection

### `adv_find_flaky_tests`

**Prompt 1 — Basic flaky scan** *(v6.6.0)*
> Find flaky tests in the Android project over the last 14 days.

**Expected:** Uses `adv_find_flaky_tests` with `project: "android"`, `period_days: 14`. Returns a list of tests that flipped pass/fail at least 2 times, sorted by flip count. Includes automated tests from launch analysis and manual-only tests from TCM execution history.

**Prompt 2 — Count only** *(v6.6.0)*
> How many flaky tests are there in the Web project? Just the count.

**Expected:** Uses `count_only: true`. Returns only the count from Phase 1 (automated flaky detection via launch scan), skipping Phases 2 and 3.

**Prompt 3 — With execution history** *(v6.6.0)*
> Find flaky tests in the iOS project over the last 30 days with execution history included. Format as Jira markup.

**Expected:** Uses `include_history: true`, `period_days: 30`, `format: "jira"`. Returns flaky tests with per-test timeline showing date, status, type (MANUAL/AUTOMATED), and launch ID.

**Prompt 4 — Chart output** *(v6.6.0)*
> Show me a chart of the top flaky tests in the Android project.

**Expected:** Uses `chart: "png"` (or the LLM selects an appropriate format). Returns a bar chart visualization of the top flaky tests sorted by flip count.

---

## 9. Chart Visualization

### Chart output on existing tools

**Prompt 1 — Pie chart of test status** *(v6.6.0)*
> Show me a pie chart of test results for launch 120806 in the Android project.

**Expected:** Uses `adv_get_launch_test_summary` with `chart: "png"`. Returns a PNG pie chart showing passed/failed/skipped distribution.

**Prompt 2 — Bar chart of suite stability** *(v6.6.0)*
> Generate a chart comparing suite pass rates for the weekly regression stability report on build 49117 vs 48886 in the MCP project.

**Expected:** Uses `adv_generate_weekly_regression_stability_report` with `chart: "png"`. Returns a bar chart of suite pass rates.

**Prompt 3 — Stacked bar of launch results** *(v6.6.0)*
> Show me a chart of launch results for the Web project.

**Expected:** Uses `adv_get_all_launches_for_project` with `chart: "png"`. Returns a stacked bar chart showing passed/failed/skipped per launch.

**Prompt 4 — Line chart of test execution history** *(v6.6.0)*
> Chart the execution history for test 5451420 in launch 120806 of the MCP project.

**Expected:** Uses `adv_get_test_execution_history` with `chart: "png"`. Returns a line chart showing pass/fail trend and duration over executions.

**Prompt 5 — Text chart fallback** *(v6.6.0)*
> Show me the top bugs for the Android project as a text chart.

**Expected:** Uses `adv_get_top_bugs` with `chart: "text"`. Returns an ASCII/markdown horizontal bar chart of bug failure counts.

**Prompt 6 — HTML interactive chart** *(v6.6.0)*
> Give me an interactive HTML chart of platform results for the last 7 days.

**Expected:** Uses `adv_get_platform_results_by_period` with `chart: "html"`. Returns a self-contained HTML page with Chart.js for interactive stacked bar visualization.

**Prompt 7 — Pie chart override** *(v6.6.0)*
> Show me a pie chart of test results for launch 120806 in the Android project.

**Expected:** Uses `adv_get_launch_test_summary` with `chart: "png"`, `chart_type: "pie"`. Returns a PNG pie chart of passed/failed/skipped distribution.

**Prompt 8 — Bar chart override on pie-default tool** *(v6.6.0)*
> Give me a bar chart breakdown of test run statuses for run 456 in the Web project.

**Expected:** Uses `adv_get_test_run_by_id` with `chart: "png"`, `chart_type: "bar"`. Overrides the default pie chart with a vertical bar chart.

**Prompt 9 — Pie chart for platform results** *(v6.6.0)*
> Show me a pie chart of platform test results for the Web project over the last 7 days.

**Expected:** Uses `adv_get_platform_results_by_period` with `chart: "png"`, `chart_type: "pie"`. Overrides the default stacked bar with a pie chart.

## 10. Field-Path Filtering

### Filtering test cases by custom fields and nested properties

**Prompt 1 — Custom field exact match** *(v6.6.0)*
> Get all test cases in the MCP project where the custom field 'manualOnly' equals 'Yes'.

**Expected:** Uses `adv_get_test_cases_advanced` with `field_path: "customField.manualOnly"`, `field_value: "Yes"`, `field_match: "exact"`. Paginates all test cases and applies client-side filtering. Returns only test cases where the manualOnly custom field is "Yes".

**Prompt 2 — Nested field filtering** *(v6.6.0)*
> Find all High priority test cases in the MCP project.

**Expected:** Uses `adv_get_test_cases_advanced` or `adv_get_test_case_by_filter` with either the RQL priority filter or `field_path: "priority.name"`, `field_value: "High"`, `field_match: "exact"`.

**Prompt 3 — Count with field filter** *(v6.6.0)*
> How many manual-only test cases are in the MCP project?

**Expected:** Uses `adv_get_test_cases_advanced` with `field_path: "customField.manualOnly"`, `field_value: "Yes"`, `count_only: true`. Returns the count of matching test cases without full payloads.

**Prompt 4 — Title contains** *(v6.6.0)*
> Find all test cases in MCP whose title contains 'login'.

**Expected:** Uses `adv_get_test_cases_advanced` or `adv_get_test_case_by_filter` with `field_path: "title"`, `field_value: "login"`, `field_match: "contains"`.

**Prompt 5 — Check if custom field exists** *(v6.6.0)*
> Show me which test cases in MCP have a 'testrailId' custom field defined.

**Expected:** Uses `adv_get_test_cases_advanced` with `field_path: "customField.testrailId"`, `field_match: "exists"`. Returns test cases where the field is present and non-null.

**Prompt 6 — Mixed filters** *(v6.6.0)*
> In MCP, get all automated test cases from suite 491 where customField.manualOnly is 'No'.

**Expected:** Uses `adv_get_test_case_by_filter` with `suite_id`, `automation_state`, and `field_path: "customField.manualOnly"`, `field_value: "No"`, `field_match: "exact"`. RQL filters are applied server-side, then field-path filtering is applied client-side on the results.

## 11. Reports (adv_generate_report)

### Universal report generator — 6 report types

**Prompt 1 — Quality dashboard** *(v6.7.0)*
> Generate a quality dashboard for Android and iOS for the last 30 days.

**Expected:** Uses `adv_generate_report` with `report_types: ["quality_dashboard"]`, `projects: ["android", "ios"]`, `period: "Last 30 Days"`. Returns Markdown summary with PNG charts for all 6 sections plus a self-contained HTML dashboard.

**Prompt 2 — Coverage report** *(v6.7.0)*
> Build a test coverage report for all three platforms.

**Expected:** Uses `adv_generate_report` with `report_types: ["coverage"]`, `projects: ["android", "ios", "web"]`. Returns per-suite coverage tables for each platform with Implemented, Manual Only, Deprecated, Total, Coverage %, TOTAL and TOTAL REGRESSION rows.

**Prompt 3 — Pass rate report** *(v6.7.0)*
> Show pass rate for Android, iOS, and Web for milestone 25.40.0.

**Expected:** Uses `adv_generate_report` with `report_types: ["pass_rate"]`, `projects: ["android", "ios", "web"]`, `milestone: "25.40.0"`. Returns per-platform pass rate table with known-issue exclusion, target comparison, and PNG chart.

**Prompt 4 — Runtime efficiency with delta** *(v6.7.0)*
> Compare runtime efficiency for all platforms between milestone 25.40.0 and previous 25.39.0.

**Expected:** Uses `adv_generate_report` with `report_types: ["runtime_efficiency"]`, `projects: ["android", "ios", "web"]`, `milestone: "25.40.0"`, `previous_milestone: "25.39.0"`. Returns current metrics, delta table, and degradation alerts for long-running tests.

**Prompt 5 — Executive dashboard** *(v6.7.0)*
> Generate an executive QA dashboard for all three platforms on the latest milestone.

**Expected:** Uses `adv_generate_report` with `report_types: ["executive_dashboard"]`, `projects: ["android", "ios", "web"]`. Returns standup-ready summary with pass rate, runtime, top 5 bugs, coverage, flaky tests, plus HTML dashboard.

**Prompt 6 — Release readiness** *(v6.7.0)*
> Assess release readiness for Android on milestone 25.40.0 compared to 25.39.0.

**Expected:** Uses `adv_generate_report` with `report_types: ["release_readiness"]`, `projects: ["android"]`, `milestone: "25.40.0"`, `previous_milestone: "25.39.0"`. Returns per-check PASS/FAIL/WARN status table and Go/No-Go recommendation.

**Prompt 7 — Multiple reports combined** *(v6.7.0)*
> Generate coverage and pass rate reports together for all platforms.

**Expected:** Uses `adv_generate_report` with `report_types: ["coverage", "pass_rate"]`, `projects: ["android", "ios", "web"]`. Returns both reports concatenated with separators.

**Prompt 8 — Custom pass rate targets** *(v6.7.0)*
> Generate a pass rate report for Android, iOS, and Web with custom targets: Android 95%, iOS 90%, Web 70%.

**Expected:** Uses `adv_generate_report` with `report_types: ["pass_rate"]`, `targets: {"android": 95, "ios": 90, "web": 70}`. Pass rate shows custom target comparison.

## 12. Suite Coverage Report

### Automation coverage breakdown by suite across platforms

**Prompt 1 — Multi-platform suite coverage table** *(v6.6.0)*
> Build a test coverage table for all platforms (Android, iOS, Web).
>
> For each platform:
> 1. Get all test suites
> 2. Get automation states to check if "Manual Only" is an automation state
> 3. For each suite, collect counts using count_only: true, get_all: true:
>    - Implemented: automation state = "Automated"
>    - Manual Only:
>      * If "Manual Only" automation state exists: use adv_get_test_cases_by_automation_state
>      * Otherwise: use adv_get_test_cases_advanced with field_path "customField.manualOnly", field_value "Yes", field_match "exact"
>    - Deprecated: filter deprecated = true
>    - Total: all test cases in the suite
>    - Coverage % = Implemented / (Total - Manual Only - Deprecated) × 100
>
> Present one table per platform (show platform name like "Android", "iOS", "Web"):
>
> | Suite Name | Implemented | Manual Only | Deprecated | Total | Coverage % |
>
> For each platform add:
> - TOTAL row: sum all suites
> - TOTAL REGRESSION row: sum only regression suites (exclude suites like MA, Minimal Acceptance, Critical, Performance, or any non-regression suite)

**Expected:** The LLM should:
1. Call `adv_get_automation_states` per platform to discover whether "Manual Only" is an automation state or a custom field
2. Call `adv_list_test_suites` per platform to get all suite names and IDs
3. For each suite, use `adv_get_test_cases_by_automation_state` with `count_only: true` for Implemented and Manual Only counts (or fall back to `adv_get_test_cases_advanced` with `field_path: "customField.manualOnly"` if "Manual Only" is not an automation state)
4. For Deprecated, use `adv_get_test_case_by_filter` with RQL filter `deprecated = true`, `count_only: true`
5. Present three tables (one per platform) with TOTAL and TOTAL REGRESSION summary rows

**Note:** "Manual Only" may exist as an automation state on some projects and as a custom field (`customField.manualOnly`) on others. The prompt handles both cases by checking automation states first.

## 13. Mutation Tools (Beta)

All mutation tools use a **two-step confirmation flow**: the first call returns a preview with a `confirmation_token`, and only after user approval does the second call with `confirm: true` execute the mutation. Created test cases are always forced to `draft: true` for safety.

**Next-step steering (v7.2.2):** After every successful mutation, the server appends a `Tip:` block suggesting the most logical follow-up action. This is inspired by the [Strands Agents steering pattern](https://strandsagents.com/blog/steering-accuracy-beats-prompts-workflows/) -- just-in-time guidance delivered at the moment the LLM needs it.

Hints are conditional:
- `adv_create_test_case` -- always shows draft/publish reminder; quality check hint is skipped if `review: true` was used.
- `adv_update_test_case` -- quality check hint is skipped if `review: true` was used.
- `adv_create_test_suite` -- always suggests adding test cases or creating sub-suites.
- `adv_manage_test_run` create -- always suggests populating the run or importing results.
- `adv_manage_test_run` add_cases -- always suggests importing results or viewing cases.
- `adv_import_launch_results_to_test_run` -- always suggests viewing updated statuses.

The `steeringHint()` helper in `src/helpers/steering.ts` is a pure, deterministic function tested by 25 unit tests in `tests/unit/steering-hints.test.ts`. Eval prompts for mutation tools include `expectedOutputPatterns` validating that the `Tip:` markers and suggested tool names appear in the response.

### `adv_create_test_case`

**Prompt 1 — Create with steps** *(v7.0.0)*
> Create a test case titled "Login flow — valid credentials" in suite 12345 of project MCP with these steps:
> 1. Open login page → Login form is displayed
> 2. Enter valid email and password → Credentials accepted
> 3. Click Submit → User redirected to dashboard

**Expected:** Uses `adv_create_test_case` with `project_key: "MCP"`, `test_suite_id: 12345`, `title`, `steps` (3 steps with `action` and `expectedResult`). Returns a preview with field summary and `confirmation_token`. Does NOT execute until user confirms.

**Prompt 2 — Copy from source** *(v7.0.0)*
> Copy test case MCP-5 into suite 12345 in project MCP.

**Expected:** Uses `adv_create_test_case` with `source_case_key: "MCP-5"`, `test_suite_id: 12345`, `project_key: "MCP"`. The source test case URL is prepended to the description automatically. The preview shows all fields inherited from the source. Returns `confirmation_token`.

**Prompt 3 — Full creation with all fields** *(v7.0.0)*
> Create a test case in project MCP, suite 12345:
> - Title: "Checkout flow — guest user"
> - Priority: High
> - Description: "Verifies guest checkout with credit card payment"
> - Pre-conditions: "Cart has at least one item. User is not logged in."
> - Steps: 1) Click Checkout → Checkout page shown, 2) Fill payment form → Form validates, 3) Submit → Order confirmation displayed
> - Requirements: JIRA PROJ-100

**Expected:** Uses `adv_create_test_case` with `project_key`, `test_suite_id`, `title`, `priority: { name: "High" }`, `description`, `pre_conditions`, `steps` (3), `requirements: [{ source: "JIRA", reference: "PROJ-100" }]`. Preview shows all fields to be set. `draft` is forced to `true` regardless of input.

**Prompt 4 — Draft enforcement** *(v7.2.2)*
> Create a test case titled "Smoke test" in suite 12345 of project MCP with draft set to false.

**Expected:** Uses `adv_create_test_case` with `draft: false`, but the preview shows `draft → true (forced for safety)`. The created test case is always a draft. The user must use `adv_update_test_case` to publish it.

### `adv_update_test_case`

**Prompt 1 — Update priority** *(v7.0.0)*
> Update test case MCP-10 in project MCP to change priority to Critical.

**Expected:** Uses `adv_update_test_case` with `identifier: "MCP-10"`, `project_key: "MCP"`, `priority: { name: "Critical" }`. Returns preview with field diff and `confirmation_token`. After confirmation, returns the updated record with a field-by-field diff.

**Prompt 2 — Update description and pre-conditions** *(v7.0.0)*
> Update test case MCP-10 in project MCP: set description to "Verifies the complete registration flow" and pre-conditions to "User is not logged in. Email is not registered."

**Expected:** Uses `adv_update_test_case` with `identifier: "MCP-10"`, `project_key: "MCP"`, `description`, `pre_conditions`. Only the specified fields are changed (PATCH semantics).

**Prompt 3 — Add steps (atomic replacement warning)** *(v7.0.0)*
> Replace all steps of test case MCP-10 in project MCP with: step 1 "Open app" → "App launches", step 2 "Tap login" → "Login screen shown".

**Expected:** Uses `adv_update_test_case` with `identifier: "MCP-10"`, `project_key: "MCP"`, `steps` (2 steps). The preview should warn that steps use ATOMIC replacement — all existing steps will be replaced.

**Prompt 4 — Publish a draft** *(v7.2.2)*
> Set test case MCP-33 in project MCP to draft: false so it becomes published.

**Expected:** Uses `adv_update_test_case` with `identifier: "MCP-33"`, `project_key: "MCP"`, `draft: false`. This is the intended way to publish test cases created via `adv_create_test_case`.

### `adv_create_test_suite`

**Prompt 1 — Create root suite** *(v7.0.0)*
> Create a new test suite called "Regression" in project MCP.

**Expected:** Uses `adv_create_test_suite` with `title: "Regression"`, `project_key: "MCP"`. Returns preview showing the suite will be created at root level (no parent). Returns `confirmation_token`.

**Prompt 2 — Create nested suite** *(v7.0.0)*
> Create a test suite named "Login Tests" under parent suite 12345 in project MCP.

**Expected:** Uses `adv_create_test_suite` with `title: "Login Tests"`, `project_key: "MCP"`, `parent_suite_id: 12345`. The preview shows the suite will be nested under the specified parent.

### `adv_update_test_suite`

**Prompt 1 — Rename suite** *(v7.0.0)*
> Rename test suite 12345 to "Smoke Tests" in project MCP.

**Expected:** Uses `adv_update_test_suite` with `suite_id: 12345`, `title: "Smoke Tests"`, `project_key: "MCP"`. Note: this is a PUT (full replacement) — `title` is always required.

**Prompt 2 — Move suite to root** *(v7.0.0)*
> Move test suite 12345 in project MCP to root level (remove its parent).

**Expected:** Uses `adv_update_test_suite` with `suite_id: 12345`, `project_key: "MCP"`, `title` (must be provided — fetch current title first if needed), `parent_suite_id` omitted or set to null. The suite becomes a root-level suite.

### `adv_manage_test_run`

**Prompt 1 — Create a test run** *(v7.2.2)*
> Use adv_manage_test_run to create a test run titled "Sprint 42 Regression" in project MCP.

**Expected:** Uses `adv_manage_test_run` with `action: "create"`, `project_key: "MCP"`, `title: "Sprint 42 Regression"`. Returns preview with title and empty configurations/requirements. Returns `confirmation_token`.

**Prompt 2 — Update a test run milestone** *(v7.2.2)*
> Use adv_manage_test_run to update test run 42 in project MCP. Change the milestone to "Release 3.0".

**Expected:** Uses `adv_manage_test_run` with `action: "update"`, `project_key: "MCP"`, `test_run_id: 42`, `milestone: { name: "Release 3.0" }`. Preview shows only the milestone field being changed.

**Prompt 3 — Add test cases to a run** *(v7.2.2)*
> Use adv_manage_test_run to add test cases MCP-1, MCP-2, and MCP-3 to test run 42 in project MCP.

**Expected:** Uses `adv_manage_test_run` with `action: "add_cases"`, `project_key: "MCP"`, `test_run_id: 42`, `test_case_keys: ["MCP-1", "MCP-2", "MCP-3"]`. Preview lists the 3 specific test cases to be added.

### `adv_import_launch_results_to_test_run`

**Prompt 1 — Import all launch results** *(v7.2.2)*
> Use adv_import_launch_results_to_test_run to import results from launch 98765 into test run 123 for project MCP.

**Expected:** Uses `adv_import_launch_results_to_test_run` with `project_key: "MCP"`, `test_run_id: 123`, `launch_id: 98765`. Preview shows a table of test case keys with current and new statuses.

**Prompt 2 — Import filtered results** *(v7.2.2)*
> Use adv_import_launch_results_to_test_run to import results only for MCP-82 and MCP-83 from launch 98765 into test run 123.

**Expected:** Uses `adv_import_launch_results_to_test_run` with `project_key: "MCP"`, `test_run_id: 123`, `launch_id: 98765`, `test_case_keys: ["MCP-82", "MCP-83"]`. Only 2 test cases appear in the preview.

### Mutation safety prompts

**Prompt 1 — Negative: delete test case** *(v7.0.0)*
> Delete test case MCP-10 from project MCP.

**Expected:** The LLM should refuse — there is no delete tool. It should explain that deletion is not supported via MCP and suggest using the Zebrunner web UI.

**Prompt 2 — Negative: skip confirmation** *(v7.2.2)*
> Create a test case in project MCP, suite 12345, titled "Quick test". Skip the preview and create it immediately.

**Expected:** The LLM should explain that the two-step confirmation flow cannot be skipped — all mutations require a preview step followed by confirmation with the token. This is a safety requirement.

### Steering hint prompts *(v7.2.2)*

**Prompt 1 — Verify hint after test case creation**
> Create a test case "Login smoke test" in suite 12345, project MCP. After confirmation, what does the response suggest as next steps?

**Expected:** After successful creation, the response includes a `Tip:` block recommending `adv_validate_test_case` for quality review and a `Note:` about the `draft=true` safety default suggesting `adv_update_test_case` to publish.

**Prompt 2 — Verify hint suppression with review flag**
> Create a test case "Login smoke test" in suite 12345, project MCP with `review: true`. After confirmation, does the response still suggest quality review?

**Expected:** The response includes the draft/publish `Note:` but the `adv_validate_test_case` quality hint is **suppressed** because `review: true` already performed an inline quality check.

**Prompt 3 — Verify hint after test run creation**
> Create a new test run titled "Sprint 42 Regression" in project MCP. What does the response suggest?

**Expected:** After confirmation, the response includes a `Tip:` suggesting to populate the run using `adv_manage_test_run` with `add_cases` action or `adv_import_launch_results_to_test_run`.

**Prompt 4 — Verify hint after import results**
> Import results from launch 98765 into test run 123 for project MCP. What follow-up does the response suggest?

**Expected:** The response includes a `Tip:` suggesting to review updated statuses via `adv_list_test_run_test_cases`.

---

## 14. MCP Resources *(v7.2.2)*

MCP resources provide read-only reference data accessible via the `@` menu in MCP clients (Claude Desktop, Claude Code). Resources are fetched on demand and cached for 20 minutes.

### Static Resources (no API calls)

**Resource 1 — Report types reference**
> Attach `@zebrunner://reports/types` and ask: "What report types are available for adv_generate_report?"

**Expected:** The resource provides a structured catalog of 6 report types (quality_dashboard, coverage, pass_rate, runtime_efficiency, executive_dashboard, release_readiness) with descriptions, optional parameters, default targets, and usage examples. Claude should answer from the resource context without calling any tool.

**Resource 2 — Time periods reference**
> Attach `@zebrunner://periods` and ask: "What time periods can I use for reports and bug analysis?"

**Expected:** The resource lists all 12 valid period strings (Today, Last 24 Hours, Week, Last 7 Days, etc.) with their day equivalents and which tools accept them. Claude should use exact period strings (e.g., "Last 30 Days" not "last 30 days") in subsequent tool calls.

**Resource 3 — Chart options reference**
> Attach `@zebrunner://charts` and ask: "Show me a pie chart of launch results."

**Expected:** The resource lists chart delivery formats (none, png, html, text) and chart types (auto, pie, bar, stacked_bar, horizontal_bar, line) with 17 supported tools. Claude should correctly use `chart: "png"`, `chart_type: "pie"` in the tool call.

**Resource 4 — Output format reference**
> Attach `@zebrunner://formats` and ask: "What format options are available for test case tools?"

**Expected:** The resource documents 5 format families (data, data_simple, raw_formatted, verbosity, metadata) with valid values per family and which tools use them.

### Dynamic Resources (cached API calls)

**Resource 5 — Available projects**
> Open the `@` menu and select `zebrunner://projects`.

**Expected:** Returns a JSON list of all Zebrunner projects accessible to the current user with name, key, ID, starred status, and public accessibility. Subsequent `@` accesses within 20 minutes return cached data.

**Resource 6 — Root suites for project**
> Attach `@zebrunner://projects/MCP/suites` and ask: "What root suites exist in the Android project?"

**Expected:** Returns root-level test suites (suites with no parent) with IDs and names. The `@` menu should show one entry per project (e.g., "Android — Root Suites", "iOS — Root Suites").

**Resource 7 — Automation states for project**
> Attach `@zebrunner://projects/MCP/automation-states` and ask: "What automation states exist?"

**Expected:** Returns the list of automation states (e.g., Automated, Manual, Not Automated, To Be Automated) with IDs for the selected project.

**Resource 8 — Priorities for project**
> Attach `@zebrunner://projects/MCP/priorities` and ask: "What priority levels are configured?"

**Expected:** Returns the list of priorities (e.g., Critical, High, Medium, Low) with IDs for the selected project.

### Phase 2 Dynamic Resources (deeper project data)

**Resource 9 — Milestones for project**
> Attach `@zebrunner://projects/MCP/milestones` and ask: "What milestones exist for Android?"

**Expected:** Returns active and completed milestones with IDs, names, and completion status. Useful for filtering launches by milestone version.

**Resource 10 — Result statuses for project**
> Attach `@zebrunner://projects/MCP/result-statuses` and ask: "What test run result statuses are configured?"

**Expected:** Returns the configured result statuses (e.g., Passed, Failed, Skipped, In Progress, Blocked) with IDs for the project.

**Resource 11 — Configuration groups for project**
> Attach `@zebrunner://projects/MCP/configuration-groups` and ask: "What configuration groups are available?"

**Expected:** Returns test run configuration groups and their options (e.g., Browser: Chrome/Firefox, OS: Windows/macOS).

**Resource 12 — Fields layout for project**
> Attach `@zebrunner://projects/MCP/fields` and ask: "What custom fields are defined for test cases?"

**Expected:** Returns system and custom field definitions with types, tab placement, and enabled status. Useful for understanding which custom fields (e.g., manualOnly, testrailId) are available.

**Resource 13 — Suite hierarchy for project**
> Attach `@zebrunner://projects/MCP/suite-hierarchy` and ask: "Show me the full suite tree."

**Expected:** Returns all test suites with parent-child relationships (parentId). Claude can reconstruct the tree structure from flat data.

### Combined Resource Usage

**Resource 14 — Resource-assisted report generation**
> Attach both `@zebrunner://projects` and `@zebrunner://reports/types`, then ask: "Generate an executive dashboard for all starred projects."

**Expected:** Claude uses project keys from the projects resource and the correct `report_types: ["executive_dashboard"]` from the report types resource to construct an accurate `adv_generate_report` call without guessing or calling discovery tools first.

---

## 15. MCP Prompts *(v9.1.0)*

> **17 prompts** registered. v9.1.0 adds `/relaunch-regression-failures` and `/feature-scoped-launch`. See [GitHub Release v9.1.0](https://github.com/maksimsarychau/mcp-zebrunner/releases/tag/v9.1.0).

MCP prompts provide pre-built, tested workflow instructions accessible via the `/` command in MCP clients. Each prompt injects expert-crafted multi-step instructions that guide Claude through complex multi-tool workflows.

### E2E Metric Prompts

**Prompt 1 — Pass rate via /pass-rate**
> Use `/pass-rate` with projects: "android,ios,web"

**Expected:** Prompt injects multi-platform pass rate collection instructions. Claude should call `adv_get_all_launches_with_filter` and `adv_get_launch_test_summary` for each platform, calculate pass rates, and compare against targets (Android/iOS >= 90%, Web >= 65%).

**Prompt 2 — Runtime efficiency via /runtime-efficiency**
> Use `/runtime-efficiency` with projects: "android,ios,web"

**Expected:** Prompt drives cross-platform runtime analysis. Claude should call `adv_analyze_regression_runtime` for each platform with `previous_milestone` for baseline comparison.

**Prompt 3 — Automation coverage via /automation-coverage**
> Use `/automation-coverage` with projects: "android,ios,web"

**Expected:** Prompt drives 7-metric coverage collection including intake rate. Claude should call `adv_get_automation_states`, `adv_get_test_cases_by_automation_state` with `count_only: true`, and `adv_get_test_case_by_filter` with date ranges.

**Prompt 4 — Executive dashboard via /executive-dashboard**
> Use `/executive-dashboard` with projects: "android,ios,web"

**Expected:** Prompt drives a 5-section executive report combining pass rate, runtime, top bugs, coverage, and flaky tests across all platforms.

**Prompt 5 — Release readiness via /release-readiness**
> Use `/release-readiness` with project: "android", milestone: "25.40.0"

**Expected:** Prompt drives a 5-check Go/No-Go assessment. Claude should provide a structured assessment with per-check PASS/FAIL status and a final recommendation.

**Prompt 6 — Suite coverage via /suite-coverage**
> Use `/suite-coverage` with projects: "android,ios,web"

**Expected:** Prompt drives per-suite automation coverage collection. Claude should handle "Manual Only" detection (automation state vs custom field), collect per-suite counts with `count_only: true`, and present tables with TOTAL and TOTAL REGRESSION rows.

### Analysis Prompts

**Prompt 7 — Test case review via /review-test-case**
> Use `/review-test-case` with case_key: "MCP-5"

**Expected:** Prompt drives a validate-then-improve workflow. Claude should call `adv_get_test_case_by_key`, `adv_validate_test_case`, and `adv_improve_test_case` in sequence, presenting a quality report with actionable suggestions.

**Prompt 8 — Launch triage via /launch-triage**
> Use `/launch-triage` with project: "android"

**Expected:** Prompt drives post-regression failure analysis. Claude should find the latest launch, identify failures without linked Jira issues, and analyze top failures with root cause analysis.

**Prompt 8b — Relaunch regression failures via /relaunch-regression-failures (milestone mode)**
> Use `/relaunch-regression-failures` with projects: "android,ios", milestone: "26.19.0"

**Config:** Launch exclusions and batch cap come from `relaunchFailures` in [zebrunner-config.json](../zebrunner-config.json). See [Project-specific automation configuration](RESOURCES_AND_PROMPTS.md#project-specific-automation-configuration).

**Expected:** Prompt drives discovery of failed launches for the milestone on each platform. Claude should paginate `adv_get_all_launches_with_filter`, exclude launches matching `relaunchFailures.excludeLaunchNamePatterns` from zebrunner-config.json, present eligible and skipped tables, then call `adv_rerun_launch_failures` in batch mode (preview → user approval → confirm). Must not skip preview or auto-confirm.

**Prompt 8c — Relaunch failures last 7 days via /relaunch-regression-failures**
> Use `/relaunch-regression-failures` with projects: "web,android,ios", period: "last_7_days"

**Expected:** Prompt drives time-based discovery — paginate launches without milestone/query, filter on `startedAt` within rolling 7 days, exclude launches per `relaunchFailures.excludeLaunchNamePatterns`, then rerun eligible launch IDs via single-launch mode (preview/confirm per launch or grouped). Must warn if more than `relaunchFailures.maxLaunchesPerPlatform` eligible launches per platform.

**Prompt 8d — Feature-scoped Build Now via /feature-scoped-launch**
> Use `/feature-scoped-launch` with project: "android", feature: "Water", suite_name: "Minimal Acceptance", build: "50977"

**Expected:** Prompt drives adv_aggregate_test_cases_by_feature (test_run_rules format, by_root_suite), builds TAGS=>featureSuiteId=... filter, resolves suite_path from args/recent launches/user, previews adv_start_launch, waits for approval, confirms.

**Prompt 9 — Flaky test review via /flaky-review**
> Use `/flaky-review` with project: "android"

**Expected:** Prompt drives flaky test detection and analysis. Claude should call `adv_find_flaky_tests` with history enabled and present a prioritized stabilization plan.

**Prompt 10 — Duplicate detection via /find-duplicates**
> Use `/find-duplicates` with project: "android", suite_id: "42"

**Expected:** Prompt drives structural (and optionally semantic) duplicate analysis within the specified scope. Claude should present duplicate groups with similarity scores and merge recommendations.

### Role-Specific Prompts

**Prompt 11 — Daily QA standup via /daily-qa-standup**
> Use `/daily-qa-standup` with projects: "android,ios,web"

**Expected:** Prompt drives a concise daily status collection. Claude should get the latest launch per platform, check for unresolved failures, scan for flaky tests in the last 7 days, and present a standup-ready summary with action items.

**Prompt 12 — Automation gaps via /automation-gaps**
> Use `/automation-gaps` with projects: "android,ios,web"

**Expected:** Prompt drives gap analysis. Claude should check per-suite coverage, identify the least automated suites, find recently created manual test cases, and present a prioritized automation backlog.

**Prompt 13 — Project overview via /project-overview**
> Use `/project-overview` with project: "android"

**Expected:** Prompt drives comprehensive project health collection. Claude should gather suite structure, coverage metrics, recent launches, milestones, priorities, and flaky test counts, presenting a structured project health card.

### Utility Prompts

**Prompt 14 — Session metrics via /session-metrics**
> Use `/session-metrics` (no arguments required)

**Expected:** Prompt instructs Claude to call `adv_about_mcp_tools` with `mode: "metrics"` and present a summary of tool calls, durations, errors, and response sizes for the current session. If no tools were called before invoking this prompt, it reports an empty session.

### Combined Resources + Prompts

**Prompt 15 — Resource context + prompt workflow**
> Attach `@zebrunner://projects` via the `@` menu, then use `/launch-triage` with project: "android"

**Expected:** The project resource context provides project metadata, and the prompt instructions guide Claude through the triage workflow. Claude should use the project key from the resource context for accurate tool calls.

---

## 16. Tool Annotations *(v7.2.2)*

All 69 tools now include MCP Tool Annotations (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) that inform clients about tool behavior characteristics.

**Verification 1 — Read-only tools respected**
> In the MCP Inspector, examine any read-only tool (e.g., `adv_list_test_suites`). Check its annotations.

**Expected:** The tool should have `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. This applies to all 54 non-mutation tools.

**Verification 2 — Mutation tools flagged correctly**
> In the MCP Inspector, examine a mutation tool (e.g., `adv_create_test_case`). Check its annotations.

**Expected:** The tool should have `readOnlyHint: false`. `adv_create_test_case` and `adv_create_test_suite` have `idempotentHint: false` (creating twice makes two entities). `adv_update_test_suite` and `adv_update_test_case` have `idempotentHint: true` (same update = same result). `adv_import_launch_results_to_test_run` has `destructiveHint: true` (overrides results).

**Verification 3 — Client hint usage**
> Ask Claude Desktop: "Is it safe to call adv_list_test_suites multiple times?"

**Expected:** Claude may reference the readOnlyHint and idempotentHint annotations to confirm the tool is safe to retry and does not modify server state.

## 17. Tool Metrics & Token Tracking *(v7.2.2)*

Server-side tool metrics are collected automatically for every tool call in a session. Eval tests now track Anthropic API token usage with cost estimation.

### Session Tool Metrics (via `adv_about_mcp_tools` mode: "metrics")

**Test 1 — Empty session**
> Call `adv_about_mcp_tools` with `mode: "metrics"` immediately after server start (no prior tool calls).

**Expected:** Output shows "No tool calls recorded in this session." preceded by the MCP version header.

**Test 2 — After several tool calls**
> 1. Call `adv_get_available_projects`
> 2. Call `adv_list_test_suites` for a project
> 3. Call `adv_about_mcp_tools` with `mode: "metrics"`

**Expected:** A markdown table showing 2 rows (one for each tool called) with columns: Tool, Calls, Avg (ms), Min (ms), Max (ms), Resp (chars), Errors. Total calls should be 2. Error count should be 0. The `adv_about_mcp_tools` call itself (with mode "metrics") is also instrumented but runs after the stats snapshot.

**Test 3 — Error tracking**
> Call a tool with invalid arguments (e.g., `adv_get_test_case_by_key` with a non-existent key), then check metrics.

**Expected:** The metrics table shows 1 call for that tool with `Errors: 0` or `Errors: 1` depending on whether the tool returns `isError: true` in the response (most tools return an error message as regular text content).

**Test 4 — MCP Inspector verification**
> In the MCP Inspector, call `adv_about_mcp_tools` with arguments `{ "mode": "metrics" }`.

**Expected:** Returns a well-formatted markdown response starting with `MCP version: X.Y.Z` followed by the metrics summary table or the empty-session message.

### Eval Token Tracking (CLI)

Requires LLM provider config in `.env` — see `.env.example` (`EVAL_PROVIDER=local` for Ollama, `anthropic` for Claude, etc.) and `docs/EVALUATION_FRAMEWORK.md`.

**Test 5 — Run eval tests and check token report**
> ```bash
> npm run test:eval
> ```

**Expected:** The console scorecard now includes a "Token Usage" section showing:
- Input / Output token counts (e.g., `15.2k / 2.1k`)
- If Layer 3 tests ran: judge token breakdown
- Estimated cost (e.g., `$0.0516`)

**Test 6 — Check eval markdown report for token details**
> After running `npm run test:eval`, open the latest report in `results/`.

**Expected:** The markdown report includes:
- Header line: `**Tokens:** X input + Y output`
- Header line: `**Estimated cost:** $X.XXXX`
- A "Token Usage" section with a summary table and a per-prompt breakdown table showing input/output tokens and judge tokens for each eval prompt.

**Test 7 — Check eval JSON report for token data**
> After running `npm run test:eval`, open the latest `.json` in `results/`.

**Expected:** Each result object in the `results` array contains `tokenUsage: { inputTokens, outputTokens }`. Layer 3 results also contain `judgeTokenUsage`. The `summary` object contains `tokens: { totalInputTokens, totalOutputTokens, judgeInputTokens, judgeOutputTokens, estimatedCost: { input, output, total } }`.

### Per-call compact vs JSON comparison *(v9.2.1)*

Use in Claude Desktop. Each tool call must pass `include_call_metrics: true` (or set `MCP_INLINE_METRICS=true` on the server). Read the `_mcp_metrics` JSON footer on each response. Compare `rowsReturned`, `wasTruncated`, `bytesPerRow`, and `approxTokens` — not raw body size alone. See [TOKEN_EFFICIENCY.md](TOKEN_EFFICIENCY.md).

**Test 8 — Fair A/B: project bulk read**

> Call `adv_get_all_tcm_test_cases_by_project` for project MCP twice with identical args except format:
> - `detail=summary`
> - `max_results=500`
> - `include_call_metrics=true`
>
> First call: `format=json`. Second call: `format=compact`.
>
> Do not summarize the test case bodies. For each response, read the `_mcp_metrics` footer and report a small table:
> `format | rowsReturned | wasTruncated | responseChars | approxTokens | bytesPerRow`
>
> Then state whether compact is cheaper per row and in total, and whether `rowsReturned` matched (required for a fair comparison).

**Expected:** Same `rowsReturned` on both calls. `bytesPerRow` and `approxTokens` lower on `format=compact` (~15–25% per row). If `rowsReturned` differs, flag the comparison as unfair.

**Test 9 — Fair A/B: suite bulk read**

> Pick one suite in the MCP project with a decent number of cases (or use a `suite_id` you already know).
>
> Call `adv_get_test_cases_by_suite_smart` twice for that suite with:
> - `project_key: "MCP"`
> - `detail=summary`
> - `get_all=true`
> - `include_call_metrics=true`
> - `format=json` on the first call, `format=compact` on the second
>
> Compare only the `_mcp_metrics` footers: `rowsReturned`, `responseChars`, `approxTokens`, `bytesPerRow`.
>
> Confirm compact used fewer chars/tokens per row. If `rowsReturned` differs, say the comparison is unfair and why.

**Expected:** Equal `rowsReturned`; compact wins on `bytesPerRow`.

---

## 18. Dashboard Widgets (22 templates) — v9.2.5

Zebrunner exposes **22 dashboard widget templates** exercised by `npm run test:api` (`tests/api-verify.sh`). As of **v9.2.5**, **all 22** have MCP coverage via dedicated tools, hub tools, pass-rate views, and Tier A mappings.

**MCP tool families:**

| Family | MCP tool | Covers |
|--------|----------|--------|
| TCM distribution | `adv_get_test_case_distribution_by_field` | Template **37780** |
| TCM analytics hub | `adv_get_tcm_case_analytics` | Templates **37777**, **37778**, **37779** |
| Pass-rate views | `adv_get_platform_results_by_period` (`view`) | Templates **3**, **5**, **8**, **14**, **17**, **90** |
| Failure analytics hub | `adv_get_failure_analytics` | Templates **40112**, **55991**, **57086** |
| Execution analytics hub | `adv_get_execution_analytics` | Templates **1**, **131**, **57085**, **16** |
| Authoring trend | `adv_get_test_authoring_trend` | Template **7** |
| Tier A (existing) | `adv_get_top_bugs`, `adv_get_bug_review`, `adv_get_bug_failure_info` | Templates **4**, **9**, **6**, **10** |

Full matrix: [docs/archive/TCM_TAM_WIDGET_BACKLOG.md](archive/TCM_TAM_WIDGET_BACKLOG.md) (archived). Eval routing: `tests/eval/eval-widget-prompts.ts`, `tests/eval/eval-hub-prompts.ts`, `tests/eval/eval-authoring-prompts.ts`.

---

### Quick reference — all 22 widgets

| Template | Widget | MCP tool / args | API verify ID |
|----------|--------|-----------------|---------------|
| **37780** | Distribution by field | `adv_get_test_case_distribution_by_field` | TCM-DIST-* |
| **37777** | Net change | `adv_get_tcm_case_analytics` `mode=net_change` | TCM-NET |
| **37778** | Updated by user | `adv_get_tcm_case_analytics` `mode=updated_by_user` | TCM-UPDATED |
| **37779** | Created by user | `adv_get_tcm_case_analytics` `mode=created_by_user` | TCM-CREATED |
| **4** | Top defects | `adv_get_top_bugs` | W-TPL4 |
| **9** | Failures by reason | `adv_get_bug_review` | W-TPL9 |
| **6** | Failure info | `adv_get_bug_failure_info` | W-TPL6 |
| **10** | Failure details | `adv_get_bug_failure_info` | W-TPL10 |
| **8** | Pass rate pie | `adv_get_platform_results_by_period` (`view=pie`, default) | W-VIEW-8-DEFAULT, W-TPL8-WEEK |
| **3** | Pass rate bar | `adv_get_platform_results_by_period` `view=bar` | W-TPL3, W-TPL3-OWNER-TODAY |
| **5** | Pass rate line | `adv_get_platform_results_by_period` `view=line` | W-TPL5 |
| **17** | Pass rate pie+line | `adv_get_platform_results_by_period` `view=pie_line` | W-TPL17 |
| **90** | Pass rate calendar | `adv_get_platform_results_by_period` `view=calendar` | W-TPL90 |
| **14** | Tests summary | `adv_get_platform_results_by_period` `view=summary` | W-TPL14 |
| **7** | TC development trend | `adv_get_test_authoring_trend` | W-TPL7, W-TPL7-ABS |
| **40112** | Failure tag pie | `adv_get_failure_analytics` `mode=tag_distribution` | W-TPL40112 |
| **55991** | Tags × maintainer | `adv_get_failure_analytics` `mode=tags_by_maintainer` | W-TPL55991 |
| **57086** | Jira × maintainer | `adv_get_failure_analytics` `mode=jira_by_maintainer` | W-TPL57086 |
| **57085** | Launch duration | `adv_get_execution_analytics` `mode=launch_duration` | W-TPL57085 |
| **131** | Execution duration | `adv_get_execution_analytics` `mode=duration_trend` | W-TPL131, W-TPL131-RUN |
| **1** | Execution ROI | `adv_get_execution_analytics` `mode=roi` | W-TPL1-ROI |
| **16** | Stability table | `adv_get_execution_analytics` `mode=stability_table` | W-TPL16 |

**Conventions:** Prompts use generic platform names (Android / iOS / Web). Replace with your project key or alias. Period strings must match Zebrunner presets unless using v9.2.2+ `period_mode` on widget tools.

---

### How to verify all 22 widgets

**Live API (requires `.env` creds):**
```bash
npm run test:api
```
Expect hub parity lines per project (`HUB-TCM`, `HUB-FAILURE`, `HUB-EXEC`, `HUB-PASS-RATE`, `HUB-DIST`) and **380+ passed** on MFP starred projects.

**Unit + eval (no live tenant):**
```bash
npm test                                    # hub-widget-matrix, eval-widget/hub/authoring prompts
npm run test:eval                           # default suite (~40 prompts, local Ollama, 80% aggregate)
npm run test:eval:cloud                     # cloud suite (~149 prompts, Anthropic, strict per-prompt)
EVAL_FILTER=widget.tpl7 npm run test:eval:cloud   # single prompt smoke
```

**Eval prompt files (widget platform v9.2.3–v9.2.5):**

| File | Covers |
|------|--------|
| `tests/eval/eval-widget-prompts.ts` | All 22 template routing + chains |
| `tests/eval/eval-hub-prompts.ts` | Hub modes, pass-rate views, period absolute |
| `tests/eval/eval-authoring-prompts.ts` | `adv_get_test_authoring_trend` + negatives |
| `tests/eval/eval-cloud-suite.ts` | Default vs cloud partition |

**Catalog audit (informational):**
```bash
bash tests/api-verify.sh --widget-catalog-audit
```

---

### TCM widgets (4) — `POST /api/tcm/v1/widgets/{systemName}/content:get`

#### Template **37780** — Test cases distribution by field

**MCP tool:** `adv_get_test_case_distribution_by_field`

**Prompt 1 — Project-wide automation state**
> Show a pie chart of test case distribution by automation state for the Android project.

**Expected:** Widget API (37780). Returns counts and percentages per automation state; optional PNG pie when `chart: "png"`.

**Prompt 2 — Custom field + root suite**
> How are test cases in root suite 100 distributed by the "Manual Only" custom field on iOS? Include subsuites.

**Expected:** Resolves custom field via fields-layout; expands `root_suite_ids`. Not the same as `adv_get_test_cases_by_automation_state` (paginated list).

**Prompt 3 — JSON for automation**
> Return compact JSON for Priority distribution across the Web project.

**Expected:** `format: "compact"` or `"json"` with `{ summary, items: [{ label, value, percent }] }`.

---

#### Template **37777** — Test cases net change

**MCP tool:** `adv_get_tcm_case_analytics` — `mode: "net_change"`

**Prompt 1**
> Show net change in test case count for the Android project over the last 90 days, grouped by week.

**Expected:** TCM widget `test-cases-net-change` with `period: "Last 90 Days"`, `grouping_period: "Week"`. Rows include `period`, `valueFrom`, `valueTo`.

**Prompt 2**
> Compare TCM case volume at the start vs end of last month for iOS.

**Expected:** Net-change widget with monthly grouping; suitable for coverage trend standups.

---

#### Template **37778** — Test cases updated by user

**MCP tool:** `adv_get_tcm_case_analytics` — `mode: "updated_by_user"`

**Prompt 1**
> Who updated the most test cases on the Web project in the last 30 days?

**Expected:** TCM widget `test-cases-updated-by-user`; bar/list by user with counts.

**Prompt 2**
> Show TCM update activity by author for Android this quarter.

**Expected:** Adjust `period` in widget filters; snapshot-only (no ABSOLUTE/DYNAMIC on TCM widgets).

---

#### Template **37779** — Test cases created by user

**MCP tool:** `adv_get_tcm_case_analytics` — `mode: "created_by_user"`

**Prompt 1**
> Which authors created the most new test cases on iOS in the last 30 days?

**Expected:** TCM widget `test-cases-created-by-user`.

**Prompt 2**
> Show test case authoring leaderboard for the Web project for last month.

**Expected:** Same widget family as 37778 but creation events.

---

### TAM SQL widgets (18) — `POST /api/reporting/v1/widget-templates/sql`

#### Template **1** — Execution ROI

**MCP tool:** `adv_get_execution_analytics` — `mode: "roi"`

**Prompt 1**
> What is the execution ROI (time saved vs manual effort) for the Android project over the last 7 days?

**Expected:** Template 1 with dashboard filters; columns include `TIME` or `STARTED_AT`.

**Prompt 2**
> Summarize automation ROI for iOS launches this week.

**Expected:** React dashboard params (`isReact: true`, empty filter arrays, `PERIOD: "Last 7 Days"`).

---

#### Template **3** — Pass rate (bar, grouped)

**MCP tool:** `adv_get_platform_results_by_period` — `view: "bar"`, `group_by: "PRIORITY"` (default)

**Prompt 1**
> Show pass rate broken down by priority for the Web project for July 2026.

**Expected:** Template 3, `GROUP_BY: "PRIORITY"`, `PERIOD: "ABSOLUTE"` with start/end dates; rows use `GROUP_FIELD` or group column + status counts.

**Prompt 2**
> Bar chart of pass/fail by priority for Android last month.

**Expected:** MCP pass-rate tool with `view: "bar"`; or widget SQL directly.

---

#### Template **4** — Top defects

**MCP tool:** `adv_get_top_bugs`

**Prompt 1**
> What are the top 10 defects by failure count on Android over the last 7 days?

**Expected:** Template 4 / `adv_get_top_bugs`; columns `DEFECT`, `FAILURES`, `%`.

**Prompt 2**
> List the most frequent Jira-linked bugs on iOS this month with failure counts.

**Expected:** Uses widget SQL or MCP tool; optional `issueUrlPattern` for links.

---

#### Template **5** — Pass rate (line trend)

**MCP tool:** `adv_get_platform_results_by_period` — `view: "line"`, `grouping_period: "DAY"`

**Prompt 1**
> Show daily pass and fail counts for the Web project over the last 14 days as a trend line.

**Expected:** Template 5, `groupingPeriod: "DAY"`, columns `STARTED_AT`, `PASSED`, `FAILED`.

**Prompt 2**
> Line chart of test pass rate trend for Android over the past two weeks.

**Expected:** `adv_get_platform_results_by_period` with `view: "line"`.

---

#### Template **6** — Failure info (summary)

**MCP tool:** `adv_get_bug_failure_info` (requires hashcode from bug review)

**Prompt 1**
> Get failure stability summary for hashcode from the latest bug review on Android.

**Expected:** Chain: `adv_get_bug_review` → extract hashcode → template 6 / `adv_get_bug_failure_info`.

**Prompt 2**
> Show error/stability column for the top failure hashcode on iOS today.

**Expected:** Template 6 with `hashcode` in paramsConfig; columns `#`, `ERROR/STABILITY`.

---

#### Template **7** — Test case development trend

**MCP tool:** `adv_get_test_authoring_trend` — `grouping_period: "DAY"` (default)

**Prompt 1**
> How many test cases were created per day on the Web project over the last 14 days?

**Expected:** Template 7; columns `CREATED_AT`, `AMOUNT`. TAM SQL widget — not TCM net-change (37777).

**Prompt 2**
> Show TCM authoring velocity trend for Android this sprint grouped by week.

**Expected:** `grouping_period: "WEEK"`; distinct from net-change widget (37777).

---

#### Template **8** — Pass rate (pie)

**MCP tool:** `adv_get_platform_results_by_period` — `view: "pie"` (default; omit `view` for backward compatibility)

**Prompt 1**
> What is the overall pass rate breakdown for the Android project this week?

**Expected:** Template 8 / MCP tool; pie rows `label`, `value` (PASSED, FAILED, etc.).

**Prompt 2 — Dynamic period (v9.2.2+)**
> Pass rate for iOS from start of last month through today using a dynamic widget period.

**Expected:** `period_mode: "dynamic"`, expressions like `START_OF_MONTH -1 MONTH` → `TODAY`.

**Prompt 3 — Regression: default unchanged**
> What is the pass rate for Android over the last 7 days? Use the standard pass-rate tool — default pie view, do not pass view=bar.

**Expected:** No `view` arg → template 8, same as pre-v9.2.4 callers.

---

#### Template **9** — Failures by reason (bug review)

**MCP tool:** `adv_get_bug_review`

**Prompt 1**
> Give me a bug review for the Web project for today — failures grouped by reason.

**Expected:** Template 9 / `adv_get_bug_review`; columns include `PROJECT`, `REASON`, `#`, `SINCE`, `REPRO`.

**Prompt 2**
> Show failure reasons with reproduction counts for Android in the last 24 hours.

**Expected:** Adjust `PERIOD`; hashcodes in `#` column feed template 6/10.

---

#### Template **10** — Failure details

**MCP tool:** `adv_get_bug_failure_info` (detail leg)

**Prompt 1**
> List affected runs and tests for hashcode X on the Android project.

**Expected:** Template 10 after bug review; columns `RUN_ID`, `TEST_ID`, `RUN`, `TEST`, `DEFECT`.

**Prompt 2**
> Deep-dive failure rows for the top hashcode from today's bug review on iOS.

**Expected:** Same hashcode-chained workflow as template 6.

---

#### Template **14** — Tests summary (grouped table)

**MCP tool:** `adv_get_platform_results_by_period` — `view: "summary"`, `group_by: "BUILD"` (default)

**Prompt 1**
> Summarize passed, failed, and total tests grouped by build for Android over the last 7 days.

**Expected:** Template 14, `GROUP_BY: "BUILD"`; dimension column `BUILD`/`NAME`/`GROUP_FIELD` plus `PASSED`, `FAILED`, `TOTAL`.

**Prompt 2**
> Tests summary table by platform for iOS today.

**Expected:** `group_by: "PLATFORM"`; HTTP 200 even when some groups are empty.

---

#### Template **16** — Stability table

**MCP tool:** `adv_get_execution_analytics` — `mode: "stability_table"`, `stability_threshold: 99`

**Prompt 1**
> Which tests fell below 99% stability on Android in the last 24 hours?

**Expected:** Template 16, `STABILITY: "99"`; columns `NAME`, `PLATFORM`, `STABILITY`, `DURATION`.

**Prompt 2**
> Show low-stability tests on Web with duration — not the same as flaky flip-flop detection (`adv_find_flaky_tests`).

**Expected:** Widget sub-threshold table vs cross-launch flip analysis.

---

#### Template **17** — Pass rate (pie + line combo)

**MCP tool:** `adv_get_platform_results_by_period` — `view: "pie_line"`, `grouping_period: "DAY"`

**Prompt 1**
> Combined pass-rate pie and daily trend for iOS over the last 14 days.

**Expected:** Template 17, `groupingPeriod: "DAY"`, columns `STARTED_AT`, `PASSED`, `FAILED`.

**Prompt 2**
> Dashboard-style pass rate combo chart for Android this sprint.

**Expected:** MCP `view: "pie_line"`.

---

#### Template **90** — Pass rate (calendar heatmap)

**MCP tool:** `adv_get_platform_results_by_period` — `view: "calendar"`, `passed_value_threshold: 75`

**Prompt 1**
> Calendar heatmap of daily pass rate for the Web project in 2026 Q2 with 75% as the green threshold.

**Expected:** Template 90, `PERIOD: "2026-Q2"`, `PASSED_VALUE: "75"`; columns `date`, `value`, `passed`.

**Prompt 2**
> Show which days in the quarter missed the 75% pass target on Android.

**Expected:** Calendar widget rows via `view: "calendar"`.

---

#### Template **131** — Execution duration (daily)

**MCP tool:** `adv_get_execution_analytics` — `mode: "duration_trend"`

**Prompt 1**
> Daily test execution duration trend for the Android project over the last 7 days.

**Expected:** Template 131 project-wide; column `TESTED_AT` (may be empty if no executions in window).

**Prompt 2 — Filtered by run/suite name**
> Execution duration for run/suite "Regression" on iOS last week.

**Expected:** Template 131 with `RUN: ["Regression"]` or MCP `run` filter; empty array is valid when no matching executions.

---

#### Template **40112** — Failure tag pie

**MCP tool:** `adv_get_failure_analytics` — `mode: "tag_distribution"`

**Prompt 1**
> Pie chart of failure tags by test count on Android in the last 24 hours.

**Expected:** Template 40112; columns `tag`, `tests_count`.

**Prompt 2**
> Which failure tags dominate on Web today?

**Expected:** Tag aggregation widget; complements bug review (template 9). Not `adv_get_top_bugs`.

---

#### Template **55991** — Failure tags × maintainer

**MCP tool:** `adv_get_failure_analytics` — `mode: "tags_by_maintainer"`

**Prompt 1**
> Cross-tab of failure tags and maintainers for iOS today.

**Expected:** Template 55991; columns `tag`, `username`, `tests_count`.

**Prompt 2**
> Which maintainers own the most tagged failures on Android this week?

**Expected:** Same widget with `PERIOD: "Last 7 Days"`.

---

#### Template **57086** — Jira issues × maintainer

**MCP tool:** `adv_get_failure_analytics` — `mode: "jira_by_maintainer"`

**Prompt 1**
> Map Jira issues to maintainers by failure count on Web for the last 14 days.

**Expected:** Template 57086; columns `ISSUES`, `MAINTAINER`, `COUNT`.

**Prompt 2**
> Who maintains the noisiest Jira defects on Android this sprint?

**Expected:** Failure/defect cross-widget; distinct from top bugs (template 4).

---

#### Template **57085** — Launch duration by suite/run

**MCP tool:** `adv_get_execution_analytics` — `mode: "launch_duration"`

**Prompt 1**
> Launch duration trend for suite "Regression" on Android this quarter.

**Expected:** Template 57085; try `RUN` or `SUITE` filter with reporting run names; columns include launch id, start time, duration.

**Prompt 2**
> How long did launches take for the Social suite on iOS last 7 days?

**Expected:** May return HTTP 200 with alternate column names (`LAUNCH_ID`, `DURATION`, etc.) depending on tenant schema.

---

### E2E widget workflows

**Prompt — Bug triage chain (templates 9 → 6 → 10)**
> Run a bug review for Android today, then pull failure info and detailed rows for the top hashcode.

**Expected tools:** `adv_get_bug_review` → `adv_get_bug_failure_info` (maps to templates 9, 6, 10).

**Prompt — Coverage dashboard (37780 + 37777 + 8)**
> For iOS: pie of cases by automation state, net case change last 90 days, and pass rate this week.

**Expected:** `adv_get_test_case_distribution_by_field` + `adv_get_tcm_case_analytics` (`net_change`) + `adv_get_platform_results_by_period` (`view: pie`).

**Prompt — Failure analytics trio (40112 + 55991 + 57086)**
> For Web last 14 days: failure tag pie, tags by maintainer today, and Jira issues by maintainer.

**Expected:** Three calls to `adv_get_failure_analytics` with modes `tag_distribution`, `tags_by_maintainer`, `jira_by_maintainer`.

**Prompt — Execution dashboard (1 + 131 + 16)**
> For Android last 7 days: execution ROI, daily duration trend, and tests below 99% stability.

**Expected:** `adv_get_execution_analytics` with modes `roi`, `duration_trend`, `stability_table`.

**Prompt — Pass-rate view tour (3 + 5 + 8 + 14 + 17 + 90)**
> For iOS over the last 14 days, show pass rate as pie, daily line, priority bar, build summary table, pie+line combo, and Q2 calendar at 75% threshold.

**Expected:** Six calls to `adv_get_platform_results_by_period` with each `view` value.

**Prompt — Quality report overlap**
> Generate pass rate and top bugs for Web last 14 days using MCP tools that mirror dashboard widgets 8 and 4.

**Expected:** `adv_get_platform_results_by_period` + `adv_get_top_bugs`, or `adv_generate_report` with `report_types: ["pass_rate", "quality_dashboard"]`.

---

### Tool confusion — what NOT to use

| User asks for | Use | Do NOT use |
|---------------|-----|------------|
| Field distribution pie (37780) | `adv_get_test_case_distribution_by_field` | `adv_get_test_cases_by_automation_state` |
| Failure tag pie (40112) | `adv_get_failure_analytics` `tag_distribution` | `adv_get_top_bugs` |
| Stability table (16) | `adv_get_execution_analytics` `stability_table` | `adv_find_flaky_tests` |
| Launch duration widget (57085) | `adv_get_execution_analytics` `launch_duration` | `adv_analyze_regression_runtime` |
| Execution duration (131) | `adv_get_execution_analytics` `duration_trend` | `adv_analyze_regression_runtime` |
| TCM net change (37777) | `adv_get_tcm_case_analytics` `net_change` | `adv_get_test_case_distribution_by_field` |
| TC authoring trend (7) | `adv_get_test_authoring_trend` | `adv_get_tcm_case_analytics` `net_change` |

---

*Last Updated: v9.2.7 — August 2026*
