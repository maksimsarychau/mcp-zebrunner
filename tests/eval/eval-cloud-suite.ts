/**
 * Prompts that need a capable cloud model (tool disambiguation, detail/format args,
 * refusal under plausible QA wording, report vs launch routing).
 *
 * Default `npm run test:eval` excludes these; run `npm run test:eval:cloud` before
 * release gating or when changing compact/batch/report behavior.
 */
export type EvalSuite = "default" | "cloud" | "all";

const CLOUD_EVAL_PROMPT_IDS = [
  // v9.2 token-efficient reads — small models miss detail/format or pick list_test_suites
  "batch_get_test_cases.two_keys",
  "get_all_tcm_test_cases_by_project.compact_summary",
  "get_all_tcm_test_cases_by_project.with_call_metrics",
  "get_test_cases_by_suite_smart.summary",
  "neg.confuse.batch_vs_single_fetch",

  // Field-path filtering — models invent non-existent filter tools
  "field_filter.custom_field_exact",
  "field_filter.priority_name",
  "field_filter.title_contains",
  "field_filter.count_manual_only",

  // Ambiguous refusal — plausible QA phrasing tempts a tool call
  "neg.ambig.show_tests",
  "neg.ambig.get_results",
  "neg.ambig.fix_failures",

  // Report generator vs per-launch / platform analytics
  "report.pass_rate",
  "report.executive_dashboard",
  "report.multiple_types",
  "report.release_readiness",
  "neg.confuse.report_vs_launch",
  "get_platform_results_by_period.7days",
  "get_platform_results_by_period.compact",
  "get_test_case_distribution_by_field.automation_state",
  "get_test_case_distribution_by_field.field_name",
  "neg.confuse.distribution_vs_automation_state",
  "widget.tpl37777.net_change",
  "widget.tpl37778.updated_by_user",
  "widget.tpl37779.created_by_user",
  "widget.tpl37780.suite_scoped",
  "widget.tpl6.failure_info",
  "widget.tpl10.failure_details",
  "widget.tpl8.dynamic_period",
  "widget.tpl16.stability_table",
  "widget.chain.bug_triage",
  "widget.e2e.coverage_dashboard",
  "widget.neg.roi_not_distribution",
  "widget.neg.stability_not_pass_rate",
  "hub.tcm.net_change",
  "hub.execution.launch_duration",
  "hub.pass_rate.view_bar",
  "hub.pass_rate.view_summary",
  "hub.regression.pie_default_unchanged",
  "hub.neg.failure_not_top_bugs",
  "hub.neg.execution_not_regression_runtime",
  "hub.neg.tcm_not_distribution",
  "widget.tpl7.authoring_trend",
  "hub.authoring.trend",
  "authoring.weekly_quarter",
  "authoring.period.absolute",
  "authoring.daily_default",
  "authoring.compact_json",
  "authoring.neg.not_net_change",
  "authoring.neg.not_execution_duration",

  // v9.2.5 local Ollama — widget/hub disambiguation, regression, flaky, report routing
  "analyze_regression_runtime.with_baseline",
  "generate_weekly_regression_stability_report.compare",
  "find_flaky_tests.basic_scan",
  "find_flaky_tests.count_only",
  "find_flaky_tests.with_history",
  "find_flaky_tests.with_chart",
  "widget.tpl1.execution_roi",
  "widget.tpl3.pass_rate_bar",
  "widget.tpl4.top_defects",
  "widget.tpl5.pass_rate_line",
  "widget.tpl8.pass_rate_pie",
  "widget.tpl9.failures_by_reason",
  "widget.tpl14.tests_summary",
  "widget.tpl17.pass_rate_combo",
  "widget.tpl90.calendar_heatmap",
  "widget.tpl131.execution_duration",
  "widget.tpl40112.failure_tag_pie",
  "widget.tpl55991.tags_maintainer",
  "widget.tpl57086.jira_maintainer",
  "widget.tpl57085.launch_duration",
  "hub.tcm.created_by_user",
  "hub.tcm.updated_by_user",
  "hub.failure.tag_distribution",
  "hub.failure.tags_by_maintainer",
  "hub.failure.jira_by_maintainer",
  "hub.failure.period_absolute",
  "hub.execution.roi",
  "hub.execution.duration_trend",
  "hub.execution.stability_table",
  "hub.pass_rate.view_line",
  "hub.pass_rate.view_calendar",
  "hub.pass_rate.view_pie_line",
  "chart.launch_summary_pie",
  "report.quality_dashboard",
  "report.coverage",
  "report.runtime_efficiency",
  "resource.report_types_aware",
  "resource.periods_aware",
  "resource.chart_options_aware",
  "resource.projects_context",
  "get_launch_test_summary.stats",
  "analyze_test_failure.forensic",

  // TCM hierarchy / root-suite routing
  "list_test_suites.hierarchy",
  "get_suite_hierarchy.full_tree",
  "get_suite_hierarchy.subtree",
  "get_root_suites.list",
  "get_root_suites.compact",
  "get_all_tcm_test_cases_with_root_suite_id.enriched",
  "neg.confuse.suites_via_launch",
  "neg.confuse.single_suite_vs_report",

  // Multi-tool E2E metric chains
  "e2e.pass_rate",
  "e2e.automation_coverage",
  "e2e.release_readiness",

  // Chart / analysis disambiguation
  "chart.text_fallback",
  "neg.confuse.chart_vs_analyze",
  "neg.confuse.flaky_vs_history",

  // Mutation — complex arg shapes and source_case_key routing
  "mut.create_tc.preview",
  "mut.create_tc.source_copy",
  "mut.update_tc.priority",
  "mut.create_suite.preview",
  "mut.update_tc.description",
  "mut.manage_run.update",
  "mut.manage_run.add_cases",
  "mut.import_results.basic",
  "mut.import_results.filtered",

  // Local Ollama flaky — bulk/pagination, disambiguation, charts, reports, L3
  "list_test_suites.count",
  "get_test_cases_advanced.excluding_deprecated",
  "get_tcm_test_suites_by_project.paginated",
  "get_all_tcm_test_case_suites_by_project.all",
  "get_all_tcm_test_cases_by_project.full_export",
  "get_test_cases_by_suite_smart.auto_detect",
  "get_all_launches_with_filter.by_milestone",
  "get_test_coverage_by_steps.full",
  "chart.launches_stacked_bar",
  "chart.execution_history_line",
  "report.custom_targets",
  "report.coverage_exclude_patterns",
  "get_launch_summary.quick",
  "get_test_execution_history.trend",

  // Additional local-Ollama flaky (v9.2.1 pass 2) — core TCM reads, analysis, test runs
  "list_test_suites.basic",
  "get_test_case_by_key.full",
  "get_test_case_by_key.markdown",
  "get_all_subsuites.flat",
  "get_test_cases_advanced.by_suite",
  "get_test_cases_by_automation_state.automated",
  "get_automation_states.list",
  "get_test_case_by_title.search",
  "get_test_case_by_filter.date_range",
  "get_automation_priorities.list",
  "get_tcm_suite_by_id.find",
  "get_root_id_by_suite_id.resolve",
  "improve_test_case.auto",
  "generate_draft_test_by_key.auto",
  "get_enhanced_test_coverage_with_rules.validate",
  "mut.update_suite.rename",
  "mut.manage_run.create",
  "get_launch_details.full",
  "get_test_run_by_id.details",
  "list_test_run_test_cases.cases",
] as const;

export type CloudEvalPromptId = (typeof CLOUD_EVAL_PROMPT_IDS)[number];

const CLOUD_ID_SET = new Set<string>(CLOUD_EVAL_PROMPT_IDS);

export function isCloudEvalPrompt(id: string): boolean {
  return CLOUD_ID_SET.has(id);
}

export function resolveEvalSuite(): EvalSuite {
  const raw = process.env.EVAL_SUITE?.trim().toLowerCase();
  if (!raw || raw === "default") return "default";
  if (raw === "cloud") return "cloud";
  if (raw === "all") return "all";
  throw new Error(
    `Invalid EVAL_SUITE="${raw}". Must be default, cloud, or all.`,
  );
}

/**
 * default — full catalog minus cloud-only tricky prompts (local Ollama friendly)
 * cloud   — only tricky prompts (release gate on capable model)
 * all     — entire catalog (legacy full run)
 */
export function shouldIncludePromptInSuite(id: string, suite: EvalSuite): boolean {
  const isCloud = isCloudEvalPrompt(id);
  switch (suite) {
    case "cloud":
      return isCloud;
    case "all":
      return true;
    case "default":
      return !isCloud;
  }
}

export function cloudEvalPromptIds(): readonly string[] {
  return CLOUD_EVAL_PROMPT_IDS;
}
