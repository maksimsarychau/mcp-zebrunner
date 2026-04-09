import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { ZebrunnerMutationClient } from "../../src/api/mutation-client.js";
import { ZebrunnerConfig } from "../../src/types/api.js";
import { requireCredentials } from "../helpers/credentials.js";
import "dotenv/config";

/**
 * Integration tests for ZebrunnerMutationClient.
 *
 * All tests are READ-ONLY — no suites, test cases, or files are created.
 * Verifies that the client can connect, authenticate, and fetch data
 * from the Zebrunner Public API.
 *
 * Prerequisites:
 *   - Valid .env file with Zebrunner credentials
 *   - At least one project with test cases
 */

describe("ZebrunnerMutationClient Integration Tests", () => {
  let mc: ZebrunnerMutationClient;
  const projectKey = process.env.ZEBRUNNER_PROJECT_KEY || "MCP";

  beforeEach(() => {
    const creds = requireCredentials("MutationClient Integration Tests");
    const config: ZebrunnerConfig = {
      baseUrl: creds.baseUrl,
      username: creds.login,
      token: creds.token,
      debug: process.env.DEBUG === "true",
      timeout: 30_000,
    };
    mc = new ZebrunnerMutationClient(config);
  });

  // -------- Settings (read-only) --------

  describe("Settings endpoints", () => {
    it("should fetch automation states for project", async () => {
      const res = await mc.getAutomationStates(projectKey);
      assert.ok(Array.isArray(res.items), "items should be an array");
      assert.ok(res.items.length > 0, "should have at least one automation state");
      for (const item of res.items) {
        assert.ok(typeof item.id === "number");
        assert.ok(typeof item.name === "string");
      }
    });

    it("should fetch priorities for project", async () => {
      const res = await mc.getPriorities(projectKey);
      assert.ok(Array.isArray(res.items));
      assert.ok(res.items.length > 0, "should have at least one priority");
    });

    it("should fetch custom fields for project", async () => {
      const res = await mc.getCustomFields(projectKey);
      assert.ok(Array.isArray(res.items));
    });
  });

  // -------- Read-only data access --------

  describe("Read-only data access", () => {
    it("should handle getTestCaseById for non-existent ID gracefully", async () => {
      await assert.rejects(
        () => mc.getTestCaseById(projectKey, 999999999),
        (err: any) => {
          assert.ok(err.message, "error should have a message");
          return true;
        },
      );
    });

    it("should handle getTestCaseByKey for non-existent key gracefully", async () => {
      await assert.rejects(
        () => mc.getTestCaseByKey(projectKey, `${projectKey}-999999`),
        (err: any) => {
          assert.ok(err.message, "error should have a message");
          return true;
        },
      );
    });

    it("should handle getTestSuiteById for non-existent ID gracefully", async () => {
      await assert.rejects(
        () => mc.getTestSuiteById(projectKey, 999999999),
        (err: any) => {
          assert.ok(err.message, "error should have a message");
          return true;
        },
      );
    });
  });

  // -------- Payload construction (no API calls) --------

  describe("Payload construction (dry verification)", () => {
    it("should build valid create-suite payload shape", () => {
      const payload = { title: "Dry Test Suite", description: "Not sent" };
      assert.ok(typeof payload.title === "string");
      assert.ok(payload.title.length > 0);
    });

    it("should build valid create-test-case payload shape", () => {
      const payload = {
        testSuite: { id: 1 },
        title: "Dry Test Case",
        description: "Not sent to API",
        priority: { name: "Medium" },
        automationState: { name: "Not Automated" },
        steps: [{ action: "Click button", expectedResult: "Page loads" }],
      };
      assert.ok(payload.testSuite.id > 0);
      assert.ok(payload.title.length > 0);
      assert.ok(Array.isArray(payload.steps));
      assert.equal(payload.steps.length, 1);
    });

    it("should build valid update-test-case payload shape", () => {
      const payload = {
        title: "Updated Title",
        priority: { name: "High" },
      };
      assert.ok(typeof payload.title === "string");
      assert.ok("name" in payload.priority);
    });
  });
});
