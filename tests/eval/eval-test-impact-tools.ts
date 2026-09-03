import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for test impact analysis (v9.2.8): adv_analyze_test_impact
 * Tool-selection layers 1–2 only; scoring/output covered by unit tests.
 *
 * Prompts include minimal change metadata so the model can call the tool
 * (it requires ≥1 change signal — features/behaviors/keywords/etc.).
 */
export const TEST_IMPACT_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "test_impact.pr_regression",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Analyze test impact for my PR on {{project_key}} — changes affect diary note editing and serving size display. Which Zebrunner cases should I run for regression?",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["project_key"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.code_changes",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Which Zebrunner tests might my {{project_key}} code changes affect? I changed diary entry validation and quick-log serving size.",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["project_key"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.with_behaviors",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Use adv_analyze_test_impact for {{project_key}} with behaviors about diary editing and serving size recalculation.",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["behaviors", "project_key"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.repository_slug",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "I'm in repo-android — analyze test impact for my changes to bottom navigation and ViewModel state (meal planner tab).",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["repository_slug"],
    category: "analysis",
    layer: 2,
  },
  {
    id: "test_impact.neg.not_suite_smart",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "For {{project_key}} diary note changes, use adv_analyze_test_impact — do NOT pull the full suite via adv_get_test_cases_by_suite_smart.",
    expectedTools: ["adv_analyze_test_impact"],
    forbiddenTools: ["adv_get_test_cases_by_suite_smart"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.neg.not_aggregate_feature",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Analyze which tests my {{project_key}} diary editing code change affects — use adv_analyze_test_impact, not adv_aggregate_test_cases_by_feature.",
    expectedTools: ["adv_analyze_test_impact"],
    forbiddenTools: ["adv_aggregate_test_cases_by_feature"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.neg.not_title_chain",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Run test impact analysis for {{project_key}} diary changes — one adv_analyze_test_impact call, not multiple adv_get_test_case_by_title searches.",
    expectedTools: ["adv_analyze_test_impact"],
    forbiddenTools: ["adv_get_test_case_by_title"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.slash_prompt",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "/test-impact project: {{project_key}} — my changes touch diary notes and serving size recalculation.",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["project_key"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.multi_pr_urls",
    toolSection: "1. TCM — Test impact (v9.3.0)",
    promptTemplate:
      "Analyze test impact for these two {{project_key}} PRs in one call — diary editing and serving size changes. Use change_batches, not separate tool calls.",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["change_batches", "project_key"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.period_merged",
    toolSection: "1. TCM — Test impact (v9.3.0)",
    promptTemplate:
      "Merged PRs on {{project_key}} since last sprint touched meal planner and diary — run period test impact with change_batches from gh pr list.",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["change_batches", "project_key"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
];
