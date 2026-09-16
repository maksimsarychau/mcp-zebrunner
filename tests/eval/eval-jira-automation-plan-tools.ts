import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for adv_prepare_jira_automation_plan (v9.4.3).
 */
export const JIRA_AUTOMATION_PLAN_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "jira_plan.suite_url",
    toolSection: "1. TCM — Jira automation plan (v9.4.3)",
    promptTemplate:
      "Prepare a Jira automation plan from this Zebrunner suite link: {{suite_url}}. Return the structured plan as JSON.",
    expectedTools: ["adv_prepare_jira_automation_plan"],
    expectedArgKeys: ["suite_url"],
    category: "tcm",
    layer: 1,
    requiredContext: ["suiteUrl"],
  },
  {
    id: "jira_plan.project_suite",
    toolSection: "1. TCM — Jira automation plan (v9.4.3)",
    promptTemplate:
      "Use adv_prepare_jira_automation_plan for project {{project_key}} suite {{suite_id}} to build QAS automation tasks (plan only, no Jira writes).",
    expectedTools: ["adv_prepare_jira_automation_plan"],
    expectedArgKeys: ["project_key", "suite_id"],
    category: "tcm",
    layer: 2,
    requiredContext: ["projectKey", "suiteId"],
  },
  {
    id: "jira_plan.neg.not_suite_smart",
    toolSection: "1. TCM — Jira automation plan (v9.4.3)",
    promptTemplate:
      "From suite {{suite_url}}, prepare Jira automation parent/subtask plan — use adv_prepare_jira_automation_plan, not adv_get_test_cases_by_suite_smart.",
    expectedTools: ["adv_prepare_jira_automation_plan"],
    forbiddenTools: ["adv_get_test_cases_by_suite_smart"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["suiteUrl"],
  },
  {
    id: "jira_plan.neg.not_create",
    toolSection: "1. TCM — Jira automation plan (v9.4.3)",
    promptTemplate:
      "Build a Jira automation task plan for {{suite_url}}. Plan only — do not create Zebrunner or Jira issues.",
    expectedTools: ["adv_prepare_jira_automation_plan"],
    forbiddenTools: ["adv_create_test_case"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["suiteUrl"],
  },
  {
    id: "jira_plan.neg.no_include_automated_flag",
    toolSection: "1. TCM — Jira automation plan (v9.4.3)",
    promptTemplate:
      "Prepare Jira automation plan JSON for {{suite_url}} for not-yet-automated cases only (default intake states).",
    expectedTools: ["adv_prepare_jira_automation_plan"],
    expectedArgKeys: ["suite_url"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["suiteUrl"],
  },
];
