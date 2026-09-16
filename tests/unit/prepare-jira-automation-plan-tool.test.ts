import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import type { EnhancedZebrunnerClient } from "../../src/api/enhanced-client.js";
import { runPrepareJiraAutomationPlan } from "../../src/handlers/prepare-jira-automation-plan-tool.js";
import { reloadConfig } from "../../src/utils/config-loader.js";

/** Fictional per-project catalog — IDs/names are not global; production loads via getAutomationStatesForProject. */
const MOCK_NOT_AUTOMATED_ID = 101;
const MOCK_TO_BE_AUTOMATED_ID = 202;
const MOCK_AUTOMATION_CATALOG = [
  { id: MOCK_NOT_AUTOMATED_ID, name: "Not Automated" },
  { id: MOCK_TO_BE_AUTOMATED_ID, name: "To Be Automated" },
];

function mockClient(overrides: Partial<EnhancedZebrunnerClient> = {}): EnhancedZebrunnerClient {
  const base = {
    getAllTestSuites: async () => [
      { id: 10, parentSuiteId: null, title: "Feature Suite" },
    ],
    getAutomationStatesForProject: async () => MOCK_AUTOMATION_CATALOG,
    getAllTestCases: async () => [
      {
        id: 100,
        key: "PROJ-100",
        title: "Case A",
        automationState: { id: MOCK_NOT_AUTOMATED_ID, name: "Not Automated" },
      },
    ],
  };
  return { ...base, ...overrides } as EnhancedZebrunnerClient;
}

describe("runPrepareJiraAutomationPlan", () => {
  let prevConfigJson: string | undefined;

  beforeEach(() => {
    prevConfigJson = process.env.ZEBRUNNER_CONFIG_JSON;
    process.env.ZEBRUNNER_CONFIG_JSON = JSON.stringify({
      projectAliases: {},
      jiraAutomationPlan: {
        targetProject: "QAS",
        platformByProjectKey: { PROJ: "iOS" },
        componentByPlatform: { iOS: "Auto-iOS" },
        analyticsComponentByPlatform: { iOS: "Analytics iOS" },
        analyticsTagMatch: "analytics",
      },
    });
    reloadConfig();
  });

  afterEach(() => {
    if (prevConfigJson === undefined) delete process.env.ZEBRUNNER_CONFIG_JSON;
    else process.env.ZEBRUNNER_CONFIG_JSON = prevConfigJson;
    reloadConfig();
  });

  it("returns error when explicit automation_states do not match catalog", async () => {
    const result = await runPrepareJiraAutomationPlan(
      {
        client: mockClient(),
        webBaseUrl: "https://example.zebrunner.com",
        debugLog: () => {},
      },
      {
        project_key: "PROJ",
        suite_id: 10,
        automation_states: ["Not Automatd"],
      },
    );
    assert.ok("error" in result);
    assert.match(result.error, /Not Automatd/);
    assert.match(result.error, /adv_get_automation_states/);
  });

  it("builds parent tasks on happy path", async () => {
    const result = await runPrepareJiraAutomationPlan(
      {
        client: mockClient(),
        webBaseUrl: "https://example.zebrunner.com",
        debugLog: () => {},
      },
      { project_key: "PROJ", suite_id: 10 },
    );
    assert.ok(!("error" in result));
    assert.equal(result.parentTasks.length, 1);
    assert.equal(result.parentTasks[0].subtasks.length, 1);
    assert.match(result.parentTasks[0].subtasks[0].description, /caseId=100/);
    assert.ok(result.intakeAutomationStates?.some((s) => s.id === MOCK_TO_BE_AUTOMATED_ID));
  });
});
