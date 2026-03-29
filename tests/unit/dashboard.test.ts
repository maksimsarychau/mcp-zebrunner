import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── dashboard-template tests ──────────────────────────────────────────────

import {
  generateDashboardHtml,
  type DashboardData,
  type DashboardSection,
} from "../../src/utils/dashboard-template.js";

const chartSection: DashboardSection = {
  id: "pass_rate",
  title: "Pass Rate Overview",
  chartType: "stacked_bar",
  labels: ["Android", "iOS"],
  datasets: [
    { label: "Passed", data: [80, 70], backgroundColor: "#59a14f" },
    { label: "Failed", data: [10, 20], backgroundColor: "#e15759" },
  ],
  summary: "Overall pass rate: 83.3%",
};

const tableSection: DashboardSection = {
  id: "milestones",
  title: "Milestone Summary",
  chartType: "table",
  labels: [],
  datasets: [],
  tableHeaders: ["Project", "Milestone", "Status"],
  tableRows: [
    ["Android", "v25.39", "Completed"],
    ["iOS", "v25.39", "In Progress"],
  ],
  summary: "2 milestones",
};

const sampleData: DashboardData = {
  title: "Quality Dashboard",
  period: "Last 30 Days",
  projects: ["Android", "iOS"],
  generatedAt: "2026-03-24 12:00:00 UTC",
  sections: [chartSection, tableSection],
};

describe("dashboard-template: generateDashboardHtml", () => {
  it("returns valid HTML with doctype", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.includes("</html>"));
  });

  it("includes dashboard title", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("Quality Dashboard"));
  });

  it("includes project names in meta section", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("Android"));
    assert.ok(html.includes("iOS"));
  });

  it("includes period and generation time", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("Last 30 Days"));
    assert.ok(html.includes("2026-03-24 12:00:00 UTC"));
  });

  it("includes Chart.js CDN script", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("cdn.jsdelivr.net/npm/chart.js"));
  });

  it("creates canvas elements for chart sections", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes('id="chart_0"'));
  });

  it("renders table for table sections", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("<table>"));
    assert.ok(html.includes("Milestone"));
    assert.ok(html.includes("v25.39"));
    assert.ok(html.includes("Completed"));
  });

  it("escapes HTML in title", () => {
    const data: DashboardData = {
      ...sampleData,
      title: "<script>alert('xss')</script>",
    };
    const html = generateDashboardHtml(data);
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>alert"));
  });

  it("renders summary text for sections", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("Overall pass rate: 83.3%"));
    assert.ok(html.includes("2 milestones"));
  });

  it("includes responsive grid layout", () => {
    const html = generateDashboardHtml(sampleData);
    assert.ok(html.includes("grid"));
    assert.ok(html.includes("@media"));
  });

  it("handles empty sections array", () => {
    const data: DashboardData = { ...sampleData, sections: [] };
    const html = generateDashboardHtml(data);
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("Quality Dashboard"));
  });

  it("renders multiple chart types correctly", () => {
    const pieSection: DashboardSection = {
      id: "coverage",
      title: "Coverage",
      chartType: "pie",
      labels: ["Automated", "Manual"],
      datasets: [{ label: "Tests", data: [100, 50] }],
    };
    const data: DashboardData = { ...sampleData, sections: [pieSection] };
    const html = generateDashboardHtml(data);
    assert.ok(html.includes("'pie'"));
  });
});

// ── widget-sql tests ──────────────────────────────────────────────────────

import {
  buildParamsConfig,
  ALL_PERIODS,
  TEMPLATE,
  PLATFORM_MAP,
  createWidgetSqlCaller,
} from "../../src/utils/widget-sql.js";

describe("widget-sql: buildParamsConfig", () => {
  it("normalizes period case-insensitively", () => {
    const result = buildParamsConfig({ period: "last 30 days" });
    assert.equal(result.PERIOD, "Last 30 Days");
  });

  it("throws for invalid period", () => {
    assert.throws(() => buildParamsConfig({ period: "InvalidPeriod" }), /Invalid period/);
  });

  it("resolves platform alias to array", () => {
    const result = buildParamsConfig({ period: "Week", platform: "ios" });
    assert.deepEqual(result.PLATFORM, ["ios"]);
  });

  it("passes array platform directly", () => {
    const result = buildParamsConfig({ period: "Week", platform: ["custom"] });
    assert.deepEqual(result.PLATFORM, ["custom"]);
  });

  it("uses empty platform when not specified", () => {
    const result = buildParamsConfig({ period: "Week" });
    assert.deepEqual(result.PLATFORM, []);
  });

  it("applies milestone filter", () => {
    const result = buildParamsConfig({ period: "Week", milestone: ["25.39.0"] });
    assert.deepEqual(result.MILESTONE, ["25.39.0"]);
  });

  it("applies extra params", () => {
    const result = buildParamsConfig({ period: "Week", extra: { CUSTOM: "val" } });
    assert.equal((result as any).CUSTOM, "val");
  });

  it("uses custom dashboard name", () => {
    const result = buildParamsConfig({ period: "Week", dashboardName: "My Dashboard" });
    assert.equal(result.dashboardName, "My Dashboard");
  });

  it("defaults dashboard name to Weekly results", () => {
    const result = buildParamsConfig({ period: "Week" });
    assert.equal(result.dashboardName, "Weekly results");
  });

  it("sets isReact to true", () => {
    const result = buildParamsConfig({ period: "Week" });
    assert.equal(result.isReact, true);
  });
});

describe("widget-sql: ALL_PERIODS", () => {
  it("contains expected periods", () => {
    assert.ok(ALL_PERIODS.includes("Last 30 Days"));
    assert.ok(ALL_PERIODS.includes("Total"));
    assert.ok(ALL_PERIODS.includes("Today"));
    assert.equal(ALL_PERIODS.length, 12);
  });
});

describe("widget-sql: TEMPLATE", () => {
  it("has expected template IDs", () => {
    assert.equal(TEMPLATE.RESULTS_BY_PLATFORM, 8);
    assert.equal(TEMPLATE.TOP_BUGS, 4);
    assert.equal(TEMPLATE.BUG_REVIEW, 9);
  });
});

describe("widget-sql: PLATFORM_MAP", () => {
  it("has ios mapping", () => {
    assert.deepEqual(PLATFORM_MAP.ios, ["ios"]);
  });

  it("has empty mapping for web", () => {
    assert.deepEqual(PLATFORM_MAP.web, []);
  });
});

describe("widget-sql: createWidgetSqlCaller", () => {
  it("creates a callable function", () => {
    const caller = createWidgetSqlCaller("https://test.com", async () => "token");
    assert.equal(typeof caller, "function");
  });
});

// ── ReportHandler tests ──────────────────────────────────────────────────

import { ReportHandler } from "../../src/handlers/report-handler.js";

function createMockReportingHandlers() {
  return {
    analyzeRegressionRuntime: async (_input: any) => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          aggregated: {
            totalTests: 95,
            totalTestCasesCovered: 80,
            totalElapsedSeconds: 5400,
            overallAvgRuntimePerTest: 56.8,
            overallAvgRuntimePerTestCase: 67.5,
            overallWeightedRuntimeIndex: 72.3,
            durationDistribution: {
              shortCount: 60, shortPercent: 63,
              mediumCount: 25, mediumPercent: 26,
              longCount: 10, longPercent: 11,
              shortTestCases: 50, mediumTestCases: 20, longTestCases: 10,
            }
          }
        })
      }]
    }),
    findFlakyTests: async (_input: any) => ({
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          flaky_tests: [
            { test_name: "TestLogin.flaky", flip_count: 5, pass_rate: 60, stability: 40 },
            { test_name: "TestCheckout.unstable", flip_count: 3, pass_rate: 70, stability: 55 },
          ],
          total_flaky: 2,
        })
      }]
    }),
    analyzeLaunchFailures: async (_input: any) => ({
      content: [{ type: 'text' as const, text: 'No unlinked failures' }]
    }),
  } as any;
}

function createMockHandler() {
  const now = new Date();
  const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const pastDate = new Date(now.getTime() - 25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const oldDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const mockReportingClient = {
    authenticate: async () => "mock-token",
    getLaunches: async (_pid: number, _opts?: any) => ({
      items: [
        { id: 1, name: "Launch 1", status: "COMPLETED", passed: 80, failed: 10, skipped: 5, total: 95, duration: 300000, projectId: 1 },
        { id: 2, name: "Launch 2", status: "COMPLETED", passed: 70, failed: 15, skipped: 10, total: 95, duration: 250000, projectId: 1 },
      ],
      _meta: { total: 2, totalPages: 1 },
    }),
    getMilestones: async (_pid: number, _opts?: any) => ({
      items: [
        { id: 1, name: "v25.39", completed: true, dueDate: recentDate, startDate: pastDate, projectId: 1 },
        { id: 2, name: "v25.40", completed: false, dueDate: pastDate, startDate: oldDate, projectId: 1 },
      ],
      _meta: { total: 2, totalPages: 1 },
    }),
    getAutomationStates: async (_pid: number) => [
      { id: 1, name: "Automated" },
      { id: 2, name: "Manual" },
      { id: 3, name: "Not Automated" },
    ],
  } as any;

  const mockPublicClient = {
    getTestCases: async (_key: string, opts: any = {}) => {
      const filter = opts.filter || "";
      if (filter.includes("1")) return { items: [], _meta: { totalElements: 120 } };
      if (filter.includes("2")) return { items: [], _meta: { totalElements: 30 } };
      if (filter.includes("3")) return { items: [], _meta: { totalElements: 10 } };
      return { items: [], _meta: { totalElements: 0 } };
    },
    getTestSuites: async (_key: string, _opts: any = {}) => ({
      items: [
        { id: 101, name: "Regression" },
        { id: 102, name: "Critical" },
      ],
      _meta: { nextPageToken: undefined },
    }),
  } as any;

  const mockWidgetSql = async (_pid: number, templateId: number, _params: any) => {
    if (templateId === 8) {
      return [{ PLATFORM: "Android", PASSED: 80, FAILED: 10, SKIPPED: 5 }];
    }
    if (templateId === 4) {
      return [
        { DEFECT: '<a href="#">BUG-123</a>', FAILURES: "5 of 10", "%": "50.0" },
        { DEFECT: '<a href="#">BUG-456</a>', FAILURES: "3 of 8", "%": "37.5" },
      ];
    }
    return [];
  };

  const mockResolveProjectId = async (project: string | number) => {
    if (typeof project === "number") return { projectId: project };
    return { projectId: 1 };
  };

  const aliases: Record<string, string> = { android: "MFPAND", ios: "MFPIOS" };

  return new ReportHandler(
    mockReportingClient,
    mockPublicClient,
    createMockReportingHandlers(),
    mockWidgetSql,
    mockResolveProjectId,
    aliases,
  );
}

// ── Quality Dashboard via generate_report ─────────────────────────────────

describe("ReportHandler: quality_dashboard report", () => {
  it("returns content blocks with text and image entries", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    assert.ok(Array.isArray(result.content));
    const textBlocks = result.content.filter((c: any) => c.type === "text");
    assert.ok(textBlocks.length >= 2, "should have at least markdown and HTML blocks");

    const markdownBlock = textBlocks[0];
    assert.ok(markdownBlock.text.includes("Quality Dashboard"));
    assert.ok(markdownBlock.text.includes("android"));

    const htmlBlock = textBlocks.find((b: any) => b.text.includes("[HTML_DASHBOARD]"));
    assert.ok(htmlBlock, "should include HTML dashboard block");
    assert.ok(htmlBlock.text.includes("<!DOCTYPE html>"));
  });

  it("generates PNG image blocks for chart sections", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const imageBlocks = result.content.filter((c: any) => c.type === "image");
    assert.ok(imageBlocks.length > 0, "should have at least one PNG chart");
    assert.equal(imageBlocks[0].mimeType, "image/png");
  });

  it("handles multiple projects", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android", "ios"],
      period: "Last 30 Days",
    });
    const md = result.content[0].text;
    assert.ok(md.includes("android"));
    assert.ok(md.includes("ios"));
  });

  it("respects sections filter", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
      sections: ["pass_rate"],
    });
    const md = result.content[0].text;
    assert.ok(md.includes("Pass Rate"));
    assert.ok(!md.includes("Milestone Summary"));
    assert.ok(!md.includes("Regression Runtime"));
  });

  it("generates milestone table in markdown", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
      sections: ["milestones"],
    });
    const md = result.content[0].text;
    assert.ok(md.includes("Milestone Summary"));
    assert.ok(md.includes("v25.39"));
    assert.ok(md.includes("Completed"));
    assert.ok(md.includes("OVERDUE"));
  });

  it("shows target comparison with default targets", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
      sections: ["pass_rate"],
    });
    const md = result.content[0].text;
    assert.ok(md.includes("Target"), "should have Target column");
    assert.ok(md.includes("90%"), "should show default android target of 90%");
  });

  it("uses custom targets when provided", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
      sections: ["pass_rate"],
      targets: { android: 75 },
    });
    const md = result.content[0].text;
    assert.ok(md.includes("75%"), "should show custom target of 75%");
  });

  it("shows WRI and duration distribution", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
      sections: ["runtime"],
    });
    const md = result.content[0].text;
    assert.ok(md.includes("WRI"), "should show WRI column");
    assert.ok(md.includes("63%"), "should show short percentage");
  });

  it("shows flaky tests section", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
      sections: ["flaky"],
    });
    const md = result.content[0].text;
    assert.ok(md.includes("Flaky Tests"));
    assert.ok(md.includes("TestLogin.flaky"));
    assert.ok(md.includes("TestCheckout.unstable"));
  });
});

// ── Error handling ────────────────────────────────────────────────────────

describe("ReportHandler: error handling", () => {
  it("returns error content when no projects can be resolved", async () => {
    const handler = new ReportHandler(
      {} as any,
      {} as any,
      createMockReportingHandlers(),
      async () => [],
      async () => { throw new Error("Not found"); },
      {},
    );

    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["nonexistent"],
      period: "Last 30 Days",
    });

    const text = result.content.map((c: any) => c.text || '').join('\n');
    assert.ok(text.includes("Could not resolve any") || text.includes("Error"), "should report resolution failure");
  });

  it("gracefully handles partial project failures", async () => {
    let callCount = 0;
    const handler = new ReportHandler(
      {
        getLaunches: async () => ({ items: [], _meta: { total: 0, totalPages: 1 } }),
        getMilestones: async () => ({ items: [], _meta: { total: 0, totalPages: 1 } }),
        getAutomationStates: async () => [],
      } as any,
      {
        getTestCases: async () => ({ items: [], _meta: { totalElements: 0 } }),
      } as any,
      createMockReportingHandlers(),
      async () => [],
      async (_p: string | number) => {
        callCount++;
        if (callCount === 1) return { projectId: 1 };
        throw new Error("Not found");
      },
      { android: "MFPAND", ios: "MFPIOS" },
    );

    const result = await handler.generateReport({
      report_types: ["quality_dashboard"],
      projects: ["android", "bad_project"],
      period: "Last 30 Days",
    });

    assert.ok(result.content.length > 0);
  });

  it("reports unknown report type gracefully", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["nonexistent_report" as any],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const text = result.content[0].text;
    assert.ok(text.includes("Unknown report type"));
  });
});

// ── Routing: multiple report types ────────────────────────────────────────

describe("ReportHandler: multi-report routing", () => {
  it("generates multiple reports with separators", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["pass_rate", "coverage"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const textBlocks = result.content.filter((c: any) => c.type === "text");
    const allText = textBlocks.map((b: any) => b.text).join('\n');
    assert.ok(allText.includes("Report: Pass Rate"), "should contain pass rate separator");
    assert.ok(allText.includes("Report: Coverage"), "should contain coverage separator");
  });
});

// ── Pass Rate report ──────────────────────────────────────────────────────

describe("ReportHandler: pass_rate report", () => {
  it("generates pass rate markdown with targets", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["pass_rate"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("Pass Rate Report"));
    assert.ok(md.includes("Target"));
    assert.ok(md.includes("90%"));
  });

  it("generates PNG chart", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["pass_rate"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const imageBlocks = result.content.filter((c: any) => c.type === "image");
    assert.ok(imageBlocks.length > 0, "should include PNG chart");
  });
});

// ── Runtime Efficiency report ─────────────────────────────────────────────

describe("ReportHandler: runtime_efficiency report", () => {
  it("generates runtime markdown with metrics", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["runtime_efficiency"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("Regression Runtime Efficiency Report"));
    assert.ok(md.includes("WRI"));
    assert.ok(md.includes("Short"));
  });

  it("generates delta table when previous_milestone is provided", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["runtime_efficiency"],
      projects: ["android"],
      period: "Last 30 Days",
      milestone: "25.40.0",
      previous_milestone: "25.39.0",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("Delta vs Previous Milestone"));
    assert.ok(md.includes("25.39.0"));
  });
});

// ── Coverage report ───────────────────────────────────────────────────────

describe("ReportHandler: coverage report", () => {
  it("generates per-suite coverage table", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["coverage"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("Test Coverage Report"));
    assert.ok(md.includes("Suite Name"));
    assert.ok(md.includes("TOTAL"));
    assert.ok(md.includes("TOTAL REGRESSION"));
  });

  it("excludes suites matching exclude patterns", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["coverage"],
      projects: ["android"],
      period: "Last 30 Days",
      exclude_suite_patterns: ["Critical"],
    });

    const md = result.content[0].text;
    assert.ok(md.includes("TOTAL REGRESSION"));
  });
});

// ── Executive Dashboard report ────────────────────────────────────────────

describe("ReportHandler: executive_dashboard report", () => {
  it("generates executive summary with all sections", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["executive_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const textBlocks = result.content.filter((c: any) => c.type === "text");
    const allText = textBlocks.map((b: any) => b.text).join('\n');
    assert.ok(allText.includes("Executive QA Dashboard"));
    assert.ok(allText.includes("Pass Rate"));
    assert.ok(allText.includes("Automation Coverage"));
  });

  it("includes HTML dashboard", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["executive_dashboard"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const textBlocks = result.content.filter((c: any) => c.type === "text");
    const htmlBlock = textBlocks.find((b: any) => b.text.includes("[HTML_DASHBOARD]"));
    assert.ok(htmlBlock, "should include HTML dashboard");
  });
});

// ── Release Readiness report ──────────────────────────────────────────────

describe("ReportHandler: release_readiness report", () => {
  it("generates Go/No-Go assessment", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["release_readiness"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("Release Readiness Assessment"));
    assert.ok(md.includes("Overall Recommendation"));
    assert.ok(md.includes("Pass Rate") || md.includes("PASS") || md.includes("FAIL"));
  });

  it("shows per-check status table", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["release_readiness"],
      projects: ["android"],
      period: "Last 30 Days",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("Check"));
    assert.ok(md.includes("Status"));
    assert.ok(md.includes("Detail"));
  });

  it("evaluates multiple platforms independently", async () => {
    const handler = createMockHandler();
    const result = await handler.generateReport({
      report_types: ["release_readiness"],
      projects: ["android", "ios"],
      period: "Last 30 Days",
    });

    const md = result.content[0].text;
    assert.ok(md.includes("android"));
    assert.ok(md.includes("ios"));
  });
});
