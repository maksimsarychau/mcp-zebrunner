import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildZebrunnerSuiteUrl,
  parseZebrunnerSuiteUrl,
} from "../../src/utils/zebrunner-suite-url.js";

describe("parseZebrunnerSuiteUrl", () => {
  it("parses suiteId query param", () => {
    const r = parseZebrunnerSuiteUrl(
      "https://example.zebrunner.com/projects/PROJ/test-cases?suiteId=10042",
    );
    assert.deepEqual(r, {
      projectKey: "PROJ",
      suiteId: 10042,
      host: "example.zebrunner.com",
    });
  });

  it("parses suiteid lowercase param", () => {
    const r = parseZebrunnerSuiteUrl(
      "https://example.zebrunner.com/projects/PROJ/test-cases?suiteid=7",
    );
    assert.equal(r?.suiteId, 7);
  });

  it("rejects missing suiteId", () => {
    assert.equal(
      parseZebrunnerSuiteUrl("https://example.zebrunner.com/projects/PROJ/test-cases"),
      null,
    );
  });

  it("rejects case detail URLs", () => {
    assert.equal(
      parseZebrunnerSuiteUrl(
        "https://example.zebrunner.com/projects/PROJ/test-cases?caseId=99",
      ),
      null,
    );
  });
});

describe("buildZebrunnerSuiteUrl", () => {
  it("builds canonical suite link", () => {
    assert.equal(
      buildZebrunnerSuiteUrl("https://example.zebrunner.com/", "PROJ", 100),
      "https://example.zebrunner.com/projects/PROJ/test-cases?suiteId=100",
    );
  });
});
