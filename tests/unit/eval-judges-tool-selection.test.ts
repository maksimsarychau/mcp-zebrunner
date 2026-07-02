import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalToolName,
  checkToolSelection,
  checkForbiddenToolNotUsed,
} from "../eval/eval-judges.js";

describe("eval-judges tool selection (v9 adv_* names)", () => {
  it("canonicalToolName adds adv_ prefix when missing", () => {
    assert.equal(canonicalToolName("adv_get_top_bugs"), "adv_get_top_bugs");
    assert.equal(canonicalToolName("get_top_bugs"), "adv_get_top_bugs");
  });

  it("checkToolSelection matches adv_* expected tools", () => {
    assert.equal(
      checkToolSelection("adv_get_top_bugs", ["adv_get_top_bugs"]),
      true,
    );
    assert.equal(
      checkToolSelection("adv_get_top_bugs", ["get_top_bugs"]),
      true,
    );
    assert.equal(
      checkToolSelection("get_top_bugs", ["adv_get_top_bugs"]),
      true,
    );
    assert.equal(checkToolSelection("adv_list_test_suites", ["adv_get_top_bugs"]), false);
    assert.equal(checkToolSelection(undefined, ["adv_get_top_bugs"]), false);
  });

  it("checkForbiddenToolNotUsed compares canonical names", () => {
    assert.deepEqual(
      checkForbiddenToolNotUsed("adv_get_launch_details", ["get_launch_details"]),
      { pass: false, violatedTool: "adv_get_launch_details" },
    );
    assert.deepEqual(
      checkForbiddenToolNotUsed("adv_list_test_suites", ["get_launch_details"]),
      { pass: true },
    );
  });
});
