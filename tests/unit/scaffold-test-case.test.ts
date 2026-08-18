import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseStepsText,
  parseGherkinSteps,
  parseSteps,
} from "../../src/handlers/scaffold-test-case-tool.js";
import { reloadConfig, getConfig } from "../../src/utils/config-loader.js";

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
});
