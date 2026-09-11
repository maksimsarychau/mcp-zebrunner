import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for TCM field change history (v9.4.0+) and related history reads (v9.3.2+).
 * Layers 1–2 only — recency/pagination correctness is covered by unit tests and api-verify.
 */
export const FIELD_HISTORY_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "field_history.manual_only_transition",
    toolSection: "1. TCM — Field history (v9.4.0+)",
    promptTemplate:
      "Find test cases in {{project_key}} where Manual Only **changed** from Yes to No in the last 60 days. " +
      "Use the TCM field change history search tool — not a filter for cases that are currently Manual Only = Yes.",
    expectedTools: ["adv_find_field_history_changes"],
    expectedArgKeys: ["project_key", "field"],
    category: "field_filter",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.with_transition_args",
    toolSection: "1. TCM — Field history (v9.4.0+)",
    promptTemplate:
      "Call adv_find_field_history_changes for {{project_key}} where customField.manualOnly went from Yes to No " +
      "on or after 2026-07-01T00:00:00Z. Pass field, from_value, to_value, and changed_after explicitly.",
    expectedTools: ["adv_find_field_history_changes"],
    expectedArgKeys: ["project_key", "field", "from_value", "to_value", "changed_after"],
    category: "field_filter",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.build_index",
    toolSection: "1. TCM — Field history index (v9.4.1+)",
    promptTemplate:
      "Build the local TCM field history index for {{project_key}} so later Manual Only transition queries run in milliseconds. " +
      "Use adv_build_field_history_index — not repeated live scans.",
    expectedTools: ["adv_build_field_history_index"],
    expectedArgKeys: ["project_key"],
    category: "field_filter",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.build_continue",
    toolSection: "1. TCM — Field history index (v9.4.1+)",
    promptTemplate:
      "Resume the partial TCM field history index build for {{project_key}} with continue_build=true until complete=true.",
    expectedTools: ["adv_build_field_history_index"],
    expectedArgKeys: ["project_key", "continue_build"],
    category: "field_filter",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.single_case_audit",
    toolSection: "1. TCM — Change history (v9.3.2+)",
    promptTemplate:
      "Show the full TCM audit change history for test case {{test_case_key}} including Manual Only and automation state updates. " +
      "Use adv_get_test_case_by_key with include_history=true and history_filter=all — not a whole-project field history scan.",
    expectedTools: ["adv_get_test_case_by_key"],
    expectedArgKeys: ["case_key", "include_history"],
    forbiddenTools: ["adv_find_field_history_changes"],
    category: "tcm",
    layer: 2,
    requiredContext: ["testCaseKey"],
  },
  {
    id: "field_history.distribution_case_status",
    toolSection: "3. Analysis — Distribution (v9.4.1+)",
    promptTemplate:
      "Show test case distribution by Case Status for {{project_key}} using adv_get_test_case_distribution_by_field " +
      "with system_field CASE_STATUS (custom-layout tenants) — not a field transition history search.",
    expectedTools: ["adv_get_test_case_distribution_by_field"],
    expectedArgKeys: ["project", "system_field"],
    forbiddenTools: ["adv_find_field_history_changes"],
    category: "analysis",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.neg.not_field_filter",
    toolSection: "1. TCM — Field history (v9.4.0+)",
    promptTemplate:
      "How many test cases in {{project_key}} **currently** have Manual Only = Yes? Just the count of today's snapshot — " +
      "do NOT use adv_find_field_history_changes (that tool is for audit transitions over time).",
    expectedTools: ["adv_get_test_cases_advanced", "adv_get_test_case_by_filter"],
    forbiddenTools: ["adv_find_field_history_changes"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.neg.not_distribution",
    toolSection: "1. TCM — Field history (v9.4.0+)",
    promptTemplate:
      "List {{project_key}} cases whose Manual Only field **changed** from Yes to No since July 2026 — use adv_find_field_history_changes, " +
      "NOT adv_get_test_case_distribution_by_field (that is a snapshot pie widget).",
    expectedTools: ["adv_find_field_history_changes"],
    forbiddenTools: ["adv_get_test_case_distribution_by_field"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "field_history.neg.not_advanced_scan",
    toolSection: "1. TCM — Field history (v9.4.0+)",
    promptTemplate:
      "Find {{project_key}} test cases with Manual Only audit transitions Yes→No in the last 90 days — one adv_find_field_history_changes call, " +
      "not adv_get_test_cases_advanced with a manualOnly filter.",
    expectedTools: ["adv_find_field_history_changes"],
    forbiddenTools: ["adv_get_test_cases_advanced", "adv_get_test_case_by_filter"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
];
