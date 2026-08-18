/**
 * adv_scaffold_test_case — a hybrid "new test case" wizard.
 *
 * When the connected MCP client advertises form elicitation
 * (`clientCapabilities.elicitation.form`, e.g. Claude Code / Cursor), the tool
 * drives a native questionnaire via `server.server.elicitInput(...)`, runs a
 * warn-only similarity check against the target + root suite, and creates a
 * forced-draft test case directly through the mutation client.
 *
 * When the client does NOT support elicitation (e.g. Claude Desktop), the tool
 * returns a conversational questionnaire script that guides the model to gather
 * the same information and finish through the existing `adv_create_test_case`
 * preview/confirm flow. This keeps the feature usable everywhere.
 *
 * Safety: created cases are always forced to draft=true, mirroring
 * adv_create_test_case. The existing create handler is intentionally NOT
 * refactored — this tool builds the payload and calls
 * `mutationClient.createTestCase` directly.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import type { ZebrunnerMutationClient } from "../api/mutation-client.js";
import type { ZebrunnerTestCase } from "../types/core.js";
import { TestCaseDuplicateAnalyzer } from "../utils/duplicate-analyzer.js";

export interface ScaffoldTestCaseDeps {
  /** Enhanced (read) client — used to fetch existing cases for similarity. */
  client: EnhancedZebrunnerClient;
  /** Mutation client — used to create the case and read settings. */
  mutationClient: ZebrunnerMutationClient;
  /** Resolve a project alias/key to the real Zebrunner project key. */
  resolveProjectKey: (project: string) => string;
  /** Zebrunner web base URL (no /api/public/v1) for clickable links. */
  webBaseUrl: string;
  /** Debug logger. */
  debugLog: (message: string, data?: unknown) => void;
  /** Optional post-create quality review (wired from server.ts). */
  runQualityReview?: (projectKey: string, caseKey: string) => Promise<string | null>;
  /**
   * Optional advisory pre-submission validation (wired from server.ts). Runs the
   * rules-based validator against the in-memory draft BEFORE creation so the dev
   * can see quality findings and still choose to proceed (advisory, never blocks).
   */
  runDraftValidation?: (draft: DraftForValidation) => Promise<string | null>;
}

/** Minimal, not-yet-created test case shape passed to the advisory validator. */
export interface DraftForValidation {
  title: string;
  preConditions?: string;
  steps: Array<{ action: string; expectedResult?: string }>;
  priorityName?: string;
  automationStateName?: string;
}

/** Similarity threshold (percent) at or above which we warn about a match. */
const SIMILARITY_WARN_THRESHOLD = 55;
/** Max number of existing cases to fetch full details for during step scoring. */
const MAX_DETAIL_FETCHES = 8;
/** Elicitation round-trip timeout so buggy clients cannot hang the tool forever. */
const ELICIT_TIMEOUT_MS = 10 * 60 * 1000;

type PrimitiveSchema = Record<string, unknown>;
type ElicitContent = Record<string, string | number | boolean | string[]>;

// ── Small text helpers ───────────────────────────────────────────────────────

function normalizeWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 2),
  );
}

/** Jaccard similarity (0-100) between two titles. */
function titleSimilarity(a: string, b: string): number {
  const wa = normalizeWords(a);
  const wb = normalizeWords(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const union = new Set([...wa, ...wb]).size;
  return union === 0 ? 0 : Math.round((shared / union) * 10000) / 100;
}

/** Supported step-writing formats for the wizard. */
export type StepFormat = "Gherkin" | "Plain steps";
const STEP_FORMATS: StepFormat[] = ["Gherkin", "Plain steps"];
const DEFAULT_STEP_FORMAT: StepFormat = "Gherkin";

/**
 * Parse a free-text steps block into API step objects. Each non-empty line is
 * one step; an optional expected result may follow `=>` or `|`.
 */
export function parseStepsText(stepsText: string): Array<{ action: string; expectedResult?: string }> {
  const steps: Array<{ action: string; expectedResult?: string }> = [];
  for (const raw of stepsText.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\d+[.)]\s*/, "");
    if (!line) continue;
    const sep = line.includes("=>") ? "=>" : line.includes(" | ") ? " | " : null;
    if (sep) {
      const [action, expected] = line.split(sep);
      steps.push({
        action: action.trim(),
        expectedResult: expected?.trim() || undefined,
      });
    } else {
      steps.push({ action: line });
    }
  }
  return steps;
}

/**
 * Parse a Gherkin scenario block. Each non-empty line becomes one Zebrunner step
 * whose action is the Gherkin line (Given/When/Then/And/But preserved). Zebrunner
 * has no native expectedResult for Gherkin lines, so none is set.
 */
export function parseGherkinSteps(stepsText: string): Array<{ action: string; expectedResult?: string }> {
  const steps: Array<{ action: string; expectedResult?: string }> = [];
  for (const raw of stepsText.split(/\r?\n/)) {
    const line = raw.trim().replace(/^\d+[.)]\s*/, "");
    if (!line) continue;
    steps.push({ action: line });
  }
  return steps;
}

/** Dispatch to the right parser based on the selected step format. */
export function parseSteps(stepsText: string, format: StepFormat): Array<{ action: string; expectedResult?: string }> {
  return format === "Gherkin" ? parseGherkinSteps(stepsText) : parseStepsText(stepsText);
}

// ── Similarity check (warn-only, target + root suite) ─────────────────────────

interface SimilarMatch {
  key: string;
  title: string;
  score: number;
  link: string;
}

async function findSimilarCases(
  deps: ScaffoldTestCaseDeps,
  projectKey: string,
  suiteId: number,
  draftTitle: string,
  draftSteps: Array<{ action: string; expectedResult?: string }>,
): Promise<SimilarMatch[]> {
  const analyzer = new TestCaseDuplicateAnalyzer(SIMILARITY_WARN_THRESHOLD);

  // Root-hierarchy scope: basedOnRootSuites = true covers target + root suite.
  const shortCases = await deps.client.getAllTCMTestCasesBySuiteId(projectKey, suiteId, true);

  // Score titles cheaply first.
  const titleScored = shortCases
    .filter((c) => c.key && c.title)
    .map((c) => ({ key: c.key as string, title: c.title as string, titleScore: titleSimilarity(draftTitle, c.title as string) }))
    .sort((a, b) => b.titleScore - a.titleScore);

  const draftStepList = draftSteps.map((s, i) => ({
    action: (s.action || "").toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim(),
    expectedResult: s.expectedResult ? s.expectedResult.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim() : undefined,
    stepNumber: i + 1,
  }));

  const matches: SimilarMatch[] = [];

  // Refine the strongest title candidates with step similarity.
  const candidates = titleScored.slice(0, MAX_DETAIL_FETCHES);
  for (const cand of candidates) {
    let combined = cand.titleScore;
    if (draftStepList.length > 0) {
      try {
        const full: ZebrunnerTestCase = await deps.client.getTestCaseByKey(projectKey, cand.key, {
          includeSuiteHierarchy: false,
        });
        const existingSteps = analyzer.extractSteps(full);
        const stepSim = analyzer.calculateStepSimilarity(draftStepList, existingSteps).similarity;
        combined = Math.max(cand.titleScore, stepSim);
      } catch (err) {
        deps.debugLog("scaffold: step-similarity fetch failed", { key: cand.key, err: err instanceof Error ? err.message : String(err) });
      }
    }
    if (combined >= SIMILARITY_WARN_THRESHOLD) {
      matches.push({
        key: cand.key,
        title: cand.title,
        score: Math.round(combined * 100) / 100,
        link: `${deps.webBaseUrl}/projects/${projectKey}/test-cases?caseKey=${cand.key}`,
      });
    }
  }

  // Also include any remaining title-only strong matches not detail-fetched.
  for (const cand of titleScored.slice(MAX_DETAIL_FETCHES)) {
    if (cand.titleScore >= SIMILARITY_WARN_THRESHOLD) {
      matches.push({
        key: cand.key,
        title: cand.title,
        score: cand.titleScore,
        link: `${deps.webBaseUrl}/projects/${projectKey}/test-cases?caseKey=${cand.key}`,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, 5);
}

// ── Conversational fallback (clients without elicitation) ─────────────────────

function buildConversationalQuestionnaire(projectHint?: string, suiteHint?: number): string {
  const projectLine = projectHint
    ? `Target project: ${projectHint} (confirm with the user).`
    : "Ask the user for the target project (a project key like FEAT, or an alias like features/android/ios/web).";
  const suiteLine = suiteHint
    ? `Target test suite id: ${suiteHint} (confirm with the user).`
    : "Ask the user for the target test suite id.";

  return `You are guiding a developer through authoring a NEW Zebrunner test case that follows our best practices. This client does not support interactive forms, so run the questionnaire conversationally — ask ONE question at a time and wait for the answer.

Step 0 — Target
- ${projectLine}
- ${suiteLine}

Step 1 — Best-practice questionnaire (ask one at a time)
1. Title: a single, specific objective. Enforce SINGLE RESPONSIBILITY — one clear thing under test.
2. Feature area (optional short tag).
3. Priority: discover valid values via adv_get_automation_priorities and let the user pick.
4. Automation state: discover valid values via adv_get_automation_states and let the user pick.
5. Test case language: ask whether steps should be written in "Gherkin" (Given/When/Then) or "Plain steps" (action => expected result). DEFAULT to Gherkin if the user has no preference.
6. Preconditions: setup that makes the case INDEPENDENT (no reliance on other cases running first).
7. Steps:
   - If Gherkin: capture a scenario with one line per step (e.g. "Given …", "When …", "Then …"). Each line becomes one step.
   - If Plain steps: capture atomic, imperative action + verifiable expected result pairs, one per line formatted "action => expected result".
8. Source case (optional): an existing case key to prefill from.

Step 2 — Automatic similarity check (warn-only, do NOT block)
- Fetch existing cases in the target + root suite via adv_get_test_cases_advanced (or adv_get_test_cases_by_suite_smart) scoped to the suite.
- Compare the draft title and steps to existing cases. If any look similar, WARN the user, list the matching keys, and ask whether to proceed, reuse one via source_case_key, or cancel. Never block automatically.

Step 3 — Advisory quality pre-check (before creating, do NOT block)
- Review the draft against these best-practice checkpoints and report a short advisory summary (this mirrors the rules-based validator used on form-capable clients):
  1. Title is specific, single-responsibility, starts with a capital, avoids vague words ("verify", "check", "ensure", "test that").
  2. Preconditions are explicit and make the case independent (no "after/previous/already/existing").
  3. At least 3 atomic steps; each validation step has a concrete, measurable expected result.
  4. No steps require human judgment ("looks good", "appears correct", "visually verify") if it is meant to be automated.
- Present the findings to the user. They may fix the draft or proceed anyway — this step never blocks.

Step 4 — Create (safe two-step)
- Call adv_create_test_case WITHOUT confirm to get a preview + confirmation_token.
- After the user approves, call adv_create_test_case with ONLY { confirm: true, confirmation_token }.
- ALWAYS pass review: true so the authoritative rules-based quality review runs after creation (parity with form-capable clients).
- Note: created cases are always drafts (draft=true is forced). Use adv_update_test_case to publish later.`;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerScaffoldTestCaseTool(server: McpServer, deps: ScaffoldTestCaseDeps): void {
  const { mutationClient, resolveProjectKey, debugLog } = deps;

  /** Send one elicitation form; returns null on any error/decline/cancel. */
  async function elicit(
    message: string,
    properties: Record<string, PrimitiveSchema>,
    required: string[],
  ): Promise<ElicitContent | null> {
    try {
      const result = await server.server.elicitInput(
        {
          message,
          requestedSchema: { type: "object", properties: properties as never, required },
        },
        { timeout: ELICIT_TIMEOUT_MS },
      );
      if (result.action !== "accept" || !result.content) return null;
      return result.content as ElicitContent;
    } catch (err) {
      debugLog("scaffold: elicitInput failed", { err: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  const scaffoldConfig = {
    description: `🧩 (Beta) Guided wizard to author a NEW Zebrunner test case from best practices, with an automatic warn-only check for similar existing cases and an advisory quality pre-check before creation.
On clients that support form elicitation (e.g. Claude Code, Cursor) this presents an interactive questionnaire and creates a forced-draft case directly.
On clients without elicitation (e.g. Claude Desktop) it returns a conversational questionnaire that finishes through adv_create_test_case.
Optionally pass project (key like 'FEAT' or an alias like 'features') and test_suite_id to skip the first question. There is no default project — it is always chosen explicitly.
Also available as the alias adv_create_test_case_wizard.
SAFETY: created cases are always draft=true; publish later via adv_update_test_case.`,
    inputSchema: {
      project: z
        .string()
        .optional()
        .describe("Target project key (e.g. 'FEAT') or alias (e.g. 'features', 'android'). If omitted, the wizard asks for it."),
      test_suite_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Target test suite id. If omitted, the wizard asks for it."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };

  const scaffoldHandler = async (args: { project?: string; test_suite_id?: number }) => {
      try {
        const caps = server.server.getClientCapabilities();
        const canForm = !!caps?.elicitation?.form;

        // ── Fallback path: no form elicitation → conversational script ──────────
        if (!canForm) {
          debugLog("scaffold: no form elicitation capability — returning conversational fallback");
          return textResult(buildConversationalQuestionnaire(args.project, args.test_suite_id));
        }

        // ── Form 0: target project + suite (only what's missing) ────────────────
        let projectInput = args.project;
        let suiteId = args.test_suite_id;
        if (!projectInput || !suiteId) {
          const props: Record<string, PrimitiveSchema> = {};
          const required: string[] = [];
          if (!projectInput) {
            props.project = { type: "string", title: "Project", description: "Project key (e.g. FEAT) or alias (e.g. features, android, ios, web)" };
            required.push("project");
          }
          if (!suiteId) {
            props.test_suite_id = { type: "number", title: "Test Suite ID", description: "Numeric id of the target test suite" };
            required.push("test_suite_id");
          }
          const target = await elicit("Where should the new test case live?", props, required);
          if (!target) return textResult("🚫 Test case scaffolding cancelled (no target project/suite provided).");
          if (!projectInput) projectInput = String(target.project ?? "").trim();
          if (!suiteId) suiteId = Number(target.test_suite_id);
        }

        if (!projectInput) return textResult("❌ A target project is required.");
        if (!suiteId || !Number.isFinite(suiteId)) return textResult("❌ A valid numeric test_suite_id is required.");
        const projectKey = resolveProjectKey(projectInput);

        // ── Fetch enum options for priority / automation state ──────────────────
        let priorityNames: string[] = [];
        let automationStateNames: string[] = [];
        try {
          const [pri, aut] = await Promise.all([
            mutationClient.getPriorities(projectKey),
            mutationClient.getAutomationStates(projectKey),
          ]);
          priorityNames = (pri.items ?? []).map((p) => p.name).filter(Boolean);
          automationStateNames = (aut.items ?? []).map((a) => a.name).filter(Boolean);
        } catch (err) {
          debugLog("scaffold: failed to load priorities/automation states", { err: err instanceof Error ? err.message : String(err) });
        }

        // ── Form 1: basics ──────────────────────────────────────────────────────
        const priorityProp: PrimitiveSchema = priorityNames.length
          ? { type: "string", enum: priorityNames, title: "Priority", description: "Test case priority" }
          : { type: "string", title: "Priority", description: "Test case priority (leave blank for project default)" };
        const automationProp: PrimitiveSchema = automationStateNames.length
          ? { type: "string", enum: automationStateNames, title: "Automation State", description: "Automation state" }
          : { type: "string", title: "Automation State", description: "Automation state (leave blank for project default)" };

        const basics = await elicit(
          `New test case in ${projectKey} (suite ${suiteId}). Keep it to a SINGLE responsibility — one clear objective.`,
          {
            title: { type: "string", title: "Title", description: "Specific, single-objective title (imperative, e.g. 'User can reset password via email')" },
            feature_area: { type: "string", title: "Feature Area", description: "Short feature/area tag (optional)" },
            priority: priorityProp,
            automation_state: automationProp,
            test_case_language: {
              type: "string",
              enum: STEP_FORMATS,
              default: DEFAULT_STEP_FORMAT,
              title: "Test Case Language",
              description: "Step-writing format. Gherkin = Given/When/Then lines; Plain steps = action => expected result. Defaults to Gherkin.",
            },
          },
          ["title"],
        );
        if (!basics) return textResult("🚫 Test case scaffolding cancelled.");
        const title = String(basics.title ?? "").trim();
        if (!title) return textResult("❌ Title is required.");
        const featureArea = String(basics.feature_area ?? "").trim();
        const priorityName = String(basics.priority ?? "").trim();
        const automationStateName = String(basics.automation_state ?? "").trim();
        const stepFormat: StepFormat = basics.test_case_language === "Plain steps" ? "Plain steps" : DEFAULT_STEP_FORMAT;
        const isGherkin = stepFormat === "Gherkin";

        // ── Form 2: context + steps (prompt adapts to the chosen language) ──────
        const stepsDescription = isGherkin
          ? "Gherkin scenario — one line per row (e.g. 'Given the user is logged in', 'When they open Settings', 'Then the profile is shown'). Each line becomes a step."
          : "One step per line as: action => expected result";
        const context = await elicit(
          `Preconditions & steps (${stepFormat}). Make the case INDEPENDENT (no reliance on other cases). Write atomic, verifiable steps.`,
          {
            pre_conditions: { type: "string", title: "Preconditions", description: "Setup needed before the test (optional)" },
            steps_text: { type: "string", title: "Steps", description: stepsDescription },
            source_case_key: { type: "string", title: "Source Case Key", description: "Optional existing case key to reference (e.g. FEAT-123)" },
          },
          ["steps_text"],
        );
        if (!context) return textResult("🚫 Test case scaffolding cancelled.");
        const preConditions = String(context.pre_conditions ?? "").trim();
        const stepsText = String(context.steps_text ?? "").trim();
        const sourceCaseKey = String(context.source_case_key ?? "").trim();
        const steps = parseSteps(stepsText, stepFormat);
        if (steps.length === 0) return textResult("❌ At least one step is required.");

        // ── Similarity check (warn-only) ────────────────────────────────────────
        let similar: SimilarMatch[] = [];
        try {
          similar = await findSimilarCases(deps, projectKey, suiteId, title, steps);
        } catch (err) {
          debugLog("scaffold: similarity check failed (continuing)", { err: err instanceof Error ? err.message : String(err) });
        }

        // ── Advisory quality pre-check (never blocks) ───────────────────────────
        let validationSummary: string | null = null;
        if (deps.runDraftValidation) {
          try {
            validationSummary = await deps.runDraftValidation({
              title,
              preConditions: preConditions || undefined,
              steps,
              priorityName: priorityName || undefined,
              automationStateName: automationStateName || undefined,
            });
          } catch (err) {
            debugLog("scaffold: draft validation failed (continuing)", { err: err instanceof Error ? err.message : String(err) });
          }
        }

        // ── Final confirmation (surface warnings, never block) ──────────────────
        let confirmMessage = `Ready to create draft test case in ${projectKey} (suite ${suiteId}):\n• Title: ${title}\n• Language: ${stepFormat}\n• Steps: ${steps.length}`;
        if (validationSummary) {
          confirmMessage += `\n\n🔎 Quality pre-check (advisory — you can still proceed):\n${validationSummary}`;
        }
        if (similar.length > 0) {
          confirmMessage +=
            `\n\n⚠️ ${similar.length} possibly similar existing case(s):\n` +
            similar.map((m) => `  - ${m.key} (${m.score}%) — ${m.title}`).join("\n") +
            `\n\nChoose how to proceed.`;
        }
        const actionEnum = similar.length > 0 ? ["create", "reuse", "cancel"] : ["create", "cancel"];
        const decision = await elicit(
          confirmMessage,
          {
            decision: {
              type: "string",
              enum: actionEnum,
              title: "Proceed?",
              description: similar.length > 0
                ? "create = make a new draft; reuse = stop and copy from the closest match instead; cancel = abort"
                : "create = make a new draft; cancel = abort",
            },
          },
          ["decision"],
        );
        if (!decision) return textResult("🚫 Test case scaffolding cancelled.");
        const choice = String(decision.decision ?? "cancel");
        if (choice === "cancel") return textResult("🚫 Test case scaffolding cancelled by user.");
        if (choice === "reuse") {
          const best = similar[0];
          return textResult(
            `↩️ Reuse requested. The closest existing case is ${best.key} (${best.score}%).\n` +
            `To copy from it, call adv_create_test_case with source_case_key: "${best.key}", ` +
            `test_suite_id: ${suiteId}, and your desired overrides.`,
          );
        }

        // ── Build payload + create (forced draft) ───────────────────────────────
        const descParts: string[] = [];
        if (sourceCaseKey) descParts.push(`Source: ${sourceCaseKey}`);
        if (featureArea) descParts.push(`Feature area: ${featureArea}`);
        if (isGherkin) descParts.push(`Format: Gherkin (BDD)`);
        const description = descParts.length ? descParts.join("\n") : undefined;

        const payload: Record<string, unknown> = {
          testSuite: { id: suiteId },
          title,
          draft: true, // safety: always create as draft
        };
        if (description) payload.description = description;
        if (priorityName) payload.priority = { name: priorityName };
        if (automationStateName) payload.automationState = { name: automationStateName };
        if (preConditions) payload.preConditions = preConditions;
        payload.steps = steps;

        debugLog("scaffold: creating test case", { projectKey, suiteId, stepCount: steps.length });
        const body = await mutationClient.createTestCase(projectKey, payload);
        const tc = body.data;

        let resultText =
          `✅ Draft test case created\n` +
          `Key: ${tc.key ?? "N/A"}\n` +
          `ID: ${tc.id ?? "N/A"}\n` +
          `Title: ${tc.title ?? title}\n` +
          `Language: ${stepFormat}\n` +
          `Suite: ${suiteId}\n` +
          `Draft: ${tc.draft ?? true} (publish later with adv_update_test_case)`;
        if (tc.key) {
          resultText += `\nLink: ${deps.webBaseUrl}/projects/${projectKey}/test-cases?caseKey=${tc.key}`;
        }
        if (similar.length > 0) {
          resultText += `\n\nℹ️ Note: created despite ${similar.length} similar case(s) — review for possible consolidation.`;
        }

        // ── Optional quality review ─────────────────────────────────────────────
        if (deps.runQualityReview && tc.key) {
          try {
            const review = await deps.runQualityReview(projectKey, tc.key as string);
            if (review) resultText += `\n\n📝 Quality Review\n${"─".repeat(40)}\n${review}`;
          } catch (err) {
            resultText += `\n\n⚠️ Quality review skipped: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        return textResult(resultText);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        deps.debugLog("Error in adv_scaffold_test_case", { error: msg });
        return textResult(`❌ Error in adv_scaffold_test_case: ${msg}`);
      }
    };

  // Primary name plus a dev-friendly alias; both resolve to the same handler and
  // are auto-exposed under their `adv_<name>` form by the server wrapper.
  server.registerTool("scaffold_test_case", scaffoldConfig, scaffoldHandler);
  server.registerTool("create_test_case_wizard", scaffoldConfig, scaffoldHandler);
}
