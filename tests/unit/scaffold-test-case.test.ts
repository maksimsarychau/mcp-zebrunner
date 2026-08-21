import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseStepsText,
  parseGherkinSteps,
  parseSteps,
  groupAliasesByProjectKey,
  buildProjectPickerFormSchema,
  formatProjectAliasesForConversation,
  buildConversationalQuestionnaire,
  PROJECT_OTHER_SENTINEL,
  getSuiteRecencyMs,
  getSuiteDisplayLabel,
  pickLatestSuite,
  buildSuitePickerFormSchema,
  searchSuitesByName,
  resolveSuiteFromSelection,
  formatSuiteGuidanceForConversation,
  resolveScaffoldSourceCaseRef,
  SUITE_LATEST_SENTINEL,
  SUITE_OTHER_SENTINEL,
} from "../../src/handlers/scaffold-test-case-tool.js";
import type { ZebrunnerTestSuite } from "../../src/types/core.js";
import { reloadConfig, getConfig } from "../../src/utils/config-loader.js";

/** Fixture mirroring shipped zebrunner-config.json projectAliases defaults. */
const FIXTURE_ALIASES: Record<string, string> = {
  web: "MFPWEB",
  api: "MFPWEB",
  android: "MFPAND",
  ios: "MFPIOS",
  features: "FEAT",
  feature: "FEAT",
  newfeatures: "FEAT",
};

// ── Plain step parsing ───────────────────────────────────────────────────────

describe("scaffold: parseStepsText (plain steps)", () => {
  it("splits 'action => expected result' pairs", () => {
    const steps = parseStepsText("Open the app => Home screen is shown");
    assert.equal(steps.length, 1);
    assert.equal(steps[0].action, "Open the app");
    assert.equal(steps[0].expectedResult, "Home screen is shown");
  });

  it("supports the ' | ' separator", () => {
    const steps = parseStepsText("Tap Login | Login form appears");
    assert.equal(steps[0].action, "Tap Login");
    assert.equal(steps[0].expectedResult, "Login form appears");
  });

  it("treats a line without a separator as action-only", () => {
    const steps = parseStepsText("Launch the application");
    assert.equal(steps[0].action, "Launch the application");
    assert.equal(steps[0].expectedResult, undefined);
  });

  it("strips leading numbering and skips blank lines", () => {
    const steps = parseStepsText("1. First step => ok\n\n2) Second step => done");
    assert.equal(steps.length, 2);
    assert.equal(steps[0].action, "First step");
    assert.equal(steps[1].action, "Second step");
    assert.equal(steps[1].expectedResult, "done");
  });
});

// ── Gherkin step parsing ─────────────────────────────────────────────────────

describe("scaffold: parseGherkinSteps", () => {
  it("creates one step per line and preserves Given/When/Then keywords", () => {
    const text = [
      "Given the user is logged in",
      "When they open Settings",
      "Then the profile is shown",
    ].join("\n");
    const steps = parseGherkinSteps(text);
    assert.equal(steps.length, 3);
    assert.equal(steps[0].action, "Given the user is logged in");
    assert.equal(steps[1].action, "When they open Settings");
    assert.equal(steps[2].action, "Then the profile is shown");
  });

  it("never sets expectedResult (Zebrunner has no expected field for BDD lines)", () => {
    const steps = parseGherkinSteps("Then the profile is shown => ignored");
    assert.equal(steps.length, 1);
    // The whole line stays as the action; '=>' is NOT treated as a separator.
    assert.equal(steps[0].action, "Then the profile is shown => ignored");
    assert.equal(steps[0].expectedResult, undefined);
  });

  it("strips numbering and skips blank lines", () => {
    const steps = parseGherkinSteps("1. Given a state\n\n2) When an action");
    assert.equal(steps.length, 2);
    assert.equal(steps[0].action, "Given a state");
    assert.equal(steps[1].action, "When an action");
  });
});

// ── Dispatch ─────────────────────────────────────────────────────────────────

describe("scaffold: parseSteps dispatch", () => {
  const line = "Given a user => a user exists";

  it("Gherkin format keeps the whole line as one action", () => {
    const steps = parseSteps(line, "Gherkin");
    assert.equal(steps[0].action, "Given a user => a user exists");
    assert.equal(steps[0].expectedResult, undefined);
  });

  it("Plain steps format splits on '=>'", () => {
    const steps = parseSteps(line, "Plain steps");
    assert.equal(steps[0].action, "Given a user");
    assert.equal(steps[0].expectedResult, "a user exists");
  });
});

// ── FEAT project aliases ─────────────────────────────────────────────────────

describe("scaffold: FEAT project aliases", () => {
  it("resolves features/feature/newfeatures to FEAT", () => {
    reloadConfig();
    const aliases = getConfig().projectAliases;
    assert.equal(aliases.features, "FEAT");
    assert.equal(aliases.feature, "FEAT");
    assert.equal(aliases.newfeatures, "FEAT");
  });

  it("keeps the existing platform aliases intact", () => {
    reloadConfig();
    const aliases = getConfig().projectAliases;
    assert.equal(aliases.web, "MFPWEB");
    assert.equal(aliases.android, "MFPAND");
    assert.equal(aliases.ios, "MFPIOS");
  });

  it("dedupes shipped aliases to four unique project keys", () => {
    reloadConfig();
    const keys = new Set(Object.values(getConfig().projectAliases));
    assert.deepEqual([...keys].sort(), ["FEAT", "MFPAND", "MFPIOS", "MFPWEB"]);
  });
});

// ── Project alias picker helpers ─────────────────────────────────────────────

describe("scaffold: groupAliasesByProjectKey", () => {
  it("groups features/feature/newfeatures under FEAT", () => {
    const grouped = groupAliasesByProjectKey(FIXTURE_ALIASES);
    assert.deepEqual(grouped.FEAT, ["feature", "features", "newfeatures"]);
  });

  it("groups web/api under MFPWEB", () => {
    const grouped = groupAliasesByProjectKey(FIXTURE_ALIASES);
    assert.deepEqual(grouped.MFPWEB, ["api", "web"]);
  });

  it("sorts alias names within each group", () => {
    const grouped = groupAliasesByProjectKey(FIXTURE_ALIASES);
    for (const aliases of Object.values(grouped)) {
      const sorted = [...aliases].sort((a, b) => a.localeCompare(b));
      assert.deepEqual(aliases, sorted);
    }
  });
});

describe("scaffold: buildProjectPickerFormSchema", () => {
  it("enumValues contains sorted unique keys plus Other sentinel", () => {
    const schema = buildProjectPickerFormSchema(FIXTURE_ALIASES);
    assert.ok(schema);
    assert.deepEqual(schema!.enumValues, [
      "FEAT",
      "MFPAND",
      "MFPIOS",
      "MFPWEB",
      PROJECT_OTHER_SENTINEL,
    ]);
  });

  it("does not contain raw alias names", () => {
    const schema = buildProjectPickerFormSchema(FIXTURE_ALIASES)!;
    assert.ok(!schema.enumValues.includes("android"));
    assert.ok(!schema.enumValues.includes("features"));
  });

  it("description mentions alias hints per key", () => {
    const schema = buildProjectPickerFormSchema(FIXTURE_ALIASES)!;
    assert.match(schema.description, /FEAT.*features/);
    assert.match(schema.description, /MFPAND.*android/);
  });

  it("returns null for empty alias map", () => {
    assert.equal(buildProjectPickerFormSchema({}), null);
  });
});

describe("scaffold: formatProjectAliasesForConversation", () => {
  it("includes grouped FEAT line", () => {
    const text = formatProjectAliasesForConversation(FIXTURE_ALIASES);
    assert.match(text, /FEAT — feature, features, newfeatures/);
  });

  it("mentions raw project key escape hatch", () => {
    const text = formatProjectAliasesForConversation(FIXTURE_ALIASES);
    assert.match(text, /raw project key.*zebrunner-config/i);
  });
});

describe("scaffold: conversational fallback includes configured projects", () => {
  it("Step 0 lists grouped project keys when aliases are configured", () => {
    const text = buildConversationalQuestionnaire(undefined, undefined, FIXTURE_ALIASES);
    assert.match(text, /MFPAND — android/);
    assert.match(text, /FEAT — feature, features, newfeatures/);
    assert.ok(!text.includes("- android\n"));
    assert.ok(!text.includes("- features\n"));
  });
});

// ── Suite picker helpers ─────────────────────────────────────────────────────

const SUITE_FIXTURES: ZebrunnerTestSuite[] = [
  {
    id: 100,
    title: "Regression",
    treeNames: "Root > Suite Alpha > Regression",
    lastModifiedAt: "2026-08-10T12:00:00Z",
  },
  {
    id: 200,
    title: "Regression",
    treeNames: "Root > Suite Beta > Regression",
    lastModifiedAt: "2026-08-15T12:00:00Z",
  },
  {
    id: 300,
    title: "Smoke",
    treeNames: "Root > Suite Alpha > Smoke",
    createdAt: "2026-08-01T12:00:00Z",
  },
  {
    id: 400,
    title: "Latest Suite",
    treeNames: "Root > Latest Suite",
    lastModifiedAt: "2026-08-20T08:00:00Z",
  },
];

describe("scaffold: pickLatestSuite", () => {
  it("picks the suite with the newest lastModifiedAt", () => {
    const latest = pickLatestSuite(SUITE_FIXTURES);
    assert.equal(latest?.id, 400);
  });

  it("falls back to createdAt when lastModifiedAt is absent", () => {
    const onlyCreated: ZebrunnerTestSuite[] = [
      { id: 1, title: "A", createdAt: "2026-01-01T00:00:00Z" },
      { id: 2, title: "B", createdAt: "2026-06-01T00:00:00Z" },
    ];
    assert.equal(pickLatestSuite(onlyCreated)?.id, 2);
  });
});

describe("scaffold: getSuiteRecencyMs", () => {
  it("prefers lastModifiedAt over createdAt", () => {
    const suite: ZebrunnerTestSuite = {
      id: 1,
      createdAt: "2020-01-01T00:00:00Z",
      lastModifiedAt: "2026-08-20T00:00:00Z",
    };
    assert.ok(getSuiteRecencyMs(suite) > Date.parse("2026-01-01"));
  });
});

describe("scaffold: getSuiteDisplayLabel", () => {
  it("uses treeNames when present", () => {
    assert.equal(getSuiteDisplayLabel(SUITE_FIXTURES[0], SUITE_FIXTURES), "Root > Suite Alpha > Regression");
  });

  it("disambiguates duplicate base labels with id suffix", () => {
    const dupes: ZebrunnerTestSuite[] = [
      { id: 100, title: "Regression", treeNames: "Root > Shared Path" },
      { id: 200, title: "Regression", treeNames: "Root > Shared Path" },
    ];
    const label100 = getSuiteDisplayLabel(dupes[0], dupes);
    const label200 = getSuiteDisplayLabel(dupes[1], dupes);
    assert.match(label100, /\(id: 100\)/);
    assert.match(label200, /\(id: 200\)/);
    assert.notEqual(label100, label200);
  });
});

describe("scaffold: buildSuitePickerFormSchema", () => {
  it("puts Latest first and Other last", () => {
    const schema = buildSuitePickerFormSchema(SUITE_FIXTURES)!;
    assert.equal(schema.enumValues[0], SUITE_LATEST_SENTINEL);
    assert.equal(schema.enumValues[schema.enumValues.length - 1], SUITE_OTHER_SENTINEL);
  });

  it("does not duplicate the Latest suite in the recent tail", () => {
    const schema = buildSuitePickerFormSchema(SUITE_FIXTURES, 10)!;
    const latestLabel = getSuiteDisplayLabel(SUITE_FIXTURES[3], SUITE_FIXTURES);
    const tail = schema.enumValues.slice(1, -1);
    assert.ok(!tail.includes(latestLabel));
  });

  it("description mentions Latest target suite", () => {
    const schema = buildSuitePickerFormSchema(SUITE_FIXTURES)!;
    assert.match(schema.description, /Latest available/);
    assert.match(schema.description, /Root > Latest Suite/);
  });

  it("returns null for empty suite list", () => {
    assert.equal(buildSuitePickerFormSchema([]), null);
  });
});

describe("scaffold: searchSuitesByName", () => {
  it("matches partial hierarchy path", () => {
    const hits = searchSuitesByName(SUITE_FIXTURES, "Suite Alpha");
    assert.ok(hits.some((s) => s.id === 100));
    assert.ok(hits.some((s) => s.id === 300));
    assert.ok(!hits.some((s) => s.id === 400));
  });

  it("returns top recency results when query is empty", () => {
    const hits = searchSuitesByName(SUITE_FIXTURES, "", 2);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].id, 400);
  });
});

describe("scaffold: resolveSuiteFromSelection", () => {
  const schema = buildSuitePickerFormSchema(SUITE_FIXTURES)!;
  const ctx = { labelToId: schema.labelToId, latestSuite: schema.latestSuite };

  it("resolves Latest available to the newest suite id", () => {
    assert.equal(resolveSuiteFromSelection(SUITE_LATEST_SENTINEL, ctx), 400);
  });

  it("resolves a named label to its id", () => {
    const label = getSuiteDisplayLabel(SUITE_FIXTURES[2], SUITE_FIXTURES);
    assert.equal(resolveSuiteFromSelection(label, ctx), 300);
  });

  it("returns null for Other sentinel", () => {
    assert.equal(resolveSuiteFromSelection(SUITE_OTHER_SENTINEL, ctx), null);
  });

  it("returns null for unknown label", () => {
    assert.equal(resolveSuiteFromSelection("does-not-exist", ctx), null);
  });
});

describe("scaffold: conversational fallback suite guidance", () => {
  it("mentions adv_list_test_suites when no suite hint", () => {
    const text = buildConversationalQuestionnaire("PROJ1", undefined, FIXTURE_ALIASES);
    assert.match(text, /adv_list_test_suites|adv_get_tcm_test_suites_by_project/);
    assert.match(text, /Latest available/i);
    assert.ok(!text.includes("Ask the user for the target test suite id"));
  });

  it("formatSuiteGuidanceForConversation references list tools", () => {
    const text = formatSuiteGuidanceForConversation("PROJ1");
    assert.match(text, /adv_list_test_suites/);
  });
});

describe("scaffold: source_case_key URL normalization", () => {
  const web = "https://zebrunner.example.com";

  it("resolves ?caseId= URL to numeric lookup key", () => {
    const r = resolveScaffoldSourceCaseRef(
      `${web}/projects/PROJ2/test-cases?caseId=112`,
      "PROJ2",
      web,
    );
    assert.equal(r.lookupKey, "112");
    assert.equal(r.projectKey, "PROJ2");
  });

  it("passes through plain keys unchanged", () => {
    const r = resolveScaffoldSourceCaseRef("PROJ2-1", "PROJ2", web);
    assert.equal(r.lookupKey, "PROJ2-1");
    assert.equal(r.projectKey, "PROJ2");
  });
});
