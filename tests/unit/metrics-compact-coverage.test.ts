import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

function readServerSource(): string {
  return fs.readFileSync(path.join(process.cwd(), "src", "server.ts"), "utf-8");
}

/** Slice from registerTool("name") to the next registerTool( call. */
function toolRegion(source: string, toolName: string): string {
  const escaped = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const startMatch = source.match(new RegExp(`server\\.registerTool\\(\\s*"${escaped}"`, "m"));
  assert.ok(startMatch?.index !== undefined, `tool not found: ${toolName}`);
  const start = startMatch.index;
  const next = source.indexOf("server.registerTool(", start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe("metrics and compact handler coverage", () => {
  const source = readServerSource();

  it("registerTool wrapper injects include_call_metrics on all tools", () => {
    assert.match(source, /withCallMetricsSchema\(config\.inputSchema\)/);
    const registerCalls = source.match(/server\.registerTool\(/g)?.length ?? 0;
    const withMetricsCalls = source.match(/withCallMetricsSchema\(config\.inputSchema\)/g)?.length ?? 0;
    assert.ok(registerCalls >= 64, "expected at least 64 registerTool calls");
    assert.equal(withMetricsCalls, 2, "advanced + legacy registerTool wrappers should each call withCallMetricsSchema");
  });

  it("about_mcp_tools exposes metrics_breakdown and metrics_reset", () => {
    const region = toolRegion(source, "about_mcp_tools");
    assert.match(region, /metrics_breakdown\s*:/);
    assert.match(region, /metrics_reset\s*:/);
    assert.match(region, /getFullMetricsMarkdown/);
    assert.match(region, /toolMetrics\.reset\(\)/);
  });

  describe("Tier 1 compact (TCM data family)", () => {
    const tier1Tools = [
      "get_all_tcm_test_cases_with_root_suite_id",
      "get_test_cases_advanced",
      "get_test_cases_by_automation_state",
      "get_test_case_by_filter",
      "get_test_case_by_title",
      "get_all_subsuites",
      "get_suite_hierarchy",
      "get_root_suites",
      "get_tcm_test_suites_by_project",
      "get_all_tcm_test_case_suites_by_project",
      "get_tcm_suite_by_id",
    ] as const;

    for (const toolName of tier1Tools) {
      it(`${toolName} schema includes compact and uses FormatProcessor`, () => {
        const region = toolRegion(source, toolName);
        assert.match(
          region,
          /format:\s*z\.enum\(\['dto',\s*'json',\s*'compact'/,
          `${toolName} should allow format=compact`,
        );
        assert.match(region, /FormatProcessor\.format/, `${toolName} should route through FormatProcessor`);
      });
    }

    it("get_root_suites compact path returns minified JSON via FormatProcessor", () => {
      const region = toolRegion(source, "get_root_suites");
      const formatted = region.match(/FormatProcessor\.format\([^)]+\)/)?.[0];
      assert.ok(formatted, "expected FormatProcessor.format call");
      assert.match(region, /format as any|format\s*\}/);
    });
  });

  describe("Tier 2 compact (raw / formatted reporting)", () => {
    const tier2Cases: Array<{ tool: string; rawVar: string }> = [
      { tool: "get_platform_results_by_period", rawVar: "data" },
      { tool: "get_top_bugs", rawVar: "raw" },
      { tool: "get_project_milestones", rawVar: "filteredMilestonesData" },
      { tool: "get_available_projects", rawVar: "compactResult" },
      { tool: "list_test_runs", rawVar: "testRunsData" },
      { tool: "get_test_run_by_id", rawVar: "testRunData" },
      { tool: "list_test_run_test_cases", rawVar: "testCasesData" },
    ];

    for (const { tool, rawVar } of tier2Cases) {
      it(`${tool} supports compact minified raw JSON`, () => {
        const region = toolRegion(source, tool);
        assert.match(
          region,
          /format:\s*z\.enum\(\['raw',\s*'formatted',\s*'compact'\]/,
          `${tool} schema should include compact`,
        );
        assert.match(region, /args\.format === 'compact'/, `${tool} handler should branch on compact`);
        assert.match(
          region,
          new RegExp(`JSON\\.stringify\\(${rawVar}\\)`),
          `${tool} compact should minify ${rawVar}`,
        );
      });
    }
  });
});
