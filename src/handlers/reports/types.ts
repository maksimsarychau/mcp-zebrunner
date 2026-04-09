/**
 * Shared types, interfaces, and constants for all report modules.
 */

import type { ZebrunnerReportingClient } from "../../api/reporting-client.js";
import type { EnhancedZebrunnerClient } from "../../api/enhanced-client.js";
import type { ZebrunnerReportingToolHandlers } from "../reporting-tools.js";
import type { WidgetSqlCaller } from "../../utils/widget-sql.js";

// ── Data Types ──────────────────────────────────────────────────────────────

export interface ProjectContext {
  alias: string;
  projectKey: string;
  projectId: number;
}

export interface PassRateTargets {
  [projectAlias: string]: number;
}

export interface PassRateData {
  project: string;
  passed: number;
  failed: number;
  skipped: number;
  knownIssue: number;
  aborted: number;
  total: number;
  passRate: number;
  passRateExclKnown: number;
}

export interface RuntimeData {
  project: string;
  short: number;
  medium: number;
  long: number;
  totalTests: number;
  totalTestCases: number;
  totalElapsedSec: number;
  avgRuntimePerTest: number;
  avgRuntimePerTestCase: number;
  wri: number;
  shortPercent: number;
  mediumPercent: number;
  longPercent: number;
}

export interface CoverageData {
  project: string;
  automated: number;
  manual: number;
  notAutomated: number;
  total: number;
}

export interface BugEntry {
  key: string;
  failures: number;
  total: number;
  percentage: number;
}

export interface BugsData {
  project: string;
  bugs: BugEntry[];
}

export interface MilestoneEntry {
  name: string;
  completed: boolean;
  dueDate: string | null;
  startDate: string | null;
  overdue: boolean;
}

export interface MilestoneData {
  project: string;
  milestones: MilestoneEntry[];
}

export interface FlakyEntry {
  testName: string;
  flipCount: number;
  passRate: number;
  stability: number;
}

export interface FlakyData {
  project: string;
  flaky: FlakyEntry[];
  total: number;
}

// ── Report I/O ──────────────────────────────────────────────────────────────

export interface ReportInput {
  report_types: string[];
  projects: string[];
  period: string;
  milestone?: string;
  top_bugs_limit?: number;
  sections?: string[];
  targets?: PassRateTargets;
  exclude_suite_patterns?: string[];
  previous_milestone?: string;
}

export interface ReportOutput {
  [key: string]: unknown;
  content: any[];
}

// ── Constants ───────────────────────────────────────────────────────────────

export const ALL_DASHBOARD_SECTIONS = ['pass_rate', 'runtime', 'coverage', 'bugs', 'milestones', 'flaky'];

export const DEFAULT_TARGETS: PassRateTargets = {
  android: 90,
  ios: 90,
  web: 65,
};

export const COLORS = {
  passed: '#59a14f',
  failed: '#e15759',
  skipped: '#f28e2b',
  knownIssue: '#edc948',
  aborted: '#bab0ac',
  automated: '#4e79a7',
  manual: '#f28e2b',
  notAutomated: '#e15759',
  short: '#59a14f',
  medium: '#f28e2b',
  long: '#e15759',
};

export const PERIOD_DAYS_MAP: Record<string, number> = {
  "today": 1, "last 24 hours": 1, "week": 7, "last 7 days": 7,
  "last 14 days": 14, "month": 30, "last 30 days": 30,
  "quarter": 90, "last 90 days": 90, "year": 365, "last 365 days": 365,
  "total": 3650,
};

// ── Report Context ──────────────────────────────────────────────────────────

export interface ReportContext {
  reportingClient: ZebrunnerReportingClient;
  publicClient: EnhancedZebrunnerClient;
  reportingHandlers: ZebrunnerReportingToolHandlers;
  callWidgetSql: WidgetSqlCaller;
  resolveProjects(projects: string[]): Promise<ProjectContext[]>;
  fetchPassRate(ctx: ProjectContext, period: string, milestone?: string): Promise<PassRateData>;
  fetchRuntime(ctx: ProjectContext, milestone?: string): Promise<RuntimeData>;
  fetchCoverage(ctx: ProjectContext): Promise<CoverageData>;
  fetchBugs(ctx: ProjectContext, period: string, limit: number, milestone?: string): Promise<BugsData>;
  fetchMilestones(ctx: ProjectContext, periodDays: number): Promise<MilestoneData>;
  fetchFlaky(ctx: ProjectContext, periodDays: number, milestone?: string): Promise<FlakyData>;
  fmtSeconds(sec: number): string;
  periodToDays(period: string): number;
}
