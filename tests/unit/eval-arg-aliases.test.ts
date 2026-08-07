import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { argKeyPresent, argValueFor, normalizeArgKey } from "../eval/eval-arg-aliases.js";
import { checkArgKeys, checkArgValues } from "../eval/eval-judges.js";

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

  it("recognizes includeDetailedStatuses in camelCase and snake_case", () => {
    assert.equal(argKeyPresent({ includedetailedstatuses: true }, "include_detailed_statuses"), true);
    assert.deepEqual(
      checkArgKeys(
        { projectKey: "MCP", launchId: 134978, includeDetailedStatuses: true },
        ["project_key", "launch_id", "include_detailed_statuses"],
      ),
      { pass: true, missing: [] },
    );
    assert.deepEqual(
      checkArgKeys({ projectKey: "MCP", launchId: 134978 }, ["include_detailed_statuses"]),
      { pass: false, missing: ["include_detailed_statuses"] },
    );
  });

  it("argValueFor resolves the value behind an alias", () => {
    assert.equal(argValueFor({ includedetailedstatuses: true }, "include_detailed_statuses"), true);
    assert.equal(argValueFor({ countonly: false }, "count_only"), false);
    assert.equal(argValueFor({}, "include_detailed_statuses"), undefined);
  });

  it("checkArgValues requires the opt-in flag to be true, not just present", () => {
    assert.deepEqual(
      checkArgValues({ includeDetailedStatuses: true }, { include_detailed_statuses: true }),
      { pass: true, mismatched: [] },
    );
    assert.deepEqual(
      checkArgValues({ include_detailed_statuses: "true" }, { include_detailed_statuses: true }),
      { pass: true, mismatched: [] },
    );

    const wrongValue = checkArgValues(
      { includeDetailedStatuses: false },
      { include_detailed_statuses: true },
    );
    assert.equal(wrongValue.pass, false);
    assert.match(wrongValue.mismatched[0], /include_detailed_statuses=false/);

    const absent = checkArgValues({ projectKey: "MCP" }, { include_detailed_statuses: true });
    assert.equal(absent.pass, false);
    assert.match(absent.mismatched[0], /expected true/);
  });
});
