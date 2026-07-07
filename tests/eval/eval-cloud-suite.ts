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
  "mut.create_tc.source_copy",
  "mut.update_tc.priority",
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
