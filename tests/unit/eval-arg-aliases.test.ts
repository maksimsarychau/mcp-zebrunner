import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { argKeyPresent, normalizeArgKey } from "../eval/eval-arg-aliases.js";
import { checkArgKeys } from "../eval/eval-judges.js";

describe("eval-arg-aliases", () => {
  it("normalizeArgKey strips underscores and lowercases", () => {
    assert.equal(normalizeArgKey("project_key"), "projectkey");
    assert.equal(normalizeArgKey("projectKey"), "projectkey");
  });

  it("argKeyPresent accepts project when project_key expected", () => {
    const args = { projectkey: "DEMO" };
    assert.equal(argKeyPresent(args, "project_key"), true);
  });

  it("checkArgKeys accepts common aliases", () => {
    assert.deepEqual(
      checkArgKeys({ project: "DEMO", launch_id: 1 }, ["project_key", "launch_id"]),
      { pass: true, missing: [] },
    );
    assert.deepEqual(
      checkArgKeys({ action: "create" }, ["action", "title"]),
      { pass: false, missing: ["title"] },
    );
  });

  it("checkArgKeys accepts token-efficient read aliases", () => {
    assert.deepEqual(
      checkArgKeys(
        { project_key: "DEMO", case_keys: ["A-1", "A-2"], detail: "summary", format: "compact" },
        ["project_key", "case_keys", "detail", "format"],
      ),
      { pass: true, missing: [] },
    );
    assert.equal(argKeyPresent({ detaillevel: "summary" }, "detail"), true);
    assert.equal(argKeyPresent({ outputformat: "compact" }, "format"), true);
  });

  it("checkArgKeys accepts distribution field via system_field", () => {
    assert.deepEqual(
      checkArgKeys({ project: "MFPAND", system_field: "PRIORITY" }, ["project", "field"]),
      { pass: true, missing: [] },
    );
  });
});
