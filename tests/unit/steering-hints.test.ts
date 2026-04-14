import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { steeringHint } from "../../src/helpers/steering.js";
import type { SteeringTool } from "../../src/helpers/steering.js";

describe("Steering Hints", () => {

  describe("create_test_suite", () => {
    it("includes suite ID in both suggested tools", () => {
      const hint = steeringHint("create_test_suite", { id: 999 });
      assert.ok(hint.includes("test_suite_id: 999"), "should reference suite ID for create_test_case");
      assert.ok(hint.includes("parent_suite_id: 999"), "should reference suite ID for sub-suite");
    });

    it("starts with Tip: Next steps:", () => {
      const hint = steeringHint("create_test_suite", { id: 1 });
      assert.ok(hint.includes("Tip: Next steps:"));
    });

    it("suggests create_test_case and create_test_suite", () => {
      const hint = steeringHint("create_test_suite", { id: 42 });
      assert.ok(hint.includes("create_test_case"));
      assert.ok(hint.includes("create_test_suite"));
    });
  });

  describe("create_test_case", () => {
    it("shows quality check when review was NOT used", () => {
      const hint = steeringHint("create_test_case", { id: "MCP-34", reviewUsed: false });
      assert.ok(hint.includes("validate_test_case"), "should suggest quality check");
      assert.ok(hint.includes('case_key: "MCP-34"'), "should reference case key");
    });

    it("skips quality check when review WAS used", () => {
      const hint = steeringHint("create_test_case", { id: "MCP-34", reviewUsed: true });
      assert.ok(!hint.includes("validate_test_case"), "should NOT suggest quality check");
    });

    it("always shows publish hint regardless of review", () => {
      const withReview = steeringHint("create_test_case", { id: "MCP-5", reviewUsed: true });
      const withoutReview = steeringHint("create_test_case", { id: "MCP-5", reviewUsed: false });
      assert.ok(withReview.includes("Publish (remove draft)"), "should show publish hint with review");
      assert.ok(withoutReview.includes("Publish (remove draft)"), "should show publish hint without review");
    });

    it("always shows draft safety note", () => {
      const withReview = steeringHint("create_test_case", { id: "MCP-1", reviewUsed: true });
      const withoutReview = steeringHint("create_test_case", { id: "MCP-1", reviewUsed: false });
      assert.ok(withReview.includes("All created test cases are draft"), "draft note with review");
      assert.ok(withoutReview.includes("All created test cases are draft"), "draft note without review");
    });

    it("uses singular 'Next step' when review was used (only publish)", () => {
      const hint = steeringHint("create_test_case", { id: "MCP-1", reviewUsed: true });
      assert.ok(hint.includes("Tip: Next step:"), "should be singular");
      assert.ok(!hint.includes("Tip: Next steps:"), "should NOT be plural");
    });

    it("uses plural 'Next steps' when review was NOT used", () => {
      const hint = steeringHint("create_test_case", { id: "MCP-1", reviewUsed: false });
      assert.ok(hint.includes("Tip: Next steps:"), "should be plural");
    });

    it("includes update_test_case with draft: false", () => {
      const hint = steeringHint("create_test_case", { id: "MCP-10" });
      assert.ok(hint.includes("update_test_case"));
      assert.ok(hint.includes("draft: false"));
    });
  });

  describe("create_test_case_preview", () => {
    it("includes draft=true note", () => {
      const hint = steeringHint("create_test_case_preview", { id: 0 });
      assert.ok(hint.includes("draft=true"), "should mention forced draft");
    });

    it("mentions update_test_case as the way to publish", () => {
      const hint = steeringHint("create_test_case_preview", { id: 0 });
      assert.ok(hint.includes("update_test_case"));
    });

    it("starts with Note:", () => {
      const hint = steeringHint("create_test_case_preview", { id: 0 });
      assert.ok(hint.includes("Note:"));
    });
  });

  describe("update_test_case", () => {
    it("suggests validate_test_case when review was NOT used", () => {
      const hint = steeringHint("update_test_case", { id: "MCP-7", reviewUsed: false });
      assert.ok(hint.includes("validate_test_case"), "should suggest quality check");
      assert.ok(hint.includes('case_key: "MCP-7"'), "should reference case key");
    });

    it("returns empty string when review WAS used", () => {
      const hint = steeringHint("update_test_case", { id: "MCP-7", reviewUsed: true });
      assert.equal(hint, "", "should return empty string");
    });

    it("defaults to showing hint when reviewUsed is undefined", () => {
      const hint = steeringHint("update_test_case", { id: "MCP-7" });
      assert.ok(hint.includes("validate_test_case"), "should suggest quality check by default");
    });
  });

  describe("manage_test_run_create", () => {
    it("suggests add_cases and import_launch_results", () => {
      const hint = steeringHint("manage_test_run_create", { id: 42 });
      assert.ok(hint.includes("add_cases"), "should suggest populating");
      assert.ok(hint.includes("import_launch_results_to_test_run"), "should suggest import");
      assert.ok(hint.includes("test_run_id: 42"), "should reference run ID");
    });
  });

  describe("manage_test_run_update", () => {
    it("suggests list_test_run_test_cases", () => {
      const hint = steeringHint("manage_test_run_update", { id: 42 });
      assert.ok(hint.includes("list_test_run_test_cases"), "should suggest listing cases");
      assert.ok(hint.includes("test_run_id: 42"), "should reference run ID");
    });

    it("starts with Tip:", () => {
      const hint = steeringHint("manage_test_run_update", { id: 1 });
      assert.ok(hint.includes("Tip:"));
    });
  });

  describe("manage_test_run_add_cases", () => {
    it("suggests import and view cases", () => {
      const hint = steeringHint("manage_test_run_add_cases", { id: 55 });
      assert.ok(hint.includes("import_launch_results_to_test_run"), "should suggest import");
      assert.ok(hint.includes("list_test_run_test_cases"), "should suggest viewing cases");
      assert.ok(hint.includes("test_run_id: 55"), "should reference run ID");
    });
  });

  describe("import_launch_results", () => {
    it("suggests viewing statuses and run summary", () => {
      const hint = steeringHint("import_launch_results", { id: 77 });
      assert.ok(hint.includes("list_test_run_test_cases"), "should suggest viewing statuses");
      assert.ok(hint.includes("get_test_run_by_id"), "should suggest run summary");
      assert.ok(hint.includes("77"), "should reference run ID in both hints");
    });
  });

  describe("edge cases", () => {
    it("returns empty string for unknown tool", () => {
      const hint = steeringHint("nonexistent_tool" as SteeringTool, { id: 1 });
      assert.equal(hint, "");
    });

    it("handles string IDs correctly", () => {
      const hint = steeringHint("create_test_suite", { id: "abc" });
      assert.ok(hint.includes("test_suite_id: abc"));
    });

    it("handles numeric IDs correctly", () => {
      const hint = steeringHint("manage_test_run_create", { id: 12345 });
      assert.ok(hint.includes("test_run_id: 12345"));
    });

    it("no hint contains emoji", () => {
      const tools: SteeringTool[] = [
        "create_test_suite", "create_test_case", "create_test_case_preview",
        "update_test_case", "manage_test_run_create", "manage_test_run_update",
        "manage_test_run_add_cases", "import_launch_results",
      ];
      const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/u;
      for (const tool of tools) {
        const hint = steeringHint(tool, { id: 1 });
        assert.ok(!emojiPattern.test(hint), `${tool} hint should not contain emoji`);
      }
    });
  });
});
