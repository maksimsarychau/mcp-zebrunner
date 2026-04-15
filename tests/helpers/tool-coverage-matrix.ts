export const TOOL_SMOKE_INPUTS: Record<string, Record<string, unknown>> = {
  list_test_suites: { project_key: "MCP" },
  get_test_case_by_key: { project_key: "MCP", case_key: "MCP-1" },
  get_all_subsuites: { project_key: "MCP", root_suite_id: 1 },
  get_test_cases_advanced: { project_key: "MCP" },
  get_suite_hierarchy: { project_key: "MCP" },
  get_test_cases_by_automation_state: { project_key: "MCP", automation_states: "Manual" },
  get_automation_states: { project_key: "MCP" },
  get_test_case_by_title: { project_key: "MCP", title: "login" },
  get_test_case_by_filter: { project_key: "MCP" },
  get_automation_priorities: { project_key: "MCP" },
  get_test_coverage_by_test_case_steps_by_key: { project_key: "MCP", case_key: "MCP-1", implementation_code: "test" },
  generate_draft_test_by_key: { project_key: "MCP", case_key: "MCP-1", implementation_context: "context" },
  get_enhanced_test_coverage_with_rules: { project_key: "MCP", case_key: "MCP-1", implementation_code: "test" },
  get_tcm_test_suites_by_project: { project_key: "MCP" },
  get_all_tcm_test_case_suites_by_project: { project_key: "MCP" },
  get_root_suites: { project_key: "MCP" },
  get_tcm_suite_by_id: { project_key: "MCP", suite_id: 1, mode: "simple" },
  get_all_tcm_test_cases_by_project: { project_key: "MCP" },
  get_all_tcm_test_cases_with_root_suite_id: { project_key: "MCP" },
  get_root_id_by_suite_id: { project_key: "MCP", suite_id: 1 },
  get_test_cases_by_suite_smart: { project_key: "MCP", suite_id: 1 },
  get_launch_details: { project_key: "MCP", launch_id: 1 },
  get_launch_test_summary: { project_key: "MCP", launch_id: 1 },
  generate_weekly_regression_stability_report: { project_key: "MCP", suites: [] },
  get_launch_summary: { project_key: "MCP", launch_id: 1 },
  analyze_test_failure: { projectKey: "MCP", testRunId: 1, testId: 1 },
  get_test_execution_history: { projectKey: "MCP", testId: 1 },
  download_test_screenshot: { screenshot_url: "/files/sample" },
  analyze_screenshot: { screenshot_url: "/files/sample" },
  analyze_test_execution_video: { projectKey: "MCP", testRunId: 1, testId: 1 },
  detailed_analyze_launch_failures: { projectKey: "MCP", testRunId: 1 },
  get_all_launches_for_project: { project_key: "MCP" },
  get_all_launches_with_filter: { project_key: "MCP" },
  test_reporting_connection: {},
  about_mcp_tools: { mode: "summary" },
  get_platform_results_by_period: { project: "android", period: "Today" },
  get_top_bugs: { project: "android", period: "Month" },
  get_bug_review: { project: "android", period: "Last 30 Days" },
  get_bug_failure_info: { project: "android", dashboardId: 99, hashcode: "abc", period: "Week" },
  get_project_milestones: { project: "android" },
  get_available_projects: {},
  validate_test_case: { project_key: "MCP", case_key: "MCP-1" },
  improve_test_case: { project_key: "MCP", case_key: "MCP-1" },
  list_test_runs: { project: "android" },
  get_test_run_by_id: { project: "android", id: 1 },
  list_test_run_test_cases: { project: "android", testRunId: 1 },
  get_test_run_result_statuses: { project: "android" },
  get_test_run_configuration_groups: { project: "android" },
  analyze_test_cases_duplicates: { project_key: "MCP", suite_id: 1 },
  analyze_test_cases_duplicates_semantic: { project_key: "MCP", suite_id: 1 },
  aggregate_test_cases_by_feature: { project_key: "MCP", feature_keyword: "login" },
  analyze_regression_runtime: { project: "android", milestone: "develop-49771" },
  find_flaky_tests: { project: "android", period_days: 14 },
  generate_report: { report_types: ["quality_dashboard"], projects: ["android", "ios"], period: "Last 30 Days" },
  create_test_suite: { project_key: "MCP", title: "Smoke Suite", dry_run: true },
  update_test_suite: { project_key: "MCP", suite_id: 1, title: "Smoke Suite", dry_run: true },
  create_test_case: { project_key: "MCP", test_suite_id: 1, title: "Smoke TC", dry_run: true },
  update_test_case: { project_key: "MCP", identifier: 1, title: "Smoke TC", dry_run: true },
  manage_test_run: { project_key: "MCP", action: "create", title: "Smoke Run", dry_run: true },
  import_launch_results_to_test_run: { project_key: "MCP", test_run_id: 1, launch_id: 1, dry_run: true }
};

export const TOOL_SCHEMA_REQUIRED_KEYS: Record<string, string[]> = Object.fromEntries(
  Object.entries(TOOL_SMOKE_INPUTS).map(([tool, input]) => [tool, Object.keys(input)])
);

/**
 * Manifest of registered MCP resources (static + template).
 * Mirrors the 8 resources in src/resources.ts.
 */
export const RESOURCE_MANIFEST: Record<string, { uri: string; type: "static" | "template" }> = {
  available_projects:              { uri: "zebrunner://projects",                                      type: "static" },
  report_types:                    { uri: "zebrunner://reports/types",                                 type: "static" },
  project_root_suites:             { uri: "zebrunner://projects/{project_key}/suites",                 type: "template" },
  project_automation_states:       { uri: "zebrunner://projects/{project_key}/automation-states",      type: "template" },
  project_priorities:              { uri: "zebrunner://projects/{project_key}/priorities",              type: "template" },
  time_periods:                    { uri: "zebrunner://periods",                                       type: "static" },
  chart_options:                   { uri: "zebrunner://charts",                                        type: "static" },
  output_formats:                  { uri: "zebrunner://formats",                                       type: "static" },
  project_milestones:              { uri: "zebrunner://projects/{project_key}/milestones",              type: "template" },
  project_result_statuses:         { uri: "zebrunner://projects/{project_key}/result-statuses",        type: "template" },
  project_configuration_groups:    { uri: "zebrunner://projects/{project_key}/configuration-groups",   type: "template" },
  project_fields_layout:           { uri: "zebrunner://projects/{project_key}/fields",                 type: "template" },
  project_suite_hierarchy:         { uri: "zebrunner://projects/{project_key}/suite-hierarchy",        type: "template" },
};

/**
 * Manifest of registered MCP prompts (E2E + analysis).
 * Mirrors the 10 prompts in src/prompts.ts.
 */
export const PROMPT_MANIFEST: Record<string, { category: "e2e" | "analysis" | "role"; args: string[] }> = {
  "pass-rate":            { category: "e2e",      args: ["projects"] },
  "runtime-efficiency":   { category: "e2e",      args: ["projects"] },
  "automation-coverage":  { category: "e2e",      args: ["projects"] },
  "executive-dashboard":  { category: "e2e",      args: ["projects"] },
  "release-readiness":    { category: "e2e",      args: ["project", "milestone"] },
  "suite-coverage":       { category: "e2e",      args: ["projects"] },
  "review-test-case":     { category: "analysis", args: ["case_key"] },
  "launch-triage":        { category: "analysis", args: ["project"] },
  "flaky-review":         { category: "analysis", args: ["project"] },
  "find-duplicates":      { category: "analysis", args: ["project", "suite_id"] },
  "daily-qa-standup":     { category: "role",     args: ["projects"] },
  "automation-gaps":      { category: "role",     args: ["projects"] },
  "project-overview":     { category: "role",     args: ["project"] },
};
