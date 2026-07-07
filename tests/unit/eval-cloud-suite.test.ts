import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { EVAL_PROMPTS } from "../eval/eval-prompts.js";
import {
  cloudEvalPromptIds,
  isCloudEvalPrompt,
  shouldIncludePromptInSuite,
} from "../eval/eval-cloud-suite.js";

describe("eval cloud suite", () => {
  it("lists only prompt IDs that exist in EVAL_PROMPTS", () => {
    const catalogIds = new Set(EVAL_PROMPTS.map((p) => p.id));
    for (const id of cloudEvalPromptIds()) {
      assert.ok(catalogIds.has(id), `cloud suite references unknown prompt id: ${id}`);
    }
  });

  it("partitions default vs cloud without overlap", () => {
    const cloud = cloudEvalPromptIds();
    assert.ok(cloud.length >= 70, "cloud suite should cover a meaningful tricky subset");

    for (const id of cloud) {
      assert.ok(isCloudEvalPrompt(id));
      assert.ok(shouldIncludePromptInSuite(id, "cloud"));
      assert.ok(!shouldIncludePromptInSuite(id, "default"));
      assert.ok(shouldIncludePromptInSuite(id, "all"));
    }
  });
});
