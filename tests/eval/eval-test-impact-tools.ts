import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for test impact analysis (v9.2.8): adv_analyze_test_impact
 * Tool-selection layers 1–2 only; scoring/output covered by unit tests.
 */
export const TEST_IMPACT_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "test_impact.pr_regression",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Analyze test impact for my PR code changes on {{project_key}} — which Zebrunner cases should I run for regression?",
    expectedTools: ["adv_analyze_test_impact"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "test_impact.code_changes",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "Which Zebrunner tests might my code changes affect in project {{project_key}}?",
    expectedTools: ["adv_analyze_test_impact"],
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
      "I'm working in the repo-android codebase — analyze test impact for my changes.",
    expectedTools: ["adv_analyze_test_impact"],
    expectedArgKeys: ["repository_slug"],
    category: "analysis",
    layer: 2,
  },
  {
    id: "test_impact.neg.not_suite_smart",
    toolSection: "1. TCM — Test impact (v9.2.8)",
    promptTemplate:
      "For test impact on {{project_key}}, use adv_analyze_test_impact — do NOT pull the full suite via adv_get_test_cases_by_suite_smart.",
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
      "Analyze which tests my {{project_key}} code change affects using the dedicated impact tool, not adv_aggregate_test_cases_by_feature.",
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
    promptTemplate: "/test-impact project: {{project_key}}",
    expectedTools: ["adv_analyze_test_impact"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
];
