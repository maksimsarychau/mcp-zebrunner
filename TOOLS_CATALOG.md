# 📚 MCP Zebrunner Tools Catalog

Complete reference of all available tools with natural language usage examples.

## 📑 Table of Contents

1. [Test Failure Analysis & Debugging](#test-failure-analysis--debugging)
2. [Test Execution History & Comparison](#test-execution-history--comparison)
3. [Launch Analysis & Reporting](#launch-analysis--reporting)
4. [Video & Screenshot Analysis](#video--screenshot-analysis)
5. [Test Case Management](#test-case-management)
6. [Test Suite Hierarchy](#test-suite-hierarchy)
7. [Test Coverage & Validation](#test-coverage--validation)
8. [Test Code Generation](#test-code-generation)
9. [Duplicate Detection](#duplicate-detection)
10. [Feature-Based Test Case Aggregation](#feature-based-test-case-aggregation)
11. [Test Run Management](#test-run-management)
12. [Platform & Results Analysis](#platform--results-analysis)
13. [Project Discovery](#project-discovery)

---

## Test Failure Analysis & Debugging

### `analyze_test_failure`

**Description:** Deep forensic analysis of failed tests including logs, screenshots, error classification, similar failures, and optionally comparison with last passed execution.

**Example Prompts:**
- "Analyze test failure 5451420 from launch 120806"
- "Analyze test 5478492 and compare with the last time it passed"
- "Deep dive into why test 5455325 failed in launch 120906, include video and compare with last successful run"

### `detailed_analyze_launch_failures`

**Description:** Analyze ALL failures in a launch with intelligent grouping, executive summary, timeline analysis, and pattern detection. Automatically filters tests without linked issues by default.

**Example Prompts:**
- "Analyze all failures in launch 120806"
- "Show me what failed in launch 120906 with executive summary and patterns"
- "Generate Jira tickets for all failures in launch 120814 in jira format"

---

## Test Execution History & Comparison

### `get_test_execution_history`

**Description:** Track test execution trends across multiple launches. Shows pass/fail history, last passed execution, pass rate, and highlights if test failed in all recent runs.

**Example Prompts:**
- "Show me execution history for test 5478492"
- "Has test 5455325 been failing consistently?"
- "When was the last time test 5478492 passed?"

### Compare with Last Passed (parameter in `analyze_test_failure`)

**Description:** Compare current failure with last successful execution. Shows differences in logs, duration, environment, and screenshots.

**Example Prompts:**
- "Analyze test 5478492 failure and compare logs with last passed run"
- "Compare test 5455325 with last passed execution - check if duration or environment changed"
- "Analyze test failure and show me what changed since it last passed"

---

## Launch Analysis & Reporting

### `get_launch_details`

**Description:** Get comprehensive information about a specific launch including test results, environment, build, and execution metadata.

**Example Prompts:**
- "Get launch details for launch 120906"
- "Show me information about launch 121482"
- "What happened in launch 120814?"

### `get_launch_summary`

**Description:** Quick launch overview with key metrics and status.

**Example Prompts:**
- "Give me a quick summary of launch 120906"
- "Summarize launch 121482 results"
- "What's the overall status of launch 120814?"

### `get_launch_test_summary`

**Description:** Lightweight aggregated test results with statistics, most unstable tests, and tests with issues. Optimized for large launches.

**Example Prompts:**
- "Get test summary for launch 119783 with top 10 most unstable tests"
- "Show me summary of launch 120906 - just failed tests"
- "Get lightweight summary for launch 121482"

### `get_all_launches_for_project`

**Description:** Get all launches for a project with pagination and filtering.

**Example Prompts:**
- "Get all launches for project MCP from last month"
- "Show me recent launches for project MCP"
- "List all launches for project MCP from last 7 days"

### `get_all_launches_with_filter`

**Description:** Filter launches by milestone, build, or other criteria.

**Example Prompts:**
- "Get launches for milestone 2.1.0"
- "Show me launches for build 'mcp-app-2.1.0'"
- "Find launches for milestone 2.1.0 and build 'release-46975'"

---

## Video & Screenshot Analysis

### `analyze_test_execution_video`

**Description:** Download and analyze test execution video with Claude Vision. Extracts frames, compares with test case steps, and predicts if failure is bug or test issue.

**Example Prompts:**
- "Analyze video for test 5455325 from launch 120906"
- "Download and analyze test execution video for test 5478492 with smart frame extraction"
- "Analyze video for failed test 5451420 and compare with test case steps"

### `download_test_screenshot`

**Description:** Download protected screenshots from Zebrunner with authentication.

**Example Prompts:**
- "Download screenshot from https://your-workspace.zebrunner.com/files/abc123"
- "Download screenshot /files/xyz789 for test 5451420"
- "Get screenshot from URL https://your-workspace.zebrunner.com/files/screenshot123"

### `analyze_screenshot`

**Description:** Visual analysis of screenshots with OCR, UI element detection, and Claude Vision analysis.

**Example Prompts:**
- "Analyze screenshot https://your-workspace.zebrunner.com/files/abc123 with OCR"
- "Analyze this screenshot and tell me what UI elements are visible"
- "Analyze screenshot /files/xyz789 and extract text with OCR"

---

## Test Case Management

### `get_test_case_by_key`

**Description:** Get detailed information for a specific test case by its key (e.g., MCP-123).

**Example Prompts:**
- "Get test case MCP-2107 details"
- "Show me test case MCP-1921"
- "What does test case MCP-88 test?"

### `get_test_case_by_title`

**Description:** Search for test cases by title (partial match supported).

**Example Prompts:**
- "Find test cases with 'login' in the title"
- "Search for test cases containing 'diary'"
- "Find test cases about 'food search'"

### `get_test_cases_advanced`

**Description:** Advanced filtering with automation states, dates, priority, and more.

**Example Prompts:**
- "Get test cases created after 2025-01-01 with automation state 'Manual'"
- "Show me high priority test cases from last month"
- "Find test cases updated after 2025-11-01 that are not automated"

### `get_test_cases_by_automation_state`

**Description:** Filter test cases by specific automation state (Manual, Automated, etc.).

**Example Prompts:**
- "Show me all 'Not Automated' test cases in project MCP"
- "Get all manual test cases"
- "Find test cases with automation state 'Automated'"

### `get_test_case_by_filter`

**Description:** Advanced filtering by suite, dates, priority, automation state, and status.

**Example Prompts:**
- "Get test cases from suite 491 created after 2025-01-01 with high priority"
- "Show me test cases from suite 17470 with status 'Approved'"
- "Find test cases in suite 18697 that were updated last week"

### `get_automation_states`

**Description:** List all available automation states for a project.

**Example Prompts:**
- "What automation states are available for project MCP?"
- "Show me all automation states"
- "List automation states for MCP"

### `get_automation_priorities`

**Description:** List all available priority levels with their IDs.

**Example Prompts:**
- "Show me all priority levels for project MCP"
- "What priorities are available?"
- "List all test case priorities"

### `get_all_tcm_test_cases_by_project`

**Description:** Get ALL test cases for a project with automatic pagination handling.

**Example Prompts:**
- "Get all test cases for project MCP"
- "Show me every test case in the MCP project"
- "Export all test cases from project MCP"

### `get_all_tcm_test_cases_with_root_suite_id`

**Description:** Get all test cases with their root suite hierarchy information.

**Example Prompts:**
- "Get all test cases with their root suite information for project MCP"
- "Show me test cases with hierarchy info"
- "List all test cases with their parent suites"

---

## Test Suite Hierarchy

### `list_test_suites`

**Description:** List test suites with pagination.

**Example Prompts:**
- "List test suites for project MCP"
- "Show me all test suites"
- "Get first 50 test suites for project MCP"

### `get_suite_hierarchy`

**Description:** Get hierarchical tree view of test suites with configurable depth.

**Example Prompts:**
- "Show me the hierarchy of test suites with depth 3"
- "Get suite hierarchy for project MCP"
- "Display test suite tree structure"

### `get_root_suites`

**Description:** Get all top-level (root) test suites.

**Example Prompts:**
- "Show me all root suites for project MCP"
- "Get top-level test suites"
- "List root suites"

### `get_all_subsuites`

**Description:** Get all child suites recursively from a parent suite.

**Example Prompts:**
- "Get all subsuites from root suite 18697"
- "Show me all child suites under suite 17470"
- "List all subsuites for suite 491"

### `get_tcm_suite_by_id`

**Description:** Find specific test suite by its ID.

**Example Prompts:**
- "Get details for suite 17470"
- "Show me suite 18697"
- "What's in test suite 491?"

### `get_tcm_test_suites_by_project`

**Description:** Get comprehensive list of all suites for a project with hierarchy information.

**Example Prompts:**
- "Get all suites for project MCP with hierarchy"
- "Show me all test suites in project MCP"
- "List all suites for MCP"

### `get_root_id_by_suite_id`

**Description:** Find the root suite for any given suite ID.

**Example Prompts:**
- "What's the root suite for suite 12345?"
- "Find root suite for suite 491"
- "Get parent root for suite 17470"

---

## Test Coverage & Validation

### `get_test_coverage_by_test_case_steps_by_key`

**Description:** Analyze how well automation code implements test case steps.

**Example Prompts:**
- "Analyze coverage for MCP-2107 against this implementation code: [paste code]"
- "Check if test case MCP-1921 is implemented correctly in this code"
- "Validate coverage for MCP-88 with this automation code"

### `get_enhanced_test_coverage_with_rules`

**Description:** Rules-based coverage analysis with framework detection and intelligent validation.

**Example Prompts:**
- "Enhanced coverage analysis for MCP-2107 with framework detection"
- "Analyze MCP-1921 coverage with rules validation"
- "Check test case MCP-88 implementation with enhanced rules"

### `validate_test_case`

**Description:** Quality validation with automated improvement suggestions using intelligent rules.

**Example Prompts:**
- "Validate test case MCP-2107 and suggest improvements"
- "Check quality of test case MCP-1921"
- "Validate MCP-88 and tell me what needs to be improved"

### `improve_test_case`

**Description:** Dedicated tool for improving test case quality with specific suggestions.

**Example Prompts:**
- "Improve test case MCP-2107 with specific suggestions"
- "Help me improve test case MCP-1921"
- "Suggest improvements for MCP-88"

---

## Test Code Generation

### `generate_draft_test_by_key`

**Description:** Generate test automation code with framework detection (Java/Carina, Python/Pytest, etc.).

**Example Prompts:**
- "Generate Java/Carina test for MCP-2107 based on this implementation"
- "Create Python pytest for test case MCP-1921"
- "Generate automation code for MCP-88 using Java and Carina framework"

---

## Duplicate Detection

### `analyze_test_cases_duplicates`

**Description:** Find and group similar test cases by step similarity with configurable threshold.

**Example Prompts:**
- "Analyze suite 17470 for duplicates with 80% similarity threshold"
- "Find duplicate test cases in suite 18697"
- "Check suite 491 for similar test cases"

### `analyze_test_cases_duplicates_semantic`

**Description:** Advanced semantic analysis with LLM-powered step clustering and medoid selection.

**Example Prompts:**
- "Semantic analysis of suite 17470 with step clustering"
- "Find semantically similar test cases in suite 18697 using AI"
- "Analyze suite 491 for duplicates with semantic clustering"

---

## Feature-Based Test Case Aggregation

### `aggregate_test_cases_by_feature`

**Description:** Find ALL test cases related to a specific feature keyword across the entire project. Searches in title, description, preconditions, post-conditions, and test steps (case-insensitive, partial match). Groups results by Root Suite and Feature Suite hierarchy.

**Key Features:**
- Comprehensive search across all test case fields
- Smart grouping by suite hierarchy
- Automatic deduplication
- Ready-to-use automation tags generation
- Multiple output formats

**Parameters:**
- `project_key` (required) - Project key (e.g., 'MCPAND', 'MCP')
- `feature_keyword` (required) - Feature keyword to search for
- `output_format` - Output format: `detailed`, `short` (default), `dto`, `test_run_rules`
- `tags_format` - Tags output: `by_root_suite` (default) or `single_line`
- `max_results` - Maximum test cases to process (default: 500, max: 2000)

**Example Prompts:**
- "Find all test cases related to 'login' feature in project MCP"
- "Aggregate test cases for 'payment' in project MCPAND with detailed output"
- "Get automation tags for all test cases mentioning 'diary' feature"
- "Show me all 'food search' related test cases grouped by suite"
- "Generate test run rules for 'onboarding' feature"

**Output Formats:**
- `short` - Summary view with test case keys and titles (recommended for quick review)
- `detailed` - Full hierarchy with tables and complete information
- `dto` - JSON format for programmatic use
- `test_run_rules` - Ready-to-use TAGS for automation test runs

**Use Cases:**
1. **Feature Testing:** Find all test cases for a feature before release
2. **Test Planning:** Generate automation tags for feature-specific test runs
3. **Gap Analysis:** Identify features with comprehensive test coverage
4. **Regression Testing:** Build targeted test suites based on feature keywords

---

## Test Run Management

### `list_test_runs`

**Description:** Advanced filtering of test runs by date range, status, platform, and more.

**Example Prompts:**
- "Get test runs from last 30 days with status 'FAILED'"
- "Show me test runs from last week for iOS platform"
- "Find test runs from November 2025 that failed"

### `get_test_run_by_id`

**Description:** Get detailed information for a specific test run.

**Example Prompts:**
- "Get details for test run 12345"
- "Show me test run 67890"
- "What happened in test run 54321?"

### `list_test_run_test_cases`

**Description:** Get all test cases associated with a specific test run.

**Example Prompts:**
- "Show me all test cases in test run 12345"
- "List test cases for test run 67890"
- "What test cases were in test run 54321?"

### `get_test_run_result_statuses`

**Description:** Get available result statuses configured for a project.

**Example Prompts:**
- "What result statuses are configured for project MCP?"
- "Show me available test run statuses"
- "List result statuses for MCP"

### `get_test_run_configuration_groups`

**Description:** Get configuration options and groups for test runs.

**Example Prompts:**
- "Show me configuration groups for project MCP"
- "What test run configurations are available?"
- "List configuration groups"

---

## Platform & Results Analysis

### `get_platform_results_by_period`

**Description:** Get test results grouped by platform for a specific time period.

**Example Prompts:**
- "Get iOS test results for the last 7 days"
- "Show me Android test results from last week"
- "Get platform results for last 30 days"

### `get_top_bugs`

**Description:** Get most frequent defects/bugs from test executions.

**Example Prompts:**
- "Show me top 10 bugs from last week"
- "What are the most common bugs?"
- "Get top bugs from last 30 days"

### `get_bug_review`

**Description:** Get comprehensive bug review with detailed failure information, defect tracking, reproduction dates, and **automatic failure detail fetching** for single-call analysis.

**Key Features:**
- Detailed bug review with failure analysis
- Defect tracking with Jira/issue tracker links
- Historical data (first seen and last reproduction dates)
- Configurable time periods (Last 7/14/30/90 Days, Week, Month, Quarter)
- Multiple output formats (detailed, summary, json)
- **NEW: Automatic failure detail fetching** - No need for separate calls
- **NEW: Priority analysis** - Bugs categorized as Critical/High/Medium/Low
- **NEW: Trend analysis** - Recently introduced, long-standing, frequently reproduced
- **NEW: Recommendations section** - Actionable insights

**New Parameters:**
- `include_failure_details` (boolean, default: false) - When true, automatically fetches detailed failure info for each bug
- `failure_detail_level` ('none' | 'summary' | 'full', default: 'summary') - Level of detail to fetch
- `max_details_limit` (number, default: 30, max: 50) - Max bugs to fetch details for

**Example Prompts:**
- "Show me detailed bug review for last 7 days"
- "Get bug review for Android project from last 14 days with failure details"
- "Show me top 10 bugs with full failure analysis for iOS"
- "Give me a comprehensive bug analysis for IOS with priority breakdown"
- `{ project: "ios", period: "Last 7 Days", limit: 10, include_failure_details: true, failure_detail_level: "full" }`

### `get_bug_failure_info`

**Description:** Get comprehensive failure information for a specific bug/hashcode, including high-level failure summary and detailed list of affected test runs. This tool combines data from multiple SQL widgets to provide complete failure analysis.

**Key Features:**
- Combines failure info (templateId: 6) and failure details (templateId: 10)
- Shows error/stability information
- Lists all affected test runs with links
- Includes defect associations for each failure
- Multiple output formats (detailed, summary, json)
- Requires dashboardId and hashcode from bug review

**Example Prompts:**
- "Get failure info for hashcode 1051677506 on dashboard 99"
- "Show me detailed failures for this bug hashcode"
- "Analyze failure information for hashcode X from last 14 days"
- "Give me a summary of test runs affected by this failure"

**Usage Note:** The dashboardId and hashcode can be obtained from the `get_bug_review` tool output. Each bug in the review includes these identifiers in the failure link.

### `get_project_milestones`

**Description:** Get all milestones configured for a project.

**Example Prompts:**
- "Get all milestones for project MCP"
- "Show me available milestones"
- "List milestones for MCP"

---

## Project Discovery

### `get_available_projects`

**Description:** Discover all projects you have access to in Zebrunner.

**Example Prompts:**
- "What projects can I access?"
- "Show me all available projects"
- "List all projects I have access to"

### `test_reporting_connection`

**Description:** Test API connectivity and authentication with Zebrunner Reporting API.

**Example Prompts:**
- "Test my connection to Zebrunner"
- "Check if I can connect to Zebrunner reporting"
- "Verify my Zebrunner API access"

---

## 💡 Tips for Using Tools

### Natural Language Flexibility

All tools support natural language queries. Claude will automatically:
- Extract parameters from your question
- Choose the right tool
- Format the output appropriately

### Combining Tools

You can chain multiple tools in conversation:

```
"Get execution history for test 5478492, then analyze the current failure and compare with last passed run"
```

Claude will:
1. Call `get_test_execution_history`
2. Call `analyze_test_failure` with comparison enabled
3. Combine results into comprehensive analysis

### URL-Based Analysis

Many tools support direct URL input from Zebrunner UI:

```
"Analyze https://your-workspace.zebrunner.com/projects/MCP/automation-launches/120906/tests/5455325"
```

Claude automatically extracts:
- Project key: MCP
- Launch ID: 120906
- Test ID: 5455325

### Output Formats

Most tools support multiple output formats:
- `string` (markdown) - Human-readable, default
- `json` - Structured data
- `dto` - Detailed structured object
- `jira` - Ready-to-paste Jira tickets

Specify format in your request:
```
"Analyze test failure 5451420 in jira format"
```

### Filtering and Pagination

For large datasets, you can specify filters and limits:

```
"Get test cases from suite 17470, limit to 20, only manual tests"
"Show me first 50 test cases created after 2025-01-01"
```

---

## 🎯 Common Workflows

### Investigating Test Failure

```
1. "Show execution history for test 5478492"
   → See if test was stable before
   
2. "Analyze test 5478492 and compare with last passed execution"
   → Identify what changed
   
3. "Analyze video for test 5478492"
   → Visual verification of failure
```

### Launch Failure Analysis

```
1. "Analyze all failures in launch 120906"
   → Get executive summary and patterns
   
2. "Show me execution history for the most unstable tests"
   → Identify consistently failing tests
   
3. "Generate Jira tickets for failures in launch 120906 in jira format"
   → Create tickets for investigation
```

### Test Case Quality Review

```
1. "Get test case MCP-2107 details"
   → Review test case
   
2. "Validate test case MCP-2107 and suggest improvements"
   → Get quality assessment
   
3. "Check coverage for MCP-2107 against this code: [paste]"
   → Verify implementation
```

### Duplicate Detection

```
1. "Analyze suite 17470 for duplicates with 80% similarity"
   → Find potential duplicates
   
2. "Semantic analysis of suite 17470"
   → Advanced duplicate detection
   
3. "Show me test cases in duplicate group 1"
   → Review specific duplicates
```

---

## 📚 Additional Resources

- **Installation Guide:** [INSTALL-GUIDE.md](INSTALL-GUIDE.md)
- **Security Features:** [change-logs.md](change-logs.md#v5100---security-comprehensive-security-hardening-high--medium-severity-fixes)
- **Changelog:** [change-logs.md](change-logs.md)
- **Screenshot Analysis:** [docs/SCREENSHOT_ANALYSIS.md](docs/SCREENSHOT_ANALYSIS.md)

---

**Last Updated:** v5.15.0 - December 2025

For the latest features and updates, see [change-logs.md](change-logs.md).

