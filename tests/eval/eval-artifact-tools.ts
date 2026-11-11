import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for the artifact tools (v9.4.5): adv_list_test_artifacts, adv_get_file_metadata,
 * adv_download_artifact, plus negative prompts proving they do not hijack existing intents,
 * plus the artifact-related options of the analysis tools (includePageSource / redact flags).
 *
 * Layer 1 only checks tool choice and arguments (tools are not executed), so these prompts use
 * fixed sample ids (project DEMO, launch 123456, test 654321) instead of discovery placeholders.
 * That keeps them runnable on every workspace; discovery-based prompts would be skipped at L1
 * because failed-launch discovery only runs for Layer 3.
 */
const SECTION = "3. Analysis — Artifacts (v9.4.5)";
const SAMPLE_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

export const ARTIFACT_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "artifacts.list",
    toolSection: SECTION,
    promptTemplate:
      "List the artifacts (page sources, links) attached to launch 123456 in the DEMO project.",
    expectedTools: ["adv_list_test_artifacts"],
    expectedArgKeys: ["launchId"],
    category: "analysis",
    layer: 1,
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
    id: "artifacts.download.redact",
    toolSection: SECTION,
    promptTemplate: `Show the page source XML artifact ${SAMPLE_UUID}, but mask any email addresses and password values first.`,
    expectedTools: ["adv_download_artifact"],
    expectedArgKeys: ["uuid"],
    expectedArgValues: { redact: true },
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.list.by_name",
    toolSection: SECTION,
    promptTemplate:
      "Which page source files are attached to the tests of launch 123456 in the DEMO project? I only need the page source ones.",
    expectedTools: ["adv_list_test_artifacts"],
    expectedArgKeys: ["launchId"],
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.analyze_failure.redact",
    toolSection: SECTION,
    promptTemplate:
      "Analyze the failure of test 654321 in launch 123456 of the DEMO project using its page source, and mask emails and passwords in anything you derive from it.",
    expectedTools: ["adv_analyze_test_failure"],
    expectedArgKeys: ["projectKey", "testRunId", "testId"],
    expectedArgValues: { redactPageSource: true },
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.analyze_failure.skip_page_source",
    toolSection: SECTION,
    promptTemplate:
      "Quickly analyze the failure of test 654321 in launch 123456 of the DEMO project. Do not download or read the page source.",
    expectedTools: ["adv_analyze_test_failure"],
    expectedArgKeys: ["projectKey", "testRunId", "testId"],
    expectedArgValues: { includePageSource: false },
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.launch_failures.page_source",
    toolSection: SECTION,
    promptTemplate:
      "Analyze the failures of launch 123456 in the DEMO project and also read each failed test's page source to look for crash dialogs, permission dialogs and missing elements.",
    expectedTools: ["adv_detailed_analyze_launch_failures"],
    expectedArgKeys: ["testRunId"],
    expectedArgValues: { includePageSource: true },
    category: "analysis",
    layer: 1,
  },
  {
    id: "artifacts.neg.metadata_not_download",
    toolSection: SECTION,
    promptTemplate: `Only tell me how large the file ${SAMPLE_UUID} is. Do not fetch its contents.`,
    expectedTools: ["adv_get_file_metadata"],
    forbiddenTools: ["adv_download_artifact", "adv_download_test_screenshot"],
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
      "Analyze all failures in launch 123456 of the DEMO project with grouping and an executive summary.",
    expectedTools: ["adv_detailed_analyze_launch_failures"],
    forbiddenTools: ["adv_list_test_artifacts", "adv_download_artifact"],
    category: "negative",
    layer: 1,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
  },
];
