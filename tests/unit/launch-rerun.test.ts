import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  getLaunchFailureCount,
  getLaunchRerunIneligibilityReason,
  isLaunchEligibleForFailureRerun,
  toLaunchRerunTarget,
} from "../../src/utils/launch-rerun.js";

describe("Launch rerun eligibility", () => {
  it("counts failed and aborted tests", () => {
    assert.equal(getLaunchFailureCount({ failed: 3, aborted: 2 }), 5);
    assert.equal(getLaunchFailureCount({}), 0);
  });

  it("rejects launches below min_failed threshold", () => {
    const reason = getLaunchRerunIneligibilityReason({ failed: 0, aborted: 0 }, 1);
    assert.ok(reason?.includes("below min_failed"));
    assert.equal(isLaunchEligibleForFailureRerun({ failed: 0, aborted: 0 }), false);
  });

  it("rejects launches when relaunch is not possible", () => {
    const reason = getLaunchRerunIneligibilityReason({
      failed: 5,
      isRelaunchPossible: false,
    });
    assert.ok(reason?.includes("relaunch is not possible"));
  });

  it("rejects in-progress launches", () => {
    const reason = getLaunchRerunIneligibilityReason({
      failed: 2,
      status: "IN_PROGRESS",
    });
    assert.ok(reason?.includes("IN_PROGRESS"));
  });

  it("accepts eligible launches with failures", () => {
    assert.equal(
      isLaunchEligibleForFailureRerun({
        failed: 2,
        aborted: 1,
        status: "FAILED",
        isRelaunchPossible: true,
      }),
      true
    );
  });

  it("allows list items without isRelaunchPossible when failures qualify", () => {
    assert.equal(
      isLaunchEligibleForFailureRerun({ failed: 1, status: "FAILED" }),
      true
    );
  });

  it("maps launch to rerun target", () => {
    const target = toLaunchRerunTarget({
      id: 132522,
      name: "Android Regression",
      failed: 3,
      aborted: 1,
      status: "FAILED",
    });
    assert.deepEqual(target, {
      launchId: 132522,
      name: "Android Regression",
      failed: 3,
      aborted: 1,
      status: "FAILED",
    });
  });
});
