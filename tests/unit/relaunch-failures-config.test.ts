import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  formatLaunchExcludeCheckDescription,
  formatLaunchExcludeRegexHint,
  formatSkippedLaunchesTableLabel,
  launchNameMatchesExcludePattern,
} from "../../src/utils/relaunch-failures-config.js";

describe("relaunch-failures-config", () => {
  it("launchNameMatchesExcludePattern is case-insensitive", () => {
    assert.equal(launchNameMatchesExcludePattern("Android Performance Run", ["Performance"]), true);
    assert.equal(launchNameMatchesExcludePattern("Critical Flow", ["Performance"]), false);
    assert.equal(launchNameMatchesExcludePattern("Any", []), false);
  });

  it("formatLaunchExcludeCheckDescription handles single and multiple patterns", () => {
    assert.ok(formatLaunchExcludeCheckDescription(["Benchmark"]).includes('"Benchmark"'));
    assert.ok(formatLaunchExcludeCheckDescription(["A", "B"]).includes('"A"'));
    assert.ok(formatLaunchExcludeCheckDescription(["A", "B"]).includes('"B"'));
  });

  it("formatLaunchExcludeRegexHint escapes regex special chars", () => {
    assert.equal(formatLaunchExcludeRegexHint(["Load.Test"]), "/Load\\.Test/i");
  });

  it("formatSkippedLaunchesTableLabel reflects patterns", () => {
    assert.equal(formatSkippedLaunchesTableLabel(["Benchmark"]), "Skipped (Benchmark launches)");
    assert.equal(formatSkippedLaunchesTableLabel([]), "Skipped (excluded launches)");
  });
});
