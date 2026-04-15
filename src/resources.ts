/**
 * MCP Resources for Zebrunner MCP Server.
 *
 * Provides read-only reference data via the MCP resource protocol:
 * - Static resources (no API calls): report types, periods, charts, formats
 * - Dynamic resources (cached API calls): projects, suites, automation states, priorities
 *
 * Resources are accessed by users via the '@' menu in MCP clients.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EnhancedZebrunnerClient } from "./api/enhanced-client.js";
import type { ZebrunnerReportingClient } from "./api/reporting-client.js";
import { ALL_PERIODS } from "./utils/widget-sql.js";
import { PERIOD_DAYS_MAP } from "./handlers/reports/types.js";

// ── Cache ────────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 1_200_000; // 20 minutes
const MAX_CACHE_ENTRIES = 200;

export class ResourceCache {
  private store = new Map<string, { data: unknown; expiry: number }>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiry) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs: number = DEFAULT_TTL_MS): void {
    if (this.store.size >= MAX_CACHE_ENTRIES) {
      this.evictExpired();
      if (this.store.size >= MAX_CACHE_ENTRIES) {
        this.evictOldest();
      }
    }
    this.store.set(key, { data, expiry: Date.now() + ttlMs });
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, entry] of this.store) {
      if (entry.expiry < oldestExpiry) {
        oldestExpiry = entry.expiry;
        oldestKey = key;
      }
    }
    if (oldestKey) this.store.delete(oldestKey);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiry) this.store.delete(key);
    }
  }
}

// ── Static content builders (exported for unit testing) ──────────────────────

export function buildReportTypesContent(): object {
  return {
    report_types: [
      {
        name: "quality_dashboard",
        title: "Quality Dashboard",
        description: "Comprehensive HTML + Markdown dashboard with up to 6 configurable panels",
        sections: ["pass_rate", "runtime", "coverage", "bugs", "milestones", "flaky"],
        outputs: ["Markdown summary", "PNG charts per section", "Self-contained HTML dashboard"],
        optional_params: ["sections", "top_bugs_limit", "milestone", "targets"],
        example: 'generate_report({ report_types: ["quality_dashboard"], projects: ["android", "ios"], period: "Last 30 Days" })',
      },
      {
        name: "coverage",
        title: "Test Coverage Report",
        description: "Per-suite automation coverage table with Implemented, Manual Only, Deprecated, Total, and Coverage % columns",
        outputs: ["Markdown table per project", "TOTAL and TOTAL REGRESSION summary rows"],
        optional_params: ["exclude_suite_patterns"],
        default_exclude_patterns: ["MA", "Minimal Acceptance", "Critical", "Performance"],
        example: 'generate_report({ report_types: ["coverage"], projects: ["android", "ios", "web"] })',
      },
      {
        name: "pass_rate",
        title: "Pass Rate Report",
        description: "Per-platform pass rate with known-issue exclusion and target comparison",
        outputs: ["Markdown table", "PNG chart", "Target status indicators"],
        optional_params: ["milestone", "targets"],
        default_targets: { android: 90, ios: 90, web: 65 },
        example: 'generate_report({ report_types: ["pass_rate"], projects: ["android", "ios", "web"], milestone: "25.40.0" })',
      },
      {
        name: "runtime_efficiency",
        title: "Runtime Efficiency Report",
        description: "Runtime metrics with optional delta comparison against a previous milestone",
        outputs: ["Current metrics table", "Delta table (if previous_milestone set)", "Degradation alerts"],
        optional_params: ["milestone", "previous_milestone"],
        metrics: ["avg runtime per test", "avg runtime per test case", "WRI", "duration distribution (short/medium/long)"],
        example: 'generate_report({ report_types: ["runtime_efficiency"], projects: ["android"], milestone: "25.40.0", previous_milestone: "25.39.0" })',
      },
      {
        name: "executive_dashboard",
        title: "Executive Dashboard",
        description: "Standup-ready combined report with pass rate, runtime, top bugs, coverage, and flaky tests",
        outputs: ["Markdown summary", "PNG charts", "HTML dashboard"],
        optional_params: ["milestone", "top_bugs_limit", "targets"],
        example: 'generate_report({ report_types: ["executive_dashboard"], projects: ["android", "ios", "web"] })',
      },
      {
        name: "release_readiness",
        title: "Release Readiness Assessment",
        description: "Go / No-Go / Conditional recommendation with per-check PASS/FAIL/WARN status",
        checks: ["pass_rate vs target", "unresolved failures", "runtime degradation", "automation coverage", "defect density"],
        outputs: ["Per-check status table", "Go/No-Go recommendation with evidence"],
        optional_params: ["milestone", "previous_milestone", "targets"],
        example: 'generate_report({ report_types: ["release_readiness"], projects: ["android"], milestone: "25.40.0", previous_milestone: "25.39.0" })',
      },
    ],
    shared_params: {
      projects: "Required. Array of project aliases or keys (e.g., ['android', 'ios', 'web'])",
      period: "Time period — see zebrunner://periods for valid values. Default: 'Last 30 Days'",
      milestone: "Optional milestone filter (e.g., '25.40.0')",
      previous_milestone: "Optional baseline milestone for delta comparison",
    },
    tips: [
      "You can combine multiple report types in one call: report_types: ['coverage', 'pass_rate']",
      "Use 'targets' to set custom pass rate thresholds per project",
      "Use 'exclude_suite_patterns' in coverage reports to customize TOTAL REGRESSION calculation",
    ],
  };
}

export function buildPeriodsContent(): object {
  const periods = ALL_PERIODS.map((p) => ({
    value: p,
    days: PERIOD_DAYS_MAP[p.toLowerCase()] ?? null,
  }));

  return {
    periods,
    used_by: [
      { tool: "generate_report", default: "Last 30 Days" },
      { tool: "get_platform_results_by_period", default: "Last 7 Days" },
      { tool: "get_top_bugs", default: "Last 7 Days" },
      { tool: "get_bug_review", default: "Last 7 Days" },
      { tool: "get_bug_failure_info", default: "Last 14 Days" },
    ],
    tips: [
      "Period values are case-sensitive — use 'Last 30 Days', not 'last 30 days'",
      "Use 'Total' for all-time data (maps to ~10 years)",
    ],
  };
}

export function buildChartOptionsContent(): object {
  return {
    delivery_formats: [
      { value: "none", description: "No chart (default)" },
      { value: "png", description: "PNG image — best for Claude Desktop inline display" },
      { value: "html", description: "Interactive Chart.js HTML page" },
      { value: "text", description: "ASCII/markdown table chart" },
    ],
    chart_types: [
      { value: "auto", description: "Tool picks best fit (default)" },
      { value: "pie", description: "Pie chart — good for status distributions" },
      { value: "bar", description: "Vertical bar chart" },
      { value: "stacked_bar", description: "Stacked bar — good for multi-status comparisons" },
      { value: "horizontal_bar", description: "Horizontal bar — good for ranked lists" },
      { value: "line", description: "Line chart — good for trends over time" },
    ],
    supported_tools: [
      "get_launch_details", "get_launch_test_summary",
      "generate_weekly_regression_stability_report", "get_launch_summary",
      "analyze_regression_runtime", "find_flaky_tests",
      "get_test_execution_history", "detailed_analyze_launch_failures",
      "get_all_launches_for_project", "get_all_launches_with_filter",
      "get_platform_results_by_period", "get_top_bugs", "get_bug_review",
      "list_test_runs", "get_test_run_by_id", "list_test_run_test_cases",
      "aggregate_test_cases_by_feature",
    ],
    tips: [
      "Use chart: 'png' for inline images in Claude Desktop",
      "Use chart_type: 'pie' to override default bar charts on status tools",
      "Use chart: 'text' as a fallback when image rendering is not available",
    ],
  };
}

export function buildFormatReferenceContent(): object {
  return {
    format_families: [
      {
        name: "data",
        values: ["dto", "json", "string", "markdown"],
        description: "Full data format for TCM tools (test cases, suites, hierarchy)",
        tools_count: 18,
        default: "json",
        tips: "Use 'markdown' for human-readable output with clickable links",
      },
      {
        name: "data_simple",
        values: ["dto", "json", "string"],
        description: "Data format without markdown option (execution history, test run cases)",
        tools_count: 6,
        default: "json",
      },
      {
        name: "raw_formatted",
        values: ["raw", "formatted"],
        description: "API response vs formatted output for reporting/widget tools",
        tools_count: 11,
        default: "formatted",
        tips: "Use 'raw' for unprocessed API responses when debugging",
      },
      {
        name: "verbosity",
        values: ["detailed", "summary", "jira"],
        description: "Output detail level for failure analysis tools",
        tools_count: 3,
        default: "detailed",
        tips: "Use 'jira' for Jira-compatible markup ready for ticket creation",
      },
      {
        name: "metadata",
        values: ["json", "markdown"],
        description: "Format for reference data tools (automation states, priorities)",
        tools_count: 2,
        default: "json",
      },
    ],
    tips: [
      "The 'format' parameter name is used across all families — check tool description for valid values",
      "Some tools use 'output_format' instead of 'format' for specialized outputs",
    ],
  };
}

// ── Resource registration ────────────────────────────────────────────────────

export interface ResourceDependencies {
  client: EnhancedZebrunnerClient;
  reportingClient: ZebrunnerReportingClient;
  resolveProjectId: (project: string | number) => Promise<{ projectId: number; suggestions?: string }>;
  PROJECT_ALIASES: Record<string, string>;
  DEBUG_MODE: boolean;
}

export function registerResources(server: McpServer, deps: ResourceDependencies): void {
  const cache = new ResourceCache();
  const { client, reportingClient, resolveProjectId, PROJECT_ALIASES, DEBUG_MODE } = deps;

  function debugLog(msg: string, data?: unknown) {
    if (DEBUG_MODE) {
      console.error(`🔍 [RESOURCE] ${msg}`, data ? JSON.stringify(data) : "");
    }
  }

  function resourceTrace(handlerName: string, uri: URL, variables: Record<string, string | string[]>) {
    console.error(`📡 [RESOURCE-READ] handler=${handlerName} uri=${uri.href} vars=${JSON.stringify(variables)}`);
  }

  // Helper: fetch and cache the projects list (shared by template list/complete callbacks)
  async function getCachedProjects(): Promise<Array<{ name: string; key: string; id: number; starred: boolean; publiclyAccessible: boolean }>> {
    const CACHE_KEY = "projects";
    const cached = cache.get<typeof result>(CACHE_KEY);
    if (cached) return cached;

    debugLog("Fetching projects for resource");
    const data = await reportingClient.getAvailableProjects({});
    const result = data.items.map((p: any) => ({
      name: p.name,
      key: p.key,
      id: p.id,
      starred: p.starred ?? false,
      publiclyAccessible: p.publiclyAccessible ?? false,
    }));
    cache.set(CACHE_KEY, result);
    return result;
  }

  // Shared list callback: enumerates all projects for template resources
  function projectListCallback(pathSuffix: string, labelSuffix: string) {
    return async () => {
      const projects = await getCachedProjects();
      return {
        resources: projects.map((p) => ({
          uri: `zebrunner://projects/${p.key}/${pathSuffix}`,
          name: `${p.name} — ${labelSuffix}`,
          description: `${labelSuffix} for project ${p.key}`,
        })),
      };
    };
  }

  // Shared complete callback: autocomplete project keys
  function projectKeyComplete() {
    return async (value: string) => {
      const projects = await getCachedProjects();
      const allKeys = [
        ...projects.map((p) => p.key),
        ...Object.keys(PROJECT_ALIASES),
      ];
      const unique = [...new Set(allKeys)];
      return unique.filter((k) => k.toLowerCase().startsWith(value.toLowerCase()));
    };
  }

  // ── 1.1 Static: Available Projects ─────────────────────────────────────────

  server.registerResource(
    "available_projects",
    "zebrunner://projects",
    {
      description: "List of all Zebrunner projects accessible to the current user with keys, IDs, and metadata",
    },
    async () => {
      const projects = await getCachedProjects();
      return {
        contents: [{
          uri: "zebrunner://projects",
          mimeType: "application/json",
          text: JSON.stringify(projects, null, 2),
        }],
      };
    },
  );

  // ── 1.2 Static: Report Types ───────────────────────────────────────────────

  server.registerResource(
    "report_types",
    "zebrunner://reports/types",
    {
      description: "Available report types for the generate_report tool with descriptions, parameters, and examples",
    },
    async () => ({
      contents: [{
        uri: "zebrunner://reports/types",
        mimeType: "application/json",
        text: JSON.stringify(buildReportTypesContent(), null, 2),
      }],
    }),
  );

  // ── 1.3 Template: Root Suites for Project ──────────────────────────────────

  server.registerResource(
    "project_root_suites",
    new ResourceTemplate("zebrunner://projects/{project_key}/suites", {
      list: projectListCallback("suites", "Root Suites"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Root test suites (top-level suites with no parent) for a Zebrunner project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_root_suites", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `suites:${pk}`;
      let rootSuites = cache.get<any[]>(cacheKey);

      if (!rootSuites) {
        debugLog("Fetching root suites", { project_key: pk });
        const allSuites = await client.getAllTestSuites(pk);
        rootSuites = allSuites
          .filter((s: any) => !s.parentId)
          .map((s: any) => ({ id: s.id, name: s.name, description: s.description || null }));
        cache.set(cacheKey, rootSuites);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(rootSuites, null, 2),
        }],
      };
    },
  );

  // ── 1.4 Template: Automation States ────────────────────────────────────────

  server.registerResource(
    "project_automation_states",
    new ResourceTemplate("zebrunner://projects/{project_key}/automation-states", {
      list: projectListCallback("automation-states", "Automation States"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Available automation states (e.g., Automated, Manual, Not Automated) for a Zebrunner project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_automation_states", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `automation-states:${pk}`;
      let states = cache.get<any[]>(cacheKey);

      if (!states) {
        debugLog("Fetching automation states", { project_key: pk });
        const { projectId } = await resolveProjectId(pk);
        states = await reportingClient.getAutomationStates(projectId);
        cache.set(cacheKey, states);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(states, null, 2),
        }],
      };
    },
  );

  // ── 1.5 Template: Priorities ───────────────────────────────────────────────

  server.registerResource(
    "project_priorities",
    new ResourceTemplate("zebrunner://projects/{project_key}/priorities", {
      list: projectListCallback("priorities", "Priorities"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Available priority levels (e.g., Critical, High, Medium, Low) for a Zebrunner project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_priorities", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `priorities:${pk}`;
      let priorities = cache.get<any[]>(cacheKey);

      if (!priorities) {
        debugLog("Fetching priorities", { project_key: pk });
        const { projectId } = await resolveProjectId(pk);
        priorities = await reportingClient.getPriorities(projectId);
        cache.set(cacheKey, priorities);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(priorities, null, 2),
        }],
      };
    },
  );

  // ── 1.6 Static: Time Periods ───────────────────────────────────────────────

  server.registerResource(
    "time_periods",
    "zebrunner://periods",
    {
      description: "Valid time period values accepted by reporting and widget tools (e.g., 'Last 30 Days', 'Week')",
    },
    async () => ({
      contents: [{
        uri: "zebrunner://periods",
        mimeType: "application/json",
        text: JSON.stringify(buildPeriodsContent(), null, 2),
      }],
    }),
  );

  // ── 1.7 Static: Chart Options ──────────────────────────────────────────────

  server.registerResource(
    "chart_options",
    "zebrunner://charts",
    {
      description: "Available chart delivery formats (png, html, text) and chart types (pie, bar, line, etc.) for 17 tools",
    },
    async () => ({
      contents: [{
        uri: "zebrunner://charts",
        mimeType: "application/json",
        text: JSON.stringify(buildChartOptionsContent(), null, 2),
      }],
    }),
  );

  // ── 1.8 Static: Output Format Reference ────────────────────────────────────

  server.registerResource(
    "output_formats",
    "zebrunner://formats",
    {
      description: "Catalog of all output format parameter families used across tools (data, raw/formatted, verbosity, etc.)",
    },
    async () => ({
      contents: [{
        uri: "zebrunner://formats",
        mimeType: "application/json",
        text: JSON.stringify(buildFormatReferenceContent(), null, 2),
      }],
    }),
  );

  // ── 2.1 Template: Milestones ──────────────────────────────────────────────

  server.registerResource(
    "project_milestones",
    new ResourceTemplate("zebrunner://projects/{project_key}/milestones", {
      list: projectListCallback("milestones", "Milestones"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Active and completed milestones (version tags) for a Zebrunner project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_milestones", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `milestones:${pk}`;
      let milestones = cache.get<any[]>(cacheKey);

      if (!milestones) {
        debugLog("Fetching milestones", { project_key: pk });
        const { projectId } = await resolveProjectId(pk);
        const resp = await reportingClient.getMilestones(projectId, { pageSize: 50, completed: "all" });
        milestones = resp.items.map((m: any) => ({
          id: m.id,
          name: m.name,
          completed: m.completed ?? false,
        }));
        cache.set(cacheKey, milestones);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(milestones, null, 2),
        }],
      };
    },
  );

  // ── 2.2 Template: Result Statuses ──────────────────────────────────────────

  server.registerResource(
    "project_result_statuses",
    new ResourceTemplate("zebrunner://projects/{project_key}/result-statuses", {
      list: projectListCallback("result-statuses", "Result Statuses"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Configured test run result statuses (e.g., Passed, Failed, Skipped, In Progress) for a project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_result_statuses", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `result-statuses:${pk}`;
      let statuses = cache.get<any>(cacheKey);

      if (!statuses) {
        debugLog("Fetching result statuses", { project_key: pk });
        statuses = await client.listResultStatuses({ projectKey: pk });
        cache.set(cacheKey, statuses);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(statuses, null, 2),
        }],
      };
    },
  );

  // ── 2.3 Template: Configuration Groups ─────────────────────────────────────

  server.registerResource(
    "project_configuration_groups",
    new ResourceTemplate("zebrunner://projects/{project_key}/configuration-groups", {
      list: projectListCallback("configuration-groups", "Configuration Groups"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Test run configuration groups and options (e.g., Browser, OS, Device) for a project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_configuration_groups", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `config-groups:${pk}`;
      let groups = cache.get<any>(cacheKey);

      if (!groups) {
        debugLog("Fetching configuration groups", { project_key: pk });
        groups = await client.listConfigurationGroups({ projectKey: pk });
        cache.set(cacheKey, groups);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(groups, null, 2),
        }],
      };
    },
  );

  // ── 2.4 Template: Fields Layout ────────────────────────────────────────────

  server.registerResource(
    "project_fields_layout",
    new ResourceTemplate("zebrunner://projects/{project_key}/fields", {
      list: projectListCallback("fields", "Fields Layout"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "System and custom field definitions (types, tabs, names) for test cases in a project",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_fields_layout", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `fields-layout:${pk}`;
      let layout = cache.get<any>(cacheKey);

      if (!layout) {
        debugLog("Fetching fields layout", { project_key: pk });
        const { projectId } = await resolveProjectId(pk);
        layout = await reportingClient.getFieldsLayout(projectId);
        cache.set(cacheKey, layout);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(layout, null, 2),
        }],
      };
    },
  );

  // ── 2.5 Template: Suite Hierarchy ──────────────────────────────────────────

  server.registerResource(
    "project_suite_hierarchy",
    new ResourceTemplate("zebrunner://projects/{project_key}/suite-hierarchy", {
      list: projectListCallback("suite-hierarchy", "Suite Hierarchy"),
      complete: { project_key: projectKeyComplete() },
    }),
    {
      description: "Full test suite hierarchy tree for a Zebrunner project (all suites with parent-child relationships)",
    },
    async (uri, { project_key }) => {
      resourceTrace("project_suite_hierarchy", uri, { project_key: String(project_key) });
      const pk = String(project_key);
      const cacheKey = `suite-hierarchy:${pk}`;
      let hierarchy = cache.get<any[]>(cacheKey);

      if (!hierarchy) {
        debugLog("Fetching suite hierarchy", { project_key: pk });
        const allSuites = await client.getAllTestSuites(pk);
        hierarchy = allSuites.map((s: any) => ({
          id: s.id,
          name: s.name,
          parentId: s.parentId || null,
          description: s.description || null,
        }));
        cache.set(cacheKey, hierarchy);
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(hierarchy, null, 2),
        }],
      };
    },
  );

  debugLog("Registered 13 MCP resources (5 static + 8 templates)");
}

/**
 * Exported for external cache management (e.g., tests, manual refresh).
 * Call registerResources() to get a fresh cache instance.
 */
export { MAX_CACHE_ENTRIES };

// ── Resource catalog (used by about_mcp_tools) ──────────────────────────────

export type ResourceMeta = {
  name: string;
  uri: string;
  description: string;
  type: "static" | "template";
};

export function getResourcesCatalog(): ResourceMeta[] {
  return [
    { name: "available_projects", uri: "zebrunner://projects", description: "All projects accessible to the current user with keys, IDs, and metadata", type: "static" },
    { name: "report_types", uri: "zebrunner://reports/types", description: "Available report types for generate_report with descriptions, parameters, and examples", type: "static" },
    { name: "time_periods", uri: "zebrunner://periods", description: "Valid time period values accepted by reporting and widget tools", type: "static" },
    { name: "chart_options", uri: "zebrunner://charts", description: "Chart delivery formats (png, html, text) and chart types (pie, bar, line, etc.)", type: "static" },
    { name: "output_formats", uri: "zebrunner://formats", description: "Output format parameter families used across tools", type: "static" },
    { name: "project_root_suites", uri: "zebrunner://projects/{project_key}/suites", description: "Root test suites for a project", type: "template" },
    { name: "project_automation_states", uri: "zebrunner://projects/{project_key}/automation-states", description: "Automation states for a project", type: "template" },
    { name: "project_priorities", uri: "zebrunner://projects/{project_key}/priorities", description: "Automation priorities for a project", type: "template" },
    { name: "project_milestones", uri: "zebrunner://projects/{project_key}/milestones", description: "Active milestones for a project", type: "template" },
    { name: "project_result_statuses", uri: "zebrunner://projects/{project_key}/result-statuses", description: "Test result statuses for a project", type: "template" },
    { name: "project_configuration_groups", uri: "zebrunner://projects/{project_key}/configuration-groups", description: "Configuration groups (browsers, devices, etc.) for a project", type: "template" },
    { name: "project_fields_layout", uri: "zebrunner://projects/{project_key}/fields", description: "Custom fields layout for a project", type: "template" },
    { name: "project_suite_hierarchy", uri: "zebrunner://projects/{project_key}/suite-hierarchy", description: "Full suite hierarchy tree for a project", type: "template" },
  ];
}
