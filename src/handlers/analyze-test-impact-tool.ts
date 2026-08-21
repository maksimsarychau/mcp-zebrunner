/**
 * adv_analyze_test_impact — bounded Zebrunner-side test impact analysis.
 *
 * Accepts compact semantic change context from the MCP client (not raw git diffs),
 * discovers candidate test cases via progressive title search + optional suite matching,
 * scores/ranks them, and returns a hybrid regression + coverage-gap report.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnhancedZebrunnerClient } from "../api/enhanced-client.js";
import type { ZebrunnerShortTestCase, ZebrunnerTestCase } from "../types/core.js";
import { mapWithConcurrency } from "../utils/batch-concurrency.js";
import { addTestCaseWebUrl } from "../utils/clickable-links.js";
import { FormatProcessor } from "../utils/formatter.js";
import { getConfig } from "../utils/config-loader.js";
import { sanitizeRqlString } from "../utils/security.js";
import {
  hasMeaningfulChangeContext,
  matchesInfraKeyword,
  normalizeChangeContext,
  type ChangeContextInput,
} from "../utils/test-impact-normalizer.js";
import { resolveImpactProjectKey } from "../utils/test-impact-project.js";
import { matchRootSuites, type MatchedSuite } from "../utils/test-impact-suite-matcher.js";
import {
  detectCoverageGaps,
  isAutomated,
  scoreTestCase,
  type ScoredCandidate,
} from "../utils/test-impact-scorer.js";

export interface AnalyzeTestImpactDeps {
  client: EnhancedZebrunnerClient;
  webBaseUrl: string;
  debugLog: (message: string, data?: unknown) => void;
}

export interface ImpactToolInput extends ChangeContextInput {
  project_key?: string;
  repository_slug?: string;
  suite_ids?: number[];
  include_automation?: boolean;
  include_coverage_gaps?: boolean;
  include_smoke_recommendations?: boolean;
  include_suite_discovery?: boolean;
  max_candidates?: number;
  max_results?: number;
  format?: "dto" | "json" | "compact" | "string";
  include_steps_in_output?: boolean;
}

export interface ThemeGroup {
  theme: string;
  automated: Array<Record<string, unknown>>;
  manual: Array<Record<string, unknown>>;
}

export interface ImpactAnalysisResult {
  project: string;
  projectResolution?: string;
  changeContext: {
    features: string[];
    behaviors: string[];
    symbols: string[];
    keywords: string[];
    summary?: string;
  };
  matchedSuites: MatchedSuite[];
  regression: {
    byTheme: ThemeGroup[];
    summary: {
      automated: number;
      manual: number;
      high: number;
      medium: number;
      low: number;
    };
  };
  newCoverageNeeded: Array<{ behavior: string; status: string; reason: string }>;
  recommendedSmokeSuites: Array<{ rootSuiteId: number; name: string; reason: string }>;
  informationalMatches: Array<Record<string, unknown>>;
  scopingNotes: string[];
  retrieval: {
    strategy: string;
    queriesUsed: string[];
    candidatesEvaluated: number;
    truncated: boolean;
    partialFailures?: string[];
    enrichNotFound?: string[];
  };
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function candidateKey(tc: ZebrunnerShortTestCase | ZebrunnerTestCase): string | null {
  return tc.key ?? (tc.id != null ? String(tc.id) : null);
}

export function buildHybridOutput(
  projectKey: string,
  ctx: ReturnType<typeof normalizeChangeContext>,
  matchedSuites: MatchedSuite[],
  scored: ScoredCandidate[],
  maxResults: number,
  includeSteps: boolean,
  webBaseUrl: string,
  options: {
    includeCoverageGaps: boolean;
    includeSmoke: boolean;
    infraHit: boolean;
    queriesUsed: string[];
    candidatesEvaluated: number;
    truncated: boolean;
    partialFailures: string[];
    enrichNotFound: string[];
    projectResolution?: string;
  },
): ImpactAnalysisResult {
  const sorted = [...scored].sort(
    (a, b) => b.score - a.score || a.key.localeCompare(b.key),
  );

  const regressionList = sorted.filter((c) => !c.deprecated).slice(0, maxResults);
  const informational = sorted.filter((c) => c.deprecated);

  const themeMap = new Map<string, ThemeGroup>();
  const ensureTheme = (theme: string): ThemeGroup => {
    let g = themeMap.get(theme);
    if (!g) {
      g = { theme, automated: [], manual: [] };
      themeMap.set(theme, g);
    }
    return g;
  };

  let high = 0;
  let medium = 0;
  let low = 0;
  let automated = 0;
  let manual = 0;

  for (const c of regressionList) {
    if (c.confidence === "HIGH") high++;
    else if (c.confidence === "MEDIUM") medium++;
    else low++;

    const row: Record<string, unknown> = {
      key: c.key,
      title: c.title,
      confidence: c.confidence,
      score: c.score,
      automationState: c.automationState,
      suite: c.suiteName,
      reasons: c.reasons,
      webUrl: `${webBaseUrl.replace(/\/+$/, "")}/projects/${projectKey}/test-cases/${c.testCase.id ?? c.key}`,
    };
    if (includeSteps && c.testCase.steps) {
      row.steps = c.testCase.steps;
    }

    const group = ensureTheme(c.theme);
    if (isAutomated(c.automationState)) {
      group.automated.push(row);
      automated++;
    } else {
      group.manual.push(row);
      manual++;
    }
  }

  const scopingNotes: string[] = [];
  if (matchedSuites.length > 0) {
    scopingNotes.push(
      `Scoped to matched suite(s): ${matchedSuites.map((m) => m.name).join(", ")}. ` +
        `Did not recommend full suite exports — ${regressionList.length} candidate(s) after bounded title search.`,
    );
  } else {
    scopingNotes.push(
      "Suite discovery skipped or found no matches; results from project-wide title search only.",
    );
  }
  if (options.truncated) {
    scopingNotes.push(`Results truncated to max ${maxResults} regression case(s).`);
  }

  const cfg = getConfig();
  const smoke: ImpactAnalysisResult["recommendedSmokeSuites"] = [];
  if (options.includeSmoke && options.infraHit) {
    for (const s of cfg.testImpactSmokeSuites[projectKey] ?? []) {
      if (s.rootSuiteId > 0) {
        smoke.push({
          rootSuiteId: s.rootSuiteId,
          name: s.name,
          reason: s.reason ?? "Infra/navigation keyword match in change context",
        });
      }
    }
  }

  return {
    project: projectKey,
    projectResolution: options.projectResolution,
    changeContext: {
      features: ctx.features,
      behaviors: ctx.behaviors,
      symbols: ctx.symbols,
      keywords: ctx.keywords,
      summary: ctx.changeSummary,
    },
    matchedSuites,
    regression: {
      byTheme: [...themeMap.values()],
      summary: { automated, manual, high, medium, low },
    },
    newCoverageNeeded: options.includeCoverageGaps
      ? detectCoverageGaps(ctx.behaviors, sorted)
      : [],
    recommendedSmokeSuites: smoke,
    informationalMatches: informational.map((c) => ({
      key: c.key,
      title: c.title,
      confidence: c.confidence,
      deprecated: true,
      reasons: c.reasons,
    })),
    scopingNotes,
    retrieval: {
      strategy: "progressive",
      queriesUsed: options.queriesUsed,
      candidatesEvaluated: options.candidatesEvaluated,
      truncated: options.truncated,
      partialFailures: options.partialFailures.length ? options.partialFailures : undefined,
      enrichNotFound: options.enrichNotFound.length ? options.enrichNotFound : undefined,
    },
  };
}

export async function runTestImpactAnalysis(
  deps: AnalyzeTestImpactDeps,
  input: ImpactToolInput,
): Promise<ImpactAnalysisResult | { error: string }> {
  if (!hasMeaningfulChangeContext(input)) {
    return {
      error:
        "At least one meaningful change signal is required: change_summary, features, behaviors, changed_symbols, changed_files, or keywords.",
    };
  }

  const resolved = resolveImpactProjectKey(input.project_key, input.repository_slug);
  if ("error" in resolved) return resolved;

  const projectKey = resolved.projectKey;
  const maxCandidates = input.max_candidates ?? 50;
  const maxResults = input.max_results ?? 20;
  const ctx = normalizeChangeContext(input);
  const cfg = getConfig();

  let matchedSuites: MatchedSuite[] = [];
  const partialFailures: string[] = [];
  const queriesUsed: string[] = [];

  const useSuiteDiscovery =
    input.include_suite_discovery !== false &&
    (!input.suite_ids || input.suite_ids.length === 0);

  if (useSuiteDiscovery) {
    try {
      const allSuites = await deps.client.getAllTestSuites(projectKey);
      matchedSuites = matchRootSuites(allSuites, ctx.features, ctx.keywords, ctx.searchPhrases);
    } catch (err) {
      partialFailures.push(
        `suite discovery: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const candidateMap = new Map<string, ZebrunnerShortTestCase>();

  for (const phrase of ctx.searchPhrases) {
    try {
      const filter = `title~="${sanitizeRqlString(phrase)}"`;
      const response = await deps.client.getTestCases(projectKey, { filter, size: 15 });
      queriesUsed.push(phrase);
      for (const item of response.items ?? []) {
        const k = candidateKey(item);
        if (k && !candidateMap.has(k)) candidateMap.set(k, item);
      }
    } catch (err) {
      partialFailures.push(
        `search '${phrase}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (candidateMap.size >= maxCandidates) break;
  }

  if (matchedSuites.length > 0 && ctx.searchPhrases[0] && candidateMap.size < maxCandidates) {
    const phrase = ctx.searchPhrases[0];
    try {
      const filter = `title~="${sanitizeRqlString(phrase)}"`;
      const response = await deps.client.getTestCases(projectKey, { filter, size: 15 });
      for (const item of response.items ?? []) {
        const k = candidateKey(item);
        if (!k) continue;
        const suiteId = item.testSuite?.id;
        const inSuite = matchedSuites.some((m) =>
          suiteId != null && m.descendantSuiteIds.includes(suiteId),
        );
        if (inSuite && !candidateMap.has(k)) candidateMap.set(k, item);
      }
    } catch {
      // optional scoped pass
    }
  }

  const keys = [...candidateMap.keys()].slice(0, maxCandidates);
  const enriched: ZebrunnerTestCase[] = [];
  const enrichNotFound: string[] = [];

  await mapWithConcurrency(keys, 5, async (key) => {
    try {
      const tc = await deps.client.getTestCaseByKey(projectKey, key, {
        includeSuiteHierarchy: true,
      });
      if (tc) {
        enriched.push(
          addTestCaseWebUrl(tc, projectKey, deps.webBaseUrl, {
            includeClickableLinks: true,
            baseWebUrl: deps.webBaseUrl,
          }) as ZebrunnerTestCase,
        );
      } else enrichNotFound.push(key);
    } catch {
      enrichNotFound.push(key);
    }
  });

  const scored: ScoredCandidate[] = [];
  for (const tc of enriched) {
    const s = scoreTestCase(tc, ctx, matchedSuites, cfg.featureAreaKeywords);
    if (s) scored.push(s);
  }

  const infraHit = cfg.testImpactInfraKeywords.some((kw) =>
    matchesInfraKeyword(ctx.allText, kw),
  );

  return buildHybridOutput(projectKey, ctx, matchedSuites, scored, maxResults, !!input.include_steps_in_output, deps.webBaseUrl, {
    includeCoverageGaps: input.include_coverage_gaps !== false,
    includeSmoke: input.include_smoke_recommendations !== false,
    infraHit,
    queriesUsed,
    candidatesEvaluated: keys.length,
    truncated: scored.length > maxResults,
    partialFailures,
    enrichNotFound,
    projectResolution: resolved.source,
  });
}

export function registerAnalyzeTestImpactTool(server: McpServer, deps: AnalyzeTestImpactDeps): void {
  const toolConfig = {
    description:
      "🎯 Analyze which Zebrunner test cases may be affected by production code changes. " +
      "Pass compact semantic change context (features, behaviors, symbols, keywords) — NOT raw git diffs. " +
      "Returns regression candidates grouped by theme (automated vs manual), potential coverage gaps, and optional smoke-suite recommendations. " +
      "Use for: 'Which tests does my PR affect?', 'test impact analysis', 'what regression tests should I run?'. " +
      "Repository-aware clients should inspect git/PR locally and send summarized change metadata only.",
    inputSchema: {
      project_key: z.string().optional().describe("Zebrunner project key (e.g. PROJ2) or configured alias"),
      repository_slug: z
        .string()
        .optional()
        .describe("Repo folder name mapped via repositoryProjectMap in zebrunner-config.json (e.g. repo-android)"),
      change_summary: z.string().optional().describe("Short summary of changed behavior"),
      features: z.array(z.string()).optional().describe("Affected product features"),
      behaviors: z.array(z.string()).optional().describe("User-visible behaviors changed"),
      changed_symbols: z.array(z.string()).optional().describe("Classes, methods, or symbols changed"),
      changed_files: z.array(z.string()).optional().describe("Changed file names or paths"),
      keywords: z.array(z.string()).optional().describe("Additional search keywords"),
      suite_ids: z.array(z.number().int().positive()).optional().describe("Optional root/feature suite IDs to scope discovery"),
      include_automation: z.boolean().default(true),
      include_coverage_gaps: z.boolean().default(true),
      include_smoke_recommendations: z.boolean().default(true),
      include_suite_discovery: z.boolean().default(true),
      max_candidates: z.number().int().positive().max(100).default(50),
      max_results: z.number().int().positive().max(50).default(20),
      format: z.enum(["dto", "json", "compact", "string"]).default("compact"),
      include_steps_in_output: z.boolean().default(false),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };

  const handler = async (args: ImpactToolInput) => {
    try {
      deps.debugLog("adv_analyze_test_impact", args);
      const result = await runTestImpactAnalysis(deps, args);
      if ("error" in result) {
        return textResult(`❌ ${result.error}`);
      }

      const formatted = FormatProcessor.format(result, args.format ?? "compact");
      const text =
        typeof formatted === "string" ? formatted : JSON.stringify(formatted, null, 2);
      return textResult(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.debugLog("Error in adv_analyze_test_impact", { error: msg });
      return textResult(`❌ Error in adv_analyze_test_impact: ${msg}`);
    }
  };

  server.registerTool("analyze_test_impact", toolConfig, handler);
}
