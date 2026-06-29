import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildParameterOverrides,
  extractJobSummary,
  formatParameterDiff,
  mergeJobParameters,
} from "../../src/utils/launch-job-build.js";
import type { LaunchJobParameter } from "../../src/types/reporting.js";

const SAMPLE_PARAMS: LaunchJobParameter[] = [
  { name: "suite", parameterClass: "HIDDEN", value: "mfp/android/critical-flow" },
  { name: "build", parameterClass: "STRING", value: ".*" },
  { name: "locale", parameterClass: "STRING", value: "en_US" },
  { name: "test_run_rules", parameterClass: "STRING", value: "PRIORITY=>P0;;" },
  { name: "fork", parameterClass: "BOOLEAN", value: "false" },
];

describe("launch-job-build utilities", () => {
  it("extractJobSummary derives suite and defaults", () => {
    const summary = extractJobSummary(SAMPLE_PARAMS);
    assert.equal(summary.suitePath, "mfp/android/critical-flow");
    assert.equal(summary.buildDefault, ".*");
    assert.equal(summary.localeDefault, "en_US");
    assert.equal(summary.visibleParameters.length, 4);
  });

  it("mergeJobParameters applies overrides and coerces booleans", () => {
    const merged = mergeJobParameters(SAMPLE_PARAMS, { build: "12345", fork: true });
    assert.equal(merged.build, "12345");
    assert.equal(merged.fork, true);
    assert.equal(merged.suite, "mfp/android/critical-flow");
  });

  it("mergeJobParameters rejects unknown keys", () => {
    assert.throws(
      () => mergeJobParameters(SAMPLE_PARAMS, { unknown_param: "x" }),
      /Unknown job parameter/
    );
  });

  it("buildParameterOverrides merges convenience fields", () => {
    const overrides = buildParameterOverrides({
      build: ".*",
      locale: "de_DE",
      parameters: { branch: "develop" },
    });
    assert.equal(overrides.build, ".*");
    assert.equal(overrides.locale, "de_DE");
    assert.equal(overrides.branch, "develop");
  });

  it("formatParameterDiff shows changed values", () => {
    const merged = mergeJobParameters(SAMPLE_PARAMS, { build: "999" });
    const lines = formatParameterDiff(SAMPLE_PARAMS, merged);
    assert.ok(lines.some((l) => l.includes("build: 999")));
    assert.ok(lines.some((l) => l.includes("default: .*")));
  });

  it("exports Jenkins-only integration note", async () => {
    const { START_LAUNCH_JENKINS_ONLY_NOTE } = await import("../../src/utils/launch-job-build.js");
    assert.ok(START_LAUNCH_JENKINS_ONLY_NOTE.includes("Jenkins"));
    assert.ok(START_LAUNCH_JENKINS_ONLY_NOTE.includes("Launch Launchers"));
  });
});
