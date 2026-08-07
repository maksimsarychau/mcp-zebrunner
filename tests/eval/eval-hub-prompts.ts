import type { EvalPrompt } from "./eval-prompts.js";
import {
  HUB_EXECUTION_MODES,
  HUB_FAILURE_MODES,
  HUB_TCM_MODES,
  PASS_RATE_VIEW_ROWS,
} from "../helpers/hub-widget-matrix.js";

function hubModePrompt(
  id: string,
  mcpTool: string,
  mode: string,
  promptTemplate: string,
  layer: 1 | 2 = 1,
): EvalPrompt {
  return {
    id,
    toolSection: "3. Analysis — Hub tools (v9.2.4)",
    promptTemplate,
    expectedTools: [mcpTool],
    expectedArgKeys: ["project", "mode"],
    category: "analysis",
    layer,
    requiredContext: ["projectKey"],
  };
}

/** Direct MCP hub routing prompts — one per mode + pass-rate views + regressions. */
export const HUB_EVAL_PROMPTS: EvalPrompt[] = [
  ...HUB_TCM_MODES.map(row =>
    hubModePrompt(
      `hub.tcm.${row.mode}`,
      row.mcpTool,
      row.mode,
      row.mode === "net_change"
        ? "Use adv_get_tcm_case_analytics with mode net_change for {{project_key}} over the last 90 days grouped by week."
        : row.mode === "created_by_user"
          ? "Use adv_get_tcm_case_analytics mode created_by_user for {{project_key}} over the last 30 days."
          : "Use adv_get_tcm_case_analytics mode updated_by_user for {{project_key}} over the last 30 days.",
      row.mode === "net_change" ? 2 : 1,
    ),
  ),

  ...HUB_FAILURE_MODES.map(row =>
    hubModePrompt(
      `hub.failure.${row.mode}`,
      row.mcpTool,
      row.mode,
      row.mode === "tag_distribution"
        ? "Call adv_get_failure_analytics with mode tag_distribution for {{project_key}} over the last 24 hours."
        : row.mode === "tags_by_maintainer"
          ? "Call adv_get_failure_analytics mode tags_by_maintainer for {{project_key}} today."
          : "Call adv_get_failure_analytics mode jira_by_maintainer for {{project_key}} over the last 14 days.",
    ),
  ),

  ...HUB_EXECUTION_MODES.map(row =>
    hubModePrompt(
      `hub.execution.${row.mode}`,
      row.mcpTool,
      row.mode,
      row.mode === "roi"
        ? "Call adv_get_execution_analytics mode roi for {{project_key}} over the last 7 days."
        : row.mode === "duration_trend"
          ? "Call adv_get_execution_analytics mode duration_trend for {{project_key}} over the last 7 days."
          : row.mode === "launch_duration"
            ? "Call adv_get_execution_analytics mode launch_duration for suite {{suite_name}} on {{project_key}} this quarter."
            : "Call adv_get_execution_analytics mode stability_table with 99% threshold for {{project_key}} in the last 24 hours.",
      row.mode === "launch_duration" ? 2 : 1,
    ),
  ),

  ...PASS_RATE_VIEW_ROWS.filter(r => r.view !== "pie").map(row => ({
    id: `hub.pass_rate.view_${row.view}`,
    toolSection: "3. Analysis — Pass-rate views (v9.2.4)",
    promptTemplate:
      row.view === "bar"
        ? "Pass rate bar chart by priority for {{project_key}} over {{period}} — use adv_get_platform_results_by_period with view bar."
        : row.view === "line"
          ? "Daily pass/fail line trend for {{project_key}} over {{period}} — pass-rate tool view line."
          : row.view === "calendar"
            ? "Pass rate calendar heatmap for {{project_key}} in 2026 Q2 with 75% threshold — view calendar."
            : row.view === "pie_line"
              ? "Combined pie and daily trend pass rate for {{project_key}} over {{period}} — view pie_line."
              : "Tests summary table grouped by build for {{project_key}} over {{period}} — pass-rate view summary.",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project", "view"],
    category: "analysis" as const,
    layer: row.view === "bar" || row.view === "summary" ? 2 : 1,
    requiredContext: ["projectKey", "period"] as const,
  })),

  {
    id: "hub.regression.pie_default_unchanged",
    toolSection: "3. Analysis — Hub tools (v9.2.4)",
    promptTemplate:
      "What is the pass rate for {{project_key}} over the last 7 days? Use the standard pass-rate-by-period tool (default pie view — do not pass view=bar).",
    expectedTools: ["adv_get_platform_results_by_period"],
    expectedArgKeys: ["project", "period"],
    forbiddenTools: ["adv_get_tcm_case_analytics", "adv_get_failure_analytics"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "hub.failure.period_absolute",
    toolSection: "3. Analysis — Hub tools (v9.2.4)",
    promptTemplate:
      "Failure tag distribution for {{project_key}} from 2026-07-01 to 2026-07-09 — adv_get_failure_analytics tag_distribution with period_mode absolute.",
    expectedTools: ["adv_get_failure_analytics"],
    expectedArgKeys: ["project", "mode", "period_mode", "period_start_date", "period_end_date"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "hub.authoring.trend",
    toolSection: "3. Analysis — Authoring trend (v9.2.5)",
    promptTemplate:
      "Daily test case creation trend for {{project_key}} over the last 14 days — adv_get_test_authoring_trend, NOT net_change or distribution pie.",
    expectedTools: ["adv_get_test_authoring_trend"],
    expectedArgKeys: ["project", "period"],
    forbiddenTools: ["adv_get_tcm_case_analytics", "adv_get_test_case_distribution_by_field"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "hub.neg.failure_not_top_bugs",
    toolSection: "3. Analysis — Hub tools (v9.2.4)",
    promptTemplate:
      "Failure tag distribution pie for {{project_key}} — use adv_get_failure_analytics tag_distribution, NOT adv_get_top_bugs.",
    expectedTools: ["adv_get_failure_analytics"],
    forbiddenTools: ["adv_get_top_bugs"],
    category: "negative",
    layer: 1,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "hub.neg.execution_not_regression_runtime",
    toolSection: "3. Analysis — Hub tools (v9.2.4)",
    promptTemplate:
      "Execution ROI dashboard widget for {{project_key}} — adv_get_execution_analytics mode roi, NOT adv_analyze_regression_runtime.",
    expectedTools: ["adv_get_execution_analytics"],
    forbiddenTools: ["adv_analyze_regression_runtime"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "hub.neg.tcm_not_distribution",
    toolSection: "3. Analysis — Hub tools (v9.2.4)",
    promptTemplate:
      "TCM net change widget for {{project_key}} — adv_get_tcm_case_analytics net_change, NOT distribution-by-field pie.",
    expectedTools: ["adv_get_tcm_case_analytics"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
];
