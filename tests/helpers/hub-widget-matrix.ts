/**
 * Single source of truth: MCP hub tools / pass-rate views ↔ API smoke IDs ↔ templates.
 * Used by unit tests to prove eval + api-verify coverage stays complete.
 */

import {
  EXECUTION_ANALYTICS_MODES,
  FAILURE_ANALYTICS_MODES,
  TCM_CASE_ANALYTICS_MODES,
} from "../../src/handlers/widget-hub-tools.js";
import { PASS_RATE_VIEWS, VIEW_TO_TEMPLATE_ID } from "../../src/utils/widget-pass-rate-views.js";

export interface HubModeRow {
  mcpTool: string;
  mode: string;
  templateId: number;
  apiTestId: string;
}

export interface PassRateViewRow {
  view: string;
  templateId: number;
  apiTestId: string;
}

export const HUB_TCM_MODES: HubModeRow[] = [
  { mcpTool: "adv_get_tcm_case_analytics", mode: "net_change", templateId: 37777, apiTestId: "TCM-NET" },
  { mcpTool: "adv_get_tcm_case_analytics", mode: "created_by_user", templateId: 37779, apiTestId: "TCM-CREATED" },
  { mcpTool: "adv_get_tcm_case_analytics", mode: "updated_by_user", templateId: 37778, apiTestId: "TCM-UPDATED" },
];

export const HUB_FAILURE_MODES: HubModeRow[] = [
  { mcpTool: "adv_get_failure_analytics", mode: "tag_distribution", templateId: 40112, apiTestId: "W-TPL40112" },
  { mcpTool: "adv_get_failure_analytics", mode: "tags_by_maintainer", templateId: 55991, apiTestId: "W-TPL55991" },
  { mcpTool: "adv_get_failure_analytics", mode: "jira_by_maintainer", templateId: 57086, apiTestId: "W-TPL57086" },
];

export const HUB_EXECUTION_MODES: HubModeRow[] = [
  { mcpTool: "adv_get_execution_analytics", mode: "roi", templateId: 1, apiTestId: "W-TPL1-ROI" },
  { mcpTool: "adv_get_execution_analytics", mode: "duration_trend", templateId: 131, apiTestId: "W-TPL131" },
  { mcpTool: "adv_get_execution_analytics", mode: "launch_duration", templateId: 57085, apiTestId: "W-TPL57085" },
  { mcpTool: "adv_get_execution_analytics", mode: "stability_table", templateId: 16, apiTestId: "W-TPL16" },
];

export const PASS_RATE_VIEW_ROWS: PassRateViewRow[] = PASS_RATE_VIEWS.map(view => ({
  view,
  templateId: VIEW_TO_TEMPLATE_ID[view],
  apiTestId:
    view === "pie"
      ? "W-VIEW-8-DEFAULT"
      : view === "line"
        ? "W-TPL5"
        : view === "bar"
          ? "W-TPL3"
          : view === "calendar"
            ? "W-TPL90"
            : view === "pie_line"
              ? "W-TPL17"
              : "W-TPL14",
}));

/** Distribution tool (v9.2.3) — separate from hubs. */
export const DISTRIBUTION_ROW = {
  mcpTool: "adv_get_test_case_distribution_by_field",
  templateId: 37780,
  apiTestIds: ["TCM-DIST-AUTO", "TCM-DIST-MANUAL"],
};

/** Authoring trend (v9.2.5) — standalone TAM template 7. */
export const AUTHORING_TREND_ROW = {
  mcpTool: "adv_get_test_authoring_trend",
  templateId: 7,
  apiTestIds: ["W-TPL7", "W-TPL7-WEEK", "W-TPL7-MONTH", "W-TPL7-ABS"],
};

/** Widget period-mode API smokes (preset + ABSOLUTE + DYNAMIC tiers). */
export const PERIOD_MODE_API_SMOKES = [
  "W-ABS",
  "W-DYN",
  "W-DYN-QUARTER",
  "W-DYN-WEEK",
  "W-DYN-LONG",
  "W-PRESET",
  "W-TPL3-OWNER-TODAY",
  "W-TPL7-ABS",
  "W-TPL40112-ABS",
] as const;

/** All 22 widget templates → MCP tool (22/22 coverage). */
export const WIDGET_TEMPLATE_TO_MCP: Record<string, string> = {
  "37780": DISTRIBUTION_ROW.mcpTool,
  "37777": "adv_get_tcm_case_analytics",
  "37778": "adv_get_tcm_case_analytics",
  "37779": "adv_get_tcm_case_analytics",
  "4": "adv_get_top_bugs",
  "9": "adv_get_bug_review",
  "6": "adv_get_bug_failure_info",
  "10": "adv_get_bug_failure_info",
  "8": "adv_get_platform_results_by_period",
  "3": "adv_get_platform_results_by_period",
  "5": "adv_get_platform_results_by_period",
  "17": "adv_get_platform_results_by_period",
  "90": "adv_get_platform_results_by_period",
  "14": "adv_get_platform_results_by_period",
  "7": AUTHORING_TREND_ROW.mcpTool,
  "40112": "adv_get_failure_analytics",
  "55991": "adv_get_failure_analytics",
  "57086": "adv_get_failure_analytics",
  "57085": "adv_get_execution_analytics",
  "131": "adv_get_execution_analytics",
  "1": "adv_get_execution_analytics",
  "16": "adv_get_execution_analytics",
};

export function allWidgetTemplateIds(): string[] {
  return Object.keys(WIDGET_TEMPLATE_TO_MCP).sort();
}

export function allHubModes(): HubModeRow[] {
  return [...HUB_TCM_MODES, ...HUB_FAILURE_MODES, ...HUB_EXECUTION_MODES];
}

export function assertHubExportsMatchMatrix(): void {
  const tcm = [...TCM_CASE_ANALYTICS_MODES].sort();
  const fail = [...FAILURE_ANALYTICS_MODES].sort();
  const exec = [...EXECUTION_ANALYTICS_MODES].sort();
  const matrixTcm = HUB_TCM_MODES.map(r => r.mode).sort();
  const matrixFail = HUB_FAILURE_MODES.map(r => r.mode).sort();
  const matrixExec = HUB_EXECUTION_MODES.map(r => r.mode).sort();
  if (JSON.stringify(tcm) !== JSON.stringify(matrixTcm)) {
    throw new Error(`TCM modes mismatch: exports=${tcm.join()} matrix=${matrixTcm.join()}`);
  }
  if (JSON.stringify(fail) !== JSON.stringify(matrixFail)) {
    throw new Error(`Failure modes mismatch`);
  }
  if (JSON.stringify(exec) !== JSON.stringify(matrixExec)) {
    throw new Error(`Execution modes mismatch`);
  }
}
