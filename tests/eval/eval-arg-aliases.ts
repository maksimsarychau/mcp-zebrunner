/**
 * Accepted argument key aliases for eval Layer 2 checks (normalized: lowercase, no underscores).
 */
export const EVAL_ARG_KEY_ALIASES: Record<string, readonly string[]> = {
  project_key: ["project_key", "project", "projectkey"],
  project: ["project", "project_key", "projectkey"],
  launch_id: ["launch_id", "launchid", "testrunid"],
  suite_id: ["suite_id", "suiteid", "testsuiteid", "rootsuiteid"],
  test_suite_id: ["test_suite_id", "testsuiteid", "suite_id", "suiteid"],
  test_run_id: ["test_run_id", "testrunid", "id", "run_id"],
  test_case_keys: ["test_case_keys", "testcasekeys", "case_keys", "casekeys", "keys"],
  case_key: ["case_key", "casekey", "test_case_key", "testcasekey"],
  source_case_key: ["source_case_key", "sourcecasekey", "case_key", "casekey"],
  identifier: ["identifier", "case_key", "casekey", "test_case_key"],
  milestone: ["milestone", "milestonename", "milestone_name"],
  title: ["title", "name"],
  action: ["action"],
  steps: ["steps"],
  period: ["period"],
  report_types: ["report_types", "reporttypes"],
  projects: ["projects", "project_key", "project"],
};

export function normalizeArgKey(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

export function argKeyPresent(
  normalizedArgs: Record<string, unknown>,
  expectedKey: string,
): boolean {
  const candidates = EVAL_ARG_KEY_ALIASES[expectedKey] ?? [expectedKey];
  return candidates.some((c) => normalizeArgKey(c) in normalizedArgs);
}
