import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for the artifact tools (v9.4.5): adv_list_test_artifacts, adv_get_file_metadata,
 * adv_download_artifact, plus negative prompts proving they do not hijack existing intents.
 */
const SECTION = "3. Analysis — Artifacts (v9.4.5)";
const SAMPLE_UUID = "1a1c9e55-48b7-6ce0-f015-a119421211c9";

export const ARTIFACT_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "artifacts.list",
    toolSection: SECTION,
    promptTemplate:
      "List the artifacts (page sources, links) attached to launch {{failed_launch_id}} in the {{project_key}} project.",
    expectedTools: ["adv_list_test_artifacts"],
    expectedArgKeys: ["launchId"],
    category: "analysis",
    layer: 1,
    requiredContext: ["projectKey", "failedLaunchId"],
  },
  {
    id: "artifacts.metadata",
    toolSection: SECTION,
    promptTemplate: `What are the content type and size of the Zebrunner file ${SAMPLE_UUID}? Do not download it.`,
    expectedTools: ["adv_get_file_metadata"],
    expectedArgKeys: ["uuid"],
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.download",
    toolSection: SECTION,
    promptTemplate: `Show me the contents of the page source XML artifact ${SAMPLE_UUID}.`,
    expectedTools: ["adv_download_artifact"],
    expectedArgKeys: ["uuid"],
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.neg.screenshot_still_routes",
    toolSection: SECTION,
    promptTemplate:
      "Download this screenshot from https://your-workspace.zebrunner.com/files/abc123 for test 5451420 using adv_download_test_screenshot.",
    expectedTools: ["adv_download_test_screenshot"],
    forbiddenTools: ["adv_download_artifact", "adv_list_test_artifacts"],
    category: "negative",
    layer: 1,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
  },
  {
    id: "artifacts.neg.launch_failures_still_routes",
    toolSection: SECTION,
    promptTemplate:
      "Analyze all failures in launch {{failed_launch_id}} of the {{project_key}} project with grouping and an executive summary.",
    expectedTools: ["adv_detailed_analyze_launch_failures"],
    forbiddenTools: ["adv_list_test_artifacts", "adv_download_artifact"],
    category: "negative",
    layer: 1,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey", "failedLaunchId"],
  },
];
