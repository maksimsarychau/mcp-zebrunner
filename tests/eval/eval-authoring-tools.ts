import type { EvalPrompt } from "./eval-prompts.js";

/**
 * Eval routing for the guided test case authoring wizard (v9.2.7):
 *   - adv_scaffold_test_case
 *   - adv_create_test_case_wizard (dev-friendly alias, same handler)
 *
 * These check TOOL ROUTING only — that the model picks the wizard for
 * "author a new test case following best practices" style prompts, and does
 * not fall back to the raw create/generate tools. The interactive elicitation
 * flow (Form 0 project-key dropdown, Other mini-elicit, Form 0 suite picker with
 * Latest/recent/search, Gherkin parsing, and advisory pre-check) is covered by unit tests
 * (see tests/unit/scaffold-test-case.test.ts).
 */
export const AUTHORING_TOOLS_EVAL_PROMPTS: EvalPrompt[] = [
  {
    id: "scaffold.best_practice",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "I want to author a NEW test case for {{project_key}} following our best practices, with a check for similar existing cases. Start the guided wizard.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    category: "mutation",
    layer: 1,
    requiredContext: ["projectKey"],
  },
  {
    id: "scaffold.with_suite",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Use the test case creation wizard to add a new case to {{project_key}} suite {{suite_id}}.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["project", "test_suite_id"],
    category: "mutation",
    layer: 2,
    requiredContext: ["projectKey", "suiteId"],
  },
  {
    id: "scaffold.alias_wizard",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Open the create-test-case wizard for {{project_key}} so I can write a new case step by step.",
    expectedTools: ["adv_create_test_case_wizard", "adv_scaffold_test_case"],
    category: "mutation",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "scaffold.neg.not_raw_create",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Guide me through authoring a new best-practice test case for {{project_key}} with an automatic similar-case check — use the wizard, NOT the raw adv_create_test_case call.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    forbiddenTools: ["adv_create_test_case"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "scaffold.neg.not_generate_draft",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "I want to hand-author a new test case via the guided wizard for {{project_key}} — do NOT auto-generate a draft from implementation code.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    forbiddenTools: ["adv_generate_draft_test_by_key"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "scaffold.features_alias",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Start the test case creation wizard for the **features** project (new feature work).",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["project"],
    expectedArgValues: { project: "features" },
    category: "mutation",
    layer: 2,
  },
  {
    id: "scaffold.feat_project_key",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Open the create-test-case wizard for project **FEAT** suite {{suite_id}}.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["project", "test_suite_id"],
    expectedArgValues: { project: "FEAT" },
    category: "mutation",
    layer: 2,
    requiredContext: ["suiteId"],
  },
  {
    id: "scaffold.android_alias",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate: "Use the guided wizard to add a test case to **android**.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["project"],
    expectedArgValues: { project: "android" },
    category: "mutation",
    layer: 2,
  },
  {
    id: "scaffold.neg.not_list_projects",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "I want the test case wizard for **features** — do NOT call adv_get_available_projects to pick the project.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    forbiddenTools: ["adv_get_available_projects"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
  },
  {
    id: "scaffold.with_suite_id_skip_list",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Use the test case creation wizard for {{project_key}} suite {{suite_id}} — pass the suite id in wizard args, do NOT call adv_list_test_suites first.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["project", "test_suite_id"],
    forbiddenTools: ["adv_list_test_suites", "adv_get_tcm_test_suites_by_project"],
    category: "mutation",
    layer: 2,
    requiredContext: ["projectKey", "suiteId"],
  },
  {
    id: "scaffold.project_only_no_suite_arg",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Start the guided wizard to author a new test case in {{project_key}} (I'll pick the suite inside the wizard).",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["project"],
    category: "mutation",
    layer: 2,
    requiredContext: ["projectKey"],
  },
  {
    id: "scaffold.neg.not_list_suites_wizard",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Open the create-test-case wizard for {{project_key}} — do NOT call adv_list_test_suites to choose the suite.",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    forbiddenTools: ["adv_list_test_suites"],
    category: "negative",
    layer: 2,
    isNegative: true,
    negativeCategory: "tool_confusion",
    expectedBehavior: "should_select_tool",
    requiredContext: ["projectKey"],
  },
  {
    id: "scaffold.source_case_url",
    toolSection: "1. TCM — Authoring wizard (v9.2.7)",
    promptTemplate:
      "Call adv_scaffold_test_case for {{project_key}} now — pass source_case_key as this Zebrunner URL (do NOT call adv_get_test_case_by_key first): https://zebrunner.example.com/projects/{{project_key}}/test-cases?caseId={{test_case_id}}",
    expectedTools: ["adv_scaffold_test_case", "adv_create_test_case_wizard"],
    expectedArgKeys: ["source_case_key"],
    forbiddenTools: ["adv_get_test_case_by_key"],
    category: "mutation",
    layer: 2,
    requiredContext: ["projectKey", "testCaseId"],
  },
];
