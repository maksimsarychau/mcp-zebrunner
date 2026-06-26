import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { reloadConfig, getConfig } from "../../src/utils/config-loader.js";

describe("zebrunner-config relaunchFailures + localeTestRunRules", () => {
  it("loads relaunchFailures defaults from shipped config", () => {
    reloadConfig();
    const cfg = getConfig();
    assert.ok(Array.isArray(cfg.relaunchFailures.excludeLaunchNamePatterns));
    assert.ok(cfg.relaunchFailures.excludeLaunchNamePatterns.length >= 1);
    assert.equal(typeof cfg.relaunchFailures.maxLaunchesPerPlatform, "number");
    assert.ok(cfg.relaunchFailures.maxLaunchesPerPlatform > 0);
  });

  it("loads localeTestRunRules with expected shape", () => {
    reloadConfig();
    const cfg = getConfig();
    assert.equal(typeof cfg.localeTestRunRules.enabled, "boolean");
    assert.ok(Array.isArray(cfg.localeTestRunRules.projectKeys));
    assert.ok(Array.isArray(cfg.localeTestRunRules.enUsOnlyFeatureSuites));
    assert.ok(cfg.localeTestRunRules.suiteNameMatch === "exact" || cfg.localeTestRunRules.suiteNameMatch === "includes");
  });

  it("loads featureScopedLaunch with expected shape", () => {
    reloadConfig();
    const cfg = getConfig();
    assert.equal(typeof cfg.featureScopedLaunch.rootSuiteLaunchPaths, "object");
  });

  it("merges relaunchFailures from ZEBRUNNER_CONFIG_JSON override", () => {
    const prev = process.env.ZEBRUNNER_CONFIG_JSON;
    process.env.ZEBRUNNER_CONFIG_JSON = JSON.stringify({
      relaunchFailures: {
        excludeLaunchNamePatterns: ["CustomExclude"],
        maxLaunchesPerPlatform: 10,
      },
      localeTestRunRules: { enabled: false },
    });
    try {
      reloadConfig();
      const cfg = getConfig();
      assert.deepEqual(cfg.relaunchFailures.excludeLaunchNamePatterns, ["CustomExclude"]);
      assert.equal(cfg.relaunchFailures.maxLaunchesPerPlatform, 10);
      assert.equal(cfg.localeTestRunRules.enabled, false);
    } finally {
      if (prev === undefined) delete process.env.ZEBRUNNER_CONFIG_JSON;
      else process.env.ZEBRUNNER_CONFIG_JSON = prev;
      reloadConfig();
    }
  });
});
