import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  batchSourceLabel,
  hasMeaningfulBatchContexts,
  hasMeaningfulChangeContext,
  matchesInfraKeyword,
  mergeBatchChangeContexts,
  normalizeChangeContext,
  rankSearchPhrases,
  MAX_BATCH_SEARCH_PHRASES,
} from "../../src/utils/test-impact-normalizer.js";
import { matchRootSuites } from "../../src/utils/test-impact-suite-matcher.js";
import {
  applyMultiSourceBoost,
  collectBatchSources,
  scoreTestCase,
  scoreToConfidence,
  detectCoverageGaps,
} from "../../src/utils/test-impact-scorer.js";
import { normalizeRepositorySlug, resolveImpactProjectKey } from "../../src/utils/test-impact-project.js";
import { buildHybridOutput } from "../../src/handlers/analyze-test-impact-tool.js";
import type { ZebrunnerTestCase } from "../../src/types/core.js";
import { reloadConfig } from "../../src/utils/config-loader.js";

describe("test-impact normalizer", () => {
  it("splits CamelCase and snake_case symbols", () => {
    const ctx = normalizeChangeContext({
      changed_symbols: ["DiaryRepository", "update_diary_entry"],
    });
    assert.ok(ctx.searchPhrases.some((p) => p.includes("diary")));
  });

  it("dedupes phrases", () => {
    const ctx = normalizeChangeContext({
      behaviors: ["edit food", "edit food"],
      keywords: ["edit food"],
    });
    const phrases = rankSearchPhrases(ctx);
    assert.equal(new Set(phrases).size, phrases.length);
  });

  it("rejects empty change context", () => {
    assert.equal(hasMeaningfulChangeContext({ project_key: "X" } as any), false);
    assert.equal(
      hasMeaningfulChangeContext({ behaviors: ["edit logged food"] }),
      true,
    );
  });

  it("matches infra keywords on word boundaries", () => {
    assert.ok(matchesInfraKeyword("bottom nav changed", "bottom nav"));
    assert.equal(matchesInfraKeyword("tablet layout", "tab"), false);
  });

  it("merges change_batches with raised phrase cap", () => {
    const batches = Array.from({ length: 5 }, (_, i) => ({
      id: String(1000 + i),
      behaviors: [`behavior ${i}`, "shared diary edit"],
      keywords: [`keyword-${i}`],
    }));
    const merged = mergeBatchChangeContexts(batches);
    assert.equal(merged.batchCount, 5);
    assert.ok(merged.merged.searchPhrases.length <= MAX_BATCH_SEARCH_PHRASES);
    assert.ok(merged.batchLabels.some((l) => l.startsWith("PR#")));
  });

  it("batchSourceLabel prefers label and parses PR URLs", () => {
    assert.equal(batchSourceLabel({ label: "Diary fix" }, 0), "Diary fix");
    assert.equal(
      batchSourceLabel({ source_url: "https://github.com/o/r/pull/42" }, 1),
      "PR#42",
    );
  });

  it("hasMeaningfulBatchContexts requires at least one batch signal", () => {
    assert.equal(hasMeaningfulBatchContexts(undefined), false);
    assert.equal(hasMeaningfulBatchContexts([{}]), false);
    assert.equal(hasMeaningfulBatchContexts([{ behaviors: ["edit food"] }]), true);
  });
});

describe("test-impact suite matcher", () => {
  it("matches root suites by feature name", () => {
    const suites = [
      { id: 1, title: "10. Meal Planner", parentSuiteId: undefined },
      { id: 2, title: "14. Deeplinks", parentSuiteId: undefined },
    ] as any[];
    const matched = matchRootSuites(suites, ["Meal Planner"], [], ["meal planner"]);
    assert.ok(matched.some((m) => m.name.includes("Meal Planner")));
  });
});

describe("test-impact scorer", () => {
  const tc: ZebrunnerTestCase = {
    id: 100,
    key: "PROJ-1",
    title: "Verify edit logged food serving size",
    steps: [{ action: "Edit an existing diary entry", expectedResult: "Nutrition recalculates" }],
    automationState: { id: 1, name: "Automated" },
    testSuite: { id: 10, title: "Diary" },
  };

  it("scores strong title/behavior match at MEDIUM or HIGH", () => {
    const ctx = normalizeChangeContext({
      behaviors: ["edit logged food", "serving size"],
    });
    const scored = scoreTestCase(tc, ctx, [], {});
    assert.ok(scored);
    assert.ok(scored!.score >= 0.45);
    assert.ok(scored!.confidence === "HIGH" || scored!.confidence === "MEDIUM");
  });

  it("demotes deprecated from HIGH to MEDIUM", () => {
    const ctx = normalizeChangeContext({ behaviors: ["edit logged food"] });
    const deprecated = { ...tc, deprecated: true };
    const scored = scoreTestCase(deprecated, ctx, [], {});
    assert.ok(scored);
    assert.notEqual(scored!.confidence, "HIGH");
  });

  it("detects coverage gaps with suggested draft test cases", () => {
    const gaps = detectCoverageGaps(
      ["session-gated upsell frequency"],
      [],
      {
        ctx: normalizeChangeContext({
          features: ["Meal Planner"],
          behaviors: ["session-gated upsell frequency"],
        }),
        matchedSuites: [{ id: 17441, name: "10. Meal Planner", matchReason: "feature" }],
        featureAreaKeywords: { meal: "Meal Management" },
        includeSuggestedDrafts: true,
      },
    );
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].status, "POTENTIAL_GAP");
    assert.ok(gaps[0].suggestedTestCase);
    assert.match(gaps[0].suggestedTestCase!.title, /Verify/i);
    assert.ok(gaps[0].suggestedTestCase!.steps.length >= 3);
    assert.equal(gaps[0].suggestedTestCase!.suggestedSuite, "Meal Planner");
  });

  it("confidence thresholds", () => {
    assert.equal(scoreToConfidence(0.8), "HIGH");
    assert.equal(scoreToConfidence(0.5), "MEDIUM");
    assert.equal(scoreToConfidence(0.1), null);
  });

  it("collectBatchSources tags matching PR batches", () => {
    const ctx1 = normalizeChangeContext({
      behaviors: ["edit logged food", "serving size"],
    });
    const ctx2 = normalizeChangeContext({ behaviors: ["meal planner tab"] });
    const sources = collectBatchSources(
      tc,
      [
        { id: "1", behaviors: ["edit logged food", "serving size"] },
        { id: "2", behaviors: ["meal planner tab"] },
      ],
      [ctx1, ctx2],
      [],
      {},
    );
    assert.deepEqual(sources, ["PR#1"]);
  });

  it("applyMultiSourceBoost adds small boost for multi-PR hits", () => {
    assert.equal(applyMultiSourceBoost(0.5, 1), 0.5);
    assert.equal(applyMultiSourceBoost(0.5, 2), 0.55);
  });

  it("multi-source boost can cross confidence threshold (0.71 → HIGH at 0.76)", () => {
    const boosted = applyMultiSourceBoost(0.71, 2);
    assert.equal(boosted, 0.76);
    assert.equal(scoreToConfidence(0.71), "MEDIUM");
    assert.equal(scoreToConfidence(boosted), "HIGH");
  });
});

describe("test-impact project resolution", () => {
  it("normalizes repository slug basename", () => {
    assert.equal(normalizeRepositorySlug("org/mfp-android"), "mfp-android");
  });

  it("resolves repositoryProjectMap from env override", () => {
    const prev = process.env.ZEBRUNNER_CONFIG_JSON;
    process.env.ZEBRUNNER_CONFIG_JSON = JSON.stringify({
      repositoryProjectMap: { "repo-android": "PROJ2" },
    });
    try {
      reloadConfig();
      const r = resolveImpactProjectKey(undefined, "repo-android");
      assert.ok(!("error" in r));
      assert.equal(r.projectKey, "PROJ2");
      assert.equal(r.source, "repository_map");
    } finally {
      if (prev === undefined) delete process.env.ZEBRUNNER_CONFIG_JSON;
      else process.env.ZEBRUNNER_CONFIG_JSON = prev;
      reloadConfig();
    }
  });

  it("project_key wins over repository_slug", () => {
    const r = resolveImpactProjectKey("MCP", "repo-android");
    assert.ok(!("error" in r));
    assert.equal(r.projectKey, "MCP");
  });
});

describe("test-impact hybrid output", () => {
  it("caps regression results globally", () => {
    const ctx = normalizeChangeContext({ behaviors: ["test"] });
    const scored = Array.from({ length: 30 }, (_, i) => ({
      key: `K-${i}`,
      title: `Case ${i}`,
      score: 0.9 - i * 0.01,
      confidence: "HIGH" as const,
      reasons: ["match"],
      automationState: i % 2 === 0 ? "Automated" : "Manual",
      deprecated: false,
      theme: "General",
      testCase: { id: i, key: `K-${i}`, title: `Case ${i}` } as ZebrunnerTestCase,
    }));
    const out = buildHybridOutput("MCP", ctx, [], scored, 5, false, "https://zbr.example.com", {
      includeCoverageGaps: true,
      includeSmoke: false,
      infraHit: false,
      queriesUsed: ["test"],
      candidatesEvaluated: 30,
      truncated: true,
      partialFailures: [],
      enrichNotFound: [],
      sourceByKey: new Map([["K-0", ["PR#1", "PR#2"]]]),
      batchSummary: { count: 2, labels: ["PR#1", "PR#2"] },
    });
    const total =
      out.regression.summary.automated + out.regression.summary.manual;
    assert.ok(total <= 5);
    assert.equal(out.changeBatches?.count, 2);
    const firstAuto = out.regression.byTheme.flatMap((g) => g.automated)[0];
    assert.deepEqual(firstAuto?.sources, ["PR#1", "PR#2"]);
  });
});
