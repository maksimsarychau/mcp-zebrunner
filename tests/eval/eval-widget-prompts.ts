import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval prompts for Zebrunner dashboard widgets (22 templates).
 * Mirrors docs/TEST_PROMPTS.md §18 and tests/api-verify.sh W-TPL* / TCM-* smokes.
 *
 * Templates without a dedicated MCP tool route to the closest Tier A / report proxy;
 * TCM analytics widgets (37777–37779) use test-case filter tools until v9.2.4 hubs ship.
 */
export const WIDGET_EVAL_PROMPTS: EvalPrompt[] = [
  // ── TCM widgets (37780–37779) ──

  {
    id: "widget.tpl37780.suite_scoped",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Show test case distribution by automation state for root suite {{suite_id}} in {{project_key}} including all subsuites — use the distribution-by-field dashboard widget tool.",
    expectedTools: ["adv_get_test_case_distribution_by_field"],
    expectedArgKeys: ["project", "root_suite_ids"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "suiteId"],
  },
  {
    id: "widget.tpl37777.net_change",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "I need TCM test case net change over the last 90 days for {{project_key}}. Use test case date filters or counts — not the pie distribution widget.",
    expectedTools: ["adv_get_test_case_by_filter", "adv_get_test_cases_advanced"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "analysis",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl37778.updated_by_user",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Which users updated the most test cases on {{project_key}} in the last 30 days? Use TCM case listing/filter tools — there is no dedicated 'updated by user' widget MCP tool yet.",
    expectedTools: ["adv_get_test_case_by_filter", "adv_get_test_cases_advanced"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field", "adv_get_bug_review"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl37779.created_by_user",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Show test cases created on {{project_key}} in the last 30 days grouped by author using TCM filters (created date), not launch reporting.",
    expectedTools: ["adv_get_test_case_by_filter", "adv_get_test_cases_advanced"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field", "adv_get_all_launches_for_project"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },

  // ── TAM SQL widgets (18) ──

  {
    id: "widget.tpl1.execution_roi",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "What is automation execution ROI (time saved vs manual effort) for {{project_key}} over the last 7 days?",
    expectedTools: ["adv_analyze_regression_runtime", "adv_generate_report"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl3.pass_rate_bar",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Show pass rate broken down by priority for {{project_key}} over {{period}} using the pass-rate-by-period widget tool.",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project", "period"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey", "period"],
  },
  {
    id: "widget.tpl4.top_defects",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Dashboard widget: top defects by failure count for {{project_key}} over the last 7 days.",
    expectedTools: ["adv_get_top_bugs"],
    expectedArgKeys: ["project"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl5.pass_rate_line",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Daily pass and fail trend line for {{project_key}} over {{period}} — use the platform pass-rate widget, not launch-by-launch listing.",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project", "period"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey", "period"],
  },
  {
    id: "widget.tpl6.failure_info",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Get failure stability summary for hashcode {{bug_hashcode}} on dashboard {{dashboard_id}} in {{project_key}} (failure info widget).",
    expectedTools: ["adv_get_bug_failure_info"],
    expectedArgKeys: ["project", "hashcode", "dashboardId"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "bugHashcode", "dashboardId"],
  },
  {
    id: "widget.tpl7.authoring_trend",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "How many test cases were created per day on {{project_key}} in the last 14 days? Use TCM created-date filters, not the distribution pie widget.",
    expectedTools: ["adv_get_test_case_by_filter", "adv_get_test_cases_advanced"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl8.pass_rate_pie",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Overall pass rate pie breakdown for {{project_key}} this week using the pass-rate-by-period widget.",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl8.dynamic_period",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Pass rate for {{project_key}} from start of last month through today using dynamic widget period mode (not a fixed preset string only).",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project", "period_mode"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl9.failures_by_reason",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Bug review / failures-by-reason dashboard for {{project_key}} covering today.",
    expectedTools: ["adv_get_bug_review"],
    expectedArgKeys: ["project"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl10.failure_details",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "List affected runs and tests for hashcode {{bug_hashcode}} on dashboard {{dashboard_id}} in {{project_key}} (failure details widget).",
    expectedTools: ["adv_get_bug_failure_info"],
    expectedArgKeys: ["project", "hashcode", "dashboardId"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "bugHashcode", "dashboardId"],
  },
  {
    id: "widget.tpl14.tests_summary",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Tests summary table: passed, failed, and total grouped by build for {{project_key}} over {{period}}. Use generate_report pass_rate or platform results — not a single launch summary.",
    expectedTools: ["adv_generate_report", "adv_get_platform_results_by_period"],
    forbiddenTools: ["adv_get_launch_test_summary"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "period"],
  },
  {
    id: "widget.tpl16.stability_table",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Which automated tests fell below 99% stability on {{project_key}} in the last 24 hours? Use flaky/stability detection — not the pass-rate pie widget.",
    expectedTools: ["adv_find_flaky_tests"],
    forbiddenTools: ["adv_get_platform_results_by_period", "adv_get_launch_test_summary"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl17.pass_rate_combo",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Combined pass-rate dashboard (pie plus daily trend) for {{project_key}} over {{period}}.",
    expectedTools: ["adv_generate_report", "adv_get_platform_results_by_period"],
    expectedArgKeys: ["project"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "period"],
  },
  {
    id: "widget.tpl90.calendar_heatmap",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Calendar heatmap of daily pass rate for {{project_key}} in 2026 Q2 with 75% green threshold — use platform pass-rate widget with quarter period.",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project", "period"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "period"],
  },
  {
    id: "widget.tpl131.execution_duration",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Daily test execution duration trend for {{project_key}} over the last 7 days — regression runtime analytics, not launch listing.",
    expectedTools: ["adv_analyze_regression_runtime", "adv_get_platform_results_by_period"],
    forbiddenTools: ["adv_get_all_launches_for_project"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl40112.failure_tag_pie",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Failure tag distribution pie for {{project_key}} in the last 24 hours — use top bugs / defect analytics, not TCM distribution.",
    expectedTools: ["adv_get_top_bugs", "adv_get_bug_review"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl55991.tags_maintainer",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Cross-tab of failure tags and maintainers for {{project_key}} today using bug review / failure analytics.",
    expectedTools: ["adv_get_bug_review", "adv_get_top_bugs"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl57086.jira_maintainer",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Map Jira issues to maintainers by failure count on {{project_key}} for the last 14 days.",
    expectedTools: ["adv_get_top_bugs", "adv_get_bug_review"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.tpl57085.launch_duration",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Launch duration trend for suite {{suite_name}} on {{project_key}} this quarter — use regression/runtime analytics, not TCM suite listing alone.",
    expectedTools: ["adv_analyze_regression_runtime", "adv_get_all_launches_with_filter"],
    forbiddenTools: ["adv_list_test_suites"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey", "suiteName"],
  },

  // ── Multi-tool widget workflows ──

  {
    id: "widget.chain.bug_triage",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Run a bug review for {{project_key}} today, then get failure info for the top hashcode (templates 9 → 6).",
    expectedTools: ["adv_get_bug_review", "adv_get_bug_failure_info"],
    category: "analysis",
    layer: 3,
    isMultiTool: true,
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.e2e.coverage_dashboard",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "For {{project_key}}: pie of cases by automation state (distribution widget), plus pass rate for {{period}}, plus top 5 defects.",
    expectedTools: [
      "adv_get_test_case_distribution_by_field",
      "adv_get_platform_results_by_period",
      "adv_get_top_bugs",
    ],
    category: "e2e_metric",
    layer: 3,
    isMultiTool: true,
    requiredContext: ["projectKey", "period"],
  },

  // ── Widget disambiguation negatives ──

  {
    id: "widget.neg.roi_not_distribution",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Execution ROI widget for {{project_key}} last 7 days — do NOT use the TCM distribution-by-field pie tool.",
    expectedTools: ["adv_analyze_regression_runtime", "adv_generate_report"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.neg.stability_not_pass_rate",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Low stability tests table (below 99%) for {{project_key}} — use flaky detection, NOT pass-rate-by-period.",
    expectedTools: ["adv_find_flaky_tests"],
    forbiddenTools: ["adv_get_platform_results_by_period"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "widget.neg.tags_not_tcm_pie",
    toolSection: "18. Dashboard Widgets",
    promptTemplate:
      "Failure tag pie for {{project_key}} — defect/failure widgets only, not TCM case distribution.",
    expectedTools: ["adv_get_top_bugs", "adv_get_bug_review"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "negative",
    layer: 1,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
];

/** Template IDs validated by tests/unit/eval-widget-prompts.test.ts */
export const WIDGET_TEMPLATE_IDS = [
  "37780",
  "37777",
  "37778",
  "37779",
  "1",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "14",
  "16",
  "17",
  "90",
  "131",
  "40112",
  "55991",
  "57086",
  "57085",
] as const;
