import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { normalizeEvalToolName } from "../eval/eval-tool-aliases.js";
import { checkToolSelection } from "../eval/eval-judges.js";

describe("eval-tool-aliases", () => {
  it("maps plural filter/title tool names to canonical adv_* forms", () => {
    assert.equal(normalizeEvalToolName("adv_get_test_cases_by_title"), "adv_get_test_case_by_title");
    assert.equal(normalizeEvalToolName("adv_get_test_cases_by_filter"), "adv_get_test_case_by_filter");
    assert.equal(normalizeEvalToolName("adv_get_test_suite_by_id"), "adv_get_tcm_suite_by_id");
  });

  it("passes checkToolSelection when model uses alias name", () => {
    assert.equal(
      checkToolSelection("adv_get_test_cases_by_title", ["adv_get_test_case_by_title"]),
      true,
    );
    assert.equal(
      checkToolSelection("get_test_suite_by_id", ["adv_get_tcm_suite_by_id"]),
      true,
    );
  });
});
