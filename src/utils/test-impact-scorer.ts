import type { ZebrunnerTestCase } from "../types/core.js";
import type { NormalizedChangeContext } from "./test-impact-normalizer.js";
import type { MatchedSuite } from "./test-impact-suite-matcher.js";
import { caseInMatchedSuites } from "./test-impact-suite-matcher.js";

export const SCORE_WEIGHT_TITLE_BEHAVIOR = 0.35;
export const SCORE_WEIGHT_STEP_BEHAVIOR = 0.30;
export const SCORE_WEIGHT_SUITE_FEATURE = 0.15;
export const SCORE_WEIGHT_SYMBOL = 0.12;
export const SCORE_WEIGHT_GENERIC = 0.08;
export const SUITE_AFFINITY_BOOST = 0.15;

export const CONFIDENCE_HIGH = 0.75;
export const CONFIDENCE_MEDIUM = 0.45;
export const CONFIDENCE_LOW = 0.20;

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface ScoredCandidate {
  key: string;
  title: string;
  score: number;
  confidence: ConfidenceLevel;
  reasons: string[];
  automationState: string;
  deprecated: boolean;
  theme: string;
  suiteName?: string;
  webUrl?: string;
  testCase: ZebrunnerTestCase;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const h = normalizeText(haystack);
  const p = normalizeText(phrase);
  if (!p) return false;
  return h.includes(p);
}

function stepText(tc: ZebrunnerTestCase): string {
  if (!tc.steps?.length) return "";
  return tc.steps
    .map((s) => [s.action, s.expectedResult].filter(Boolean).join(" "))
    .join(" ");
}

export function resolveTheme(
  tc: ZebrunnerTestCase,
  matchedSuites: MatchedSuite[],
  featureAreaKeywords: Record<string, string>,
): string {
  const blob = normalizeText(`${tc.title ?? ""} ${tc.preConditions ?? ""} ${stepText(tc)}`);
  for (const [kw, label] of Object.entries(featureAreaKeywords)) {
    if (blob.includes(kw.toLowerCase())) return label;
  }
  for (const m of matchedSuites) {
    const suiteId = tc.testSuite?.id ?? tc.featureSuiteId;
    const rootId = tc.rootSuiteId;
    if (caseInMatchedSuites(suiteId, rootId, [m])) {
      return m.name.replace(/^\d+\.\s*/, "").trim();
    }
  }
  return "General";
}

export function scoreToConfidence(score: number): ConfidenceLevel | null {
  if (score >= CONFIDENCE_HIGH) return "HIGH";
  if (score >= CONFIDENCE_MEDIUM) return "MEDIUM";
  if (score >= CONFIDENCE_LOW) return "LOW";
  return null;
}

export function isAutomated(stateName: string | undefined): boolean {
  return (stateName ?? "").toLowerCase() === "automated";
}

export function scoreTestCase(
  tc: ZebrunnerTestCase,
  ctx: NormalizedChangeContext,
  matchedSuites: MatchedSuite[],
  featureAreaKeywords: Record<string, string>,
): ScoredCandidate | null {
  const title = tc.title ?? tc.key ?? String(tc.id);
  const key = tc.key ?? String(tc.id);
  const steps = stepText(tc);
  const pre = tc.preConditions ?? "";
  const blob = `${title} ${pre} ${steps}`;
  let score = 0;
  const reasons: string[] = [];

  for (const b of ctx.behaviors) {
    if (containsPhrase(title, b)) {
      score += SCORE_WEIGHT_TITLE_BEHAVIOR;
      reasons.push(`title matches behavior '${b}'`);
    } else if (containsPhrase(blob, b)) {
      score += SCORE_WEIGHT_STEP_BEHAVIOR;
      reasons.push(`steps/preconditions match behavior '${b}'`);
    }
  }

  for (const f of ctx.features) {
    if (containsPhrase(title, f) || containsPhrase(blob, f)) {
      score += SCORE_WEIGHT_SUITE_FEATURE * 0.5;
      reasons.push(`matches feature '${f}'`);
    }
  }

  for (const s of ctx.symbols) {
    const derived = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
    if (containsPhrase(blob, derived) || containsPhrase(title, derived)) {
      score += SCORE_WEIGHT_SYMBOL;
      reasons.push(`symbol-derived match '${derived}'`);
    }
  }

  for (const k of ctx.keywords) {
    if (containsPhrase(title, k)) {
      score += SCORE_WEIGHT_GENERIC;
      reasons.push(`keyword '${k}' in title`);
    } else if (containsPhrase(blob, k)) {
      score += SCORE_WEIGHT_GENERIC * 0.5;
      reasons.push(`keyword '${k}' in steps`);
    }
  }

  const suiteId = tc.testSuite?.id ?? tc.featureSuiteId;
  if (caseInMatchedSuites(suiteId, tc.rootSuiteId, matchedSuites)) {
    score += SUITE_AFFINITY_BOOST;
    reasons.push("test belongs to matched feature suite");
  }

  score = Math.min(1, Math.round(score * 1000) / 1000);

  let confidence = scoreToConfidence(score);
  const deprecated = tc.deprecated === true;
  if (deprecated && confidence === "HIGH") confidence = "MEDIUM";

  if (!confidence) return null;

  return {
    key,
    title,
    score,
    confidence: deprecated && confidence === "HIGH" ? "MEDIUM" : confidence,
    reasons: [...new Set(reasons)].slice(0, 5),
    automationState: tc.automationState?.name ?? "Unknown",
    deprecated,
    theme: resolveTheme(tc, matchedSuites, featureAreaKeywords),
    suiteName: tc.testSuite?.title ?? tc.testSuite?.name,
    testCase: tc,
  };
}

export interface SuggestedTestCaseDraft {
  title: string;
  steps: string[];
  suggestedSuite?: string;
  suggestedTheme?: string;
}

export interface CoverageGap {
  behavior: string;
  status: "POTENTIAL_GAP";
  reason: string;
  suggestedTestCase?: SuggestedTestCaseDraft;
}

function titleCaseBehavior(behavior: string): string {
  const cleaned = behavior.replace(/\s+/g, " ").trim();
  if (!cleaned) return "new behavior";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function resolveThemeFromBehavior(
  behavior: string,
  ctx: NormalizedChangeContext,
  matchedSuites: MatchedSuite[],
  featureAreaKeywords: Record<string, string>,
): string {
  const blob = normalizeText(behavior);
  for (const [kw, label] of Object.entries(featureAreaKeywords)) {
    if (blob.includes(kw.toLowerCase())) return label;
  }
  for (const f of ctx.features) {
    const fn = normalizeText(f);
    for (const [kw, label] of Object.entries(featureAreaKeywords)) {
      if (fn.includes(kw.toLowerCase())) return label;
    }
  }
  if (matchedSuites[0]) {
    return matchedSuites[0].name.replace(/^\d+\.\s*/, "").trim();
  }
  return "General";
}

export function suggestTestCaseDraft(
  behavior: string,
  ctx: NormalizedChangeContext,
  matchedSuites: MatchedSuite[],
  featureAreaKeywords: Record<string, string>,
): SuggestedTestCaseDraft {
  const feature = ctx.features[0];
  const theme = resolveThemeFromBehavior(behavior, ctx, matchedSuites, featureAreaKeywords);
  const suggestedSuite = matchedSuites[0]?.name.replace(/^\d+\.\s*/, "").trim();
  const title = feature
    ? `Verify ${titleCaseBehavior(behavior)} (${feature})`
    : `Verify ${titleCaseBehavior(behavior)}`;
  const contextLabel = feature ?? theme;
  const steps = [
    `Precondition: User has access to ${contextLabel} and required test data is available.`,
    `Action: Perform the flow that exercises "${behavior}".`,
    `Expected: The system behaves correctly for "${behavior}" with no errors or data loss.`,
    `Regression: Related ${contextLabel} flows remain unaffected.`,
  ];
  return { title, steps, suggestedSuite, suggestedTheme: theme };
}

export function detectCoverageGaps(
  behaviors: string[],
  scored: ScoredCandidate[],
  options?: {
    ctx?: NormalizedChangeContext;
    matchedSuites?: MatchedSuite[];
    featureAreaKeywords?: Record<string, string>;
    includeSuggestedDrafts?: boolean;
  },
): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const includeDrafts = options?.includeSuggestedDrafts !== false;
  for (const behavior of behaviors) {
    const matched = scored.some(
      (c) =>
        c.confidence !== "LOW" &&
        (c.reasons.some((r) => r.includes(behavior)) ||
          containsPhrase(c.title, behavior) ||
          containsPhrase(stepText(c.testCase), behavior)),
    );
    if (!matched) {
      const gap: CoverageGap = {
        behavior,
        status: "POTENTIAL_GAP",
        reason: "No sufficiently relevant Zebrunner test case was found.",
      };
      if (includeDrafts && options?.ctx) {
        gap.suggestedTestCase = suggestTestCaseDraft(
          behavior,
          options.ctx,
          options.matchedSuites ?? [],
          options.featureAreaKeywords ?? {},
        );
      }
      gaps.push(gap);
    }
  }
  return gaps;
}
