/**
 * Just-in-time "next step" steering hints appended to mutation tool responses.
 * Inspired by the Strands Agents steering pattern: deliver targeted guidance
 * at the moment the LLM needs it, rather than front-loading everything into
 * the system prompt.
 */

export type SteeringTool =
  | "create_test_suite"
  | "create_test_case"
  | "create_test_case_preview"
  | "update_test_case"
  | "manage_test_run_create"
  | "manage_test_run_update"
  | "manage_test_run_add_cases"
  | "import_launch_results"
  | "rerun_launch_failures"
  | "start_launch";

export interface SteeringContext {
  /** Primary entity ID (suite ID, test case key, run ID, etc.) */
  id: string | number;
  /** Whether the inline quality review was already executed */
  reviewUsed?: boolean;
}

const DRAFT_NOTE = "Note: All created test cases are draft. Review and publish manually or use adv_update_test_case.";

export function steeringHint(tool: SteeringTool, ctx: SteeringContext): string {
  switch (tool) {
    case "create_test_suite":
      return (
        `\n\nTip: Next steps:\n` +
        `  - Add test cases: adv_create_test_case with test_suite_id: ${ctx.id}\n` +
        `  - Create sub-suite: adv_create_test_suite with parent_suite_id: ${ctx.id}`
      );

    case "create_test_case_preview":
      return `\nNote: Created test case will be forced to draft=true. Review and publish manually or use adv_update_test_case.\n`;

    case "create_test_case":
      if (!ctx.reviewUsed) {
        return (
          `\n\nTip: Next steps:\n` +
          `  - Quality check: adv_validate_test_case with case_key: "${ctx.id}"\n` +
          `  - Publish (remove draft): adv_update_test_case with identifier: "${ctx.id}", draft: false\n` +
          DRAFT_NOTE
        );
      }
      return (
        `\n\nTip: Next step:\n` +
        `  - Publish (remove draft): adv_update_test_case with identifier: "${ctx.id}", draft: false\n` +
        DRAFT_NOTE
      );

    case "update_test_case":
      if (ctx.reviewUsed) return "";
      return `\n\nTip: Verify quality: adv_validate_test_case with case_key: "${ctx.id}"`;

    case "manage_test_run_create":
      return (
        `\n\nTip: Next steps:\n` +
        `  - Populate the run: adv_manage_test_run with action: "add_cases", test_run_id: ${ctx.id}\n` +
        `  - Import launch results: adv_import_launch_results_to_test_run with test_run_id: ${ctx.id}`
      );

    case "manage_test_run_update":
      return `\n\nTip: Use adv_list_test_run_test_cases with test_run_id: ${ctx.id} to see current test case assignments.`;

    case "manage_test_run_add_cases":
      return (
        `\n\nTip: Next steps:\n` +
        `  - Import results: adv_import_launch_results_to_test_run with test_run_id: ${ctx.id}\n` +
        `  - View cases: adv_list_test_run_test_cases with test_run_id: ${ctx.id}`
      );

    case "import_launch_results":
      return (
        `\n\nTip: Next steps:\n` +
        `  - View updated statuses: adv_list_test_run_test_cases with test_run_id: ${ctx.id}\n` +
        `  - Run summary: adv_get_test_run_by_id with id: ${ctx.id}`
      );

    case "rerun_launch_failures":
      return (
        `\n\nTip: Next steps:\n` +
        `  - Monitor rerun: adv_get_launch_details with launch_id: ${ctx.id}\n` +
        `  - List launches: adv_get_all_launches_for_project\n` +
        `  - If failures persist: adv_detailed_analyze_launch_failures with testRunId: ${ctx.id}`
      );

    case "start_launch":
      return (
        `\n\nTip: Next steps:\n` +
        `  - Monitor build: adv_get_launch_details with launch_id: ${ctx.id}\n` +
        `  - List launches: adv_get_all_launches_for_project\n` +
        `  - On failures: adv_rerun_launch_failures with launch_id: ${ctx.id}\n` +
        `  - Non-en_US builds: check zebrunner-config.json localeTestRunRules if NOT_TAGS exclusions apply`
      );

    default:
      return "";
  }
}
