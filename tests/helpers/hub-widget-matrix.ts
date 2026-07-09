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
