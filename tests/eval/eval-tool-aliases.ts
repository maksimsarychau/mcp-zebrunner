/**
 * Common LLM tool-name mistakes (especially small local models).
 * Maps hallucinated names → canonical adv_* tool the eval expects.
 */
export const EVAL_TOOL_NAME_ALIASES: Record<string, string> = {
  adv_get_test_cases_by_title: "adv_get_test_case_by_title",
  adv_get_test_cases_by_filter: "adv_get_test_case_by_filter",
  adv_get_test_suite_by_id: "adv_get_tcm_suite_by_id",
};

export function normalizeEvalToolName(name: string): string {
  const canonical = name.startsWith("adv_") ? name : `adv_${name}`;
  return EVAL_TOOL_NAME_ALIASES[canonical] ?? canonical;
}
