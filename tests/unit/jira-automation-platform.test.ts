import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { resolveJiraAutomationPlatform } from "../../src/utils/jira-automation-platform.js";
import { getConfig, reloadConfig } from "../../src/utils/config-loader.js";

const BASE_PLAN = {
  targetProject: "QAS",
  platformByProjectKey: {} as Record<string, string>,
  componentByPlatform: { iOS: "Auto-iOS", Android: "Auto-Android" },
  analyticsComponentByPlatform: { iOS: "Analytics iOS", Android: "Analytics Android" },
  analyticsTagMatch: "analytics",
};

describe("resolveJiraAutomationPlatform", () => {
  it("uses platformByProjectKey when set", () => {
    const cfg = getConfig();
    const local = {
      ...cfg,
      jiraAutomationPlan: {
        ...BASE_PLAN,
        platformByProjectKey: { PROJ: "iOS" },
      },
    };
    assert.equal(resolveJiraAutomationPlatform("PROJ", local), "iOS");
  });

  it("infers from project alias reverse map", () => {
    const cfg = getConfig();
    const local = {
      ...cfg,
      projectAliases: { ios: "PROJ2", android: "PROJ3" },
      jiraAutomationPlan: { ...BASE_PLAN, platformByProjectKey: {} },
    };
    assert.equal(resolveJiraAutomationPlatform("PROJ2", local), "iOS");
    reloadConfig();
  });

  it("returns error when unknown", () => {
    const cfg = getConfig();
    const local = {
      ...cfg,
      projectAliases: {},
      jiraAutomationPlan: { ...BASE_PLAN, platformByProjectKey: {} },
    };
    const r = resolveJiraAutomationPlatform("UNKNOWN", cfg);
    assert.ok(typeof r === "object" && "error" in r);
  });
});
