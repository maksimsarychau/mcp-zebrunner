import type { EvalPrompt } from "./eval-prompts.js";

/** Eval routing for adv_get_test_authoring_trend (TAM template 7, v9.2.5). */
export const AUTHORING_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "authoring.daily_default",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "How many test cases were created per day on {{project_key}} over the last 14 days? Use adv_get_test_authoring_trend.",
    expectedTools: ["adv_get_test_authoring_trend"],
    expectedArgKeys: ["project", "period"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "authoring.weekly_quarter",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "Show test case authoring velocity for {{project_key}} this quarter grouped by week — template 7 widget with grouping_period WEEK.",
    expectedTools: ["adv_get_test_authoring_trend"],
    expectedArgKeys: ["project", "period", "grouping_period"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "authoring.period.absolute",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "Test case creation trend for {{project_key}} from 2026-07-01 through 2026-07-09 using adv_get_test_authoring_trend with absolute period_mode (not a preset period string).",
    expectedTools: ["adv_get_test_authoring_trend"],
    expectedArgKeys: ["project", "period_mode", "period_start_date", "period_end_date"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "authoring.compact_json",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "Return compact JSON for the TC development trend on {{project_key}} for the last 30 days (CREATED_AT and AMOUNT rows).",
    expectedTools: ["adv_get_test_authoring_trend"],
    expectedArgKeys: ["project", "period", "format"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "authoring.neg.not_net_change",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "Daily test case creation trend for {{project_key}} — adv_get_test_authoring_trend, NOT adv_get_tcm_case_analytics net_change.",
    expectedTools: ["adv_get_test_authoring_trend"],
    forbiddenTools: ["adv_get_tcm_case_analytics"],
    category: "negative",
    layer: 1,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "authoring.neg.not_distribution",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "TC development trend line chart for {{project_key}} — authoring trend tool, NOT distribution-by-field pie.",
    expectedTools: ["adv_get_test_authoring_trend"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "authoring.neg.not_execution_duration",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "How many test cases were created per day on {{project_key}}? Use template 7 authoring trend, NOT adv_get_execution_analytics duration_trend.",
    expectedTools: ["adv_get_test_authoring_trend"],
    forbiddenTools: ["adv_get_execution_analytics"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
];
