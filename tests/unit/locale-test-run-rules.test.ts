import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  appendTestRunRulesExclusion,
  applyEnUsOnlyExclusionsToTestRunRules,
  buildNotTagsExclusionRule,
  findFeatureSuiteIdsByNames,
  isLocaleTestRunRulesProject,
  isNonEnUsLocale,
  missingEnUsOnlyExclusions,
  parseNotTagsFeatureSuiteIds,
} from "../../src/utils/locale-test-run-rules.js";

const TEST_PROJECT_A = "PROJ_A";
const TEST_PROJECT_B = "PROJ_B";
const TEST_PROJECT_OTHER = "OTHER";

const TEST_LOCALE_SETTINGS = {
  enabled: true,
  projectKeys: [TEST_PROJECT_A, TEST_PROJECT_B],
  enUsOnlyFeatureSuites: ["FeatureAlpha", "FeatureBeta"],
  suiteNameMatch: "includes" as const,
};

const DISABLED_LOCALE_SETTINGS = { ...TEST_LOCALE_SETTINGS, enabled: false };

describe("locale-test-run-rules", () => {
  it("isNonEnUsLocale treats en_US variants as en_US", () => {
    assert.equal(isNonEnUsLocale("en_US"), false);
    assert.equal(isNonEnUsLocale("en-us"), false);
    assert.equal(isNonEnUsLocale("de_DE"), true);
    assert.equal(isNonEnUsLocale(null), false);
  });

  it("isLocaleTestRunRulesProject gates by projectKeys", () => {
    assert.equal(isLocaleTestRunRulesProject(TEST_PROJECT_A, TEST_LOCALE_SETTINGS), true);
    assert.equal(isLocaleTestRunRulesProject("proj_a", TEST_LOCALE_SETTINGS), true);
    assert.equal(isLocaleTestRunRulesProject(TEST_PROJECT_OTHER, TEST_LOCALE_SETTINGS), false);
    assert.equal(isLocaleTestRunRulesProject(TEST_PROJECT_A, DISABLED_LOCALE_SETTINGS), false);
  });

  it("findFeatureSuiteIdsByNames matches with includes mode", () => {
    const suites = [
      { id: 10, name: "FeatureAlpha" },
      { id: 20, title: "FeatureBeta" },
      { id: 30, name: "FeatureBeta Extended" },
      { id: 40, name: "Unrelated" },
    ];
    assert.deepEqual(
      findFeatureSuiteIdsByNames(suites, TEST_LOCALE_SETTINGS.enUsOnlyFeatureSuites, "includes"),
      [10, 20, 30],
    );
  });

  it("findFeatureSuiteIdsByNames exact mode avoids partial false positives", () => {
    const suites = [
      { id: 10, name: "FeatureAlpha" },
      { id: 30, name: "FeatureAlpha Extended" },
      { id: 40, name: "Backup FeatureAlpha Copy" },
    ];
    assert.deepEqual(
      findFeatureSuiteIdsByNames(suites, ["FeatureAlpha"], "exact"),
      [10],
    );
  });

  it("buildNotTagsExclusionRule formats featureSuiteId list", () => {
    assert.equal(buildNotTagsExclusionRule([10, 20]), "NOT_TAGS=>featureSuiteId=10||featureSuiteId=20;;");
  });

  it("parseNotTagsFeatureSuiteIds extracts IDs", () => {
    const ids = parseNotTagsFeatureSuiteIds("PRIORITY=>P0;;NOT_TAGS=>featureSuiteId=10||featureSuiteId=20;;");
    assert.deepEqual([...ids].sort(), [10, 20]);
  });

  it("appendTestRunRulesExclusion merges rules", () => {
    assert.equal(
      appendTestRunRulesExclusion("PRIORITY=>P0;;", "NOT_TAGS=>featureSuiteId=1;;"),
      "PRIORITY=>P0;;NOT_TAGS=>featureSuiteId=1;;",
    );
  });

  it("missingEnUsOnlyExclusions finds gaps", () => {
    assert.deepEqual(
      missingEnUsOnlyExclusions("NOT_TAGS=>featureSuiteId=10;;", [10, 20]),
      [20],
    );
  });

  it("applyEnUsOnlyExclusionsToTestRunRules auto-merges for de_DE", () => {
    const result = applyEnUsOnlyExclusionsToTestRunRules(
      "de_DE",
      "PRIORITY=>P0;;",
      [10, 20],
      TEST_LOCALE_SETTINGS,
    );
    assert.equal(result.autoApplied, true);
    assert.ok(result.effectiveRules.includes("NOT_TAGS=>featureSuiteId=10||featureSuiteId=20;;"));
    assert.ok(result.warningLines.some((l) => l.includes("not en_US")));
  });

  it("applyEnUsOnlyExclusionsToTestRunRules skips when already excluded", () => {
    const rules = "NOT_TAGS=>featureSuiteId=10||featureSuiteId=20;;";
    const result = applyEnUsOnlyExclusionsToTestRunRules("de_DE", rules, [10, 20], TEST_LOCALE_SETTINGS);
    assert.equal(result.autoApplied, false);
    assert.equal(result.effectiveRules, rules);
  });

  it("applyEnUsOnlyExclusionsToTestRunRules no-op for en_US", () => {
    const result = applyEnUsOnlyExclusionsToTestRunRules("en_US", "PRIORITY=>P0;;", [10], TEST_LOCALE_SETTINGS);
    assert.equal(result.autoApplied, false);
    assert.equal(result.effectiveRules, "PRIORITY=>P0;;");
    assert.equal(result.warningLines.length, 0);
  });
});
