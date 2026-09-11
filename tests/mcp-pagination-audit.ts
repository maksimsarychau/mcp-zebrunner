#!/usr/bin/env tsx
/**
 * Read-only MCP pagination audit — compares tool outputs vs expected completeness.
 * Requires: npm run build && npm run sign-release, .env credentials, live Zebrunner.
 *
 * Usage:
 *   npx tsx tests/mcp-pagination-audit.ts
 *   ZEBRUNNER_AUDIT_PROJECTS=MCP npx tsx tests/mcp-pagination-audit.ts
 *   ZEBRUNNER_PAGINATION_SUITE_ID=<suiteId> npx tsx tests/mcp-pagination-audit.ts
 *   ZEBRUNNER_AUDIT_TC_KEY=<caseKey> npx tsx tests/mcp-pagination-audit.ts
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import {
  callMCPTool,
  startMCPServer,
  stopMCPServer,
} from "./eval/eval-mcp-client.js";

type AuditRow = {
  project: string;
  scenario: string;
  tool: string;
  args: Record<string, unknown>;
  count?: number;
  responseChars?: number;
  wasTruncated?: boolean;
  notes?: string;
  error?: string;
};

function parseJsonBlock(text: string): unknown {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  const arrStart = trimmed.indexOf("[");
  const start =
    jsonStart >= 0 && (arrStart < 0 || jsonStart < arrStart) ? jsonStart : arrStart;
  if (start < 0) return null;
  try {
    return JSON.parse(trimmed.slice(start));
  } catch {
    return null;
  }
}

function countRows(text: string, keys: string[] = ["test_cases", "items"]): number | undefined {
  const data = parseJsonBlock(text);
  if (!data || typeof data !== "object") {
    const m = text.match(/Found (\d+) test case/i);
    if (m) return Number(m[1]);
    return undefined;
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.total_count === "number") return obj.total_count;
  if (typeof obj.count === "number") return obj.count;
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val)) return val.length;
  }
  if (obj.metadata && typeof obj.metadata === "object") {
    const results = (obj.metadata as Record<string, unknown>).results as Record<string, unknown> | undefined;
    if (results && typeof results.count === "number") return results.count;
  }
  return undefined;
}

function wasTruncated(text: string): boolean {
  if (/was_truncated|truncated to stay under MCP/i.test(text)) return true;
  const data = parseJsonBlock(text);
  if (data && typeof data === "object" && (data as Record<string, unknown>).was_truncated === true) {
    return true;
  }
  return false;
}

async function auditTool(
  rows: AuditRow[],
  project: string,
  scenario: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<number | undefined> {
  const fullArgs = { project_key: project, format: "json", ...args };
  try {
    const text = await callMCPTool(tool, fullArgs);
    const count = countRows(text);
    rows.push({
      project,
      scenario,
      tool,
      args: fullArgs,
      count,
      responseChars: text.length,
      wasTruncated: wasTruncated(text),
    });
    return count;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    rows.push({ project, scenario, tool, args: fullArgs, error: message });
    return undefined;
  }
}

function historyCount(text: string): number | undefined {
  const data = parseJsonBlock(text);
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  const tc = obj.test_case ?? obj.testCase;
  if (tc && typeof tc === "object") {
    const history = (tc as Record<string, unknown>).history;
    if (Array.isArray(history)) return history.length;
  }
  const history = obj.history;
  if (Array.isArray(history)) return history.length;
  return undefined;
}

async function auditProject(project: string, suiteId?: number): Promise<AuditRow[]> {
  const rows: AuditRow[] = [];
  const suite =
    suiteId ??
    (Number(process.env.ZEBRUNNER_PAGINATION_SUITE_ID ?? 0) || undefined);

  if (suite) {
    const countOnly = await auditTool(rows, project, "suite_smart_count_only", "adv_get_test_cases_by_suite_smart", {
      suite_id: suite,
      count_only: true,
      get_all: true,
    });
    const getAll = await auditTool(rows, project, "suite_smart_get_all", "adv_get_test_cases_by_suite_smart", {
      suite_id: suite,
      get_all: true,
      detail: "summary",
    });
    const page0 = await auditTool(rows, project, "suite_smart_page0", "adv_get_test_cases_by_suite_smart", {
      suite_id: suite,
      get_all: false,
      page: 0,
      size: 5,
      detail: "summary",
    });
    const page1 = await auditTool(rows, project, "suite_smart_page1", "adv_get_test_cases_by_suite_smart", {
      suite_id: suite,
      get_all: false,
      page: 1,
      size: 5,
      detail: "summary",
    });
    if (countOnly !== undefined && getAll !== undefined && countOnly !== getAll) {
      rows.push({
        project,
        scenario: "suite_smart_gap",
        tool: "adv_get_test_cases_by_suite_smart",
        args: { suite_id: suite },
        notes: `count_only=${countOnly} get_all=${getAll}`,
      });
    }
    if (page0 === page1 && page0 !== undefined) {
      rows.push({
        project,
        scenario: "suite_smart_page_duplicate",
        tool: "adv_get_test_cases_by_suite_smart",
        args: { suite_id: suite },
        notes: `page0 and page1 both returned count=${page0} (numeric page likely ignored)`,
      });
    }
  }

  const tcmCount = await auditTool(rows, project, "all_tcm_count_only", "adv_get_all_tcm_test_cases_by_project", {
    count_only: true,
    exclude_deprecated: true,
  });
  const tcmAll = await auditTool(rows, project, "all_tcm_get_all", "adv_get_all_tcm_test_cases_by_project", {
    exclude_deprecated: true,
    detail: "summary",
    max_results: 10000,
  });
  if (tcmCount !== undefined && tcmAll !== undefined && tcmCount !== tcmAll) {
    rows.push({
      project,
      scenario: "all_tcm_gap",
      tool: "adv_get_all_tcm_test_cases_by_project",
      args: { exclude_deprecated: true },
      notes: `count_only=${tcmCount} rows=${tcmAll}`,
    });
  }

  if (suite) {
    const advRoot = await auditTool(rows, project, "advanced_root_suite", "adv_get_test_cases_advanced", {
      root_suite_id: suite,
      count_only: true,
    });
    if (advRoot !== undefined && tcmCount !== undefined) {
      rows.push({
        project,
        scenario: "advanced_root_vs_project",
        tool: "adv_get_test_cases_advanced",
        args: { root_suite_id: suite },
        notes: `advanced root count=${advRoot} project deprecated-excluded=${tcmCount}`,
      });
    }
  }

  await auditTool(rows, project, "distribution_manual_name", "adv_get_test_case_distribution_by_field", {
    project,
    field: "Manual Only",
  });
  await auditTool(rows, project, "distribution_manual_system", "adv_get_test_case_distribution_by_field", {
    project,
    system_field: "MANUAL_ONLY",
  });

  const autoCount = await auditTool(rows, project, "automation_na_tba_count", "adv_get_test_cases_by_automation_state", {
    automation_states: ["Not Automated", "To Be Automated"],
    count_only: true,
    get_all: true,
    exclude_deprecated: true,
  });
  const autoGetAll = await auditTool(rows, project, "automation_na_tba_get_all", "adv_get_test_cases_by_automation_state", {
    automation_states: ["Not Automated", "To Be Automated"],
    get_all: true,
    exclude_deprecated: true,
    detail: "summary",
    max_results: 5000,
  });
  if (autoCount !== undefined && autoGetAll !== undefined && autoCount !== autoGetAll) {
    rows.push({
      project,
      scenario: "automation_na_tba_gap",
      tool: "adv_get_test_cases_by_automation_state",
      args: { automation_states: ["Not Automated", "To Be Automated"] },
      notes: `count_only=${autoCount} get_all=${autoGetAll}`,
    });
  }

  const auditTcKey = process.env.ZEBRUNNER_AUDIT_TC_KEY?.trim();
  if (auditTcKey) {
    const byKeyText = await (async () => {
      try {
        return await callMCPTool("adv_get_test_case_by_key", {
          project_key: project,
          case_key: auditTcKey,
          format: "json",
          detail: "full",
          include_history: true,
          history_filter: "all",
          history_limit: 20,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        rows.push({
          project,
          scenario: "by_key_history",
          tool: "adv_get_test_case_by_key",
          args: { case_key: auditTcKey, include_history: true },
          error: message,
        });
        return "";
      }
    })();
    if (byKeyText) {
      const histLen = historyCount(byKeyText);
      rows.push({
        project,
        scenario: "by_key_history",
        tool: "adv_get_test_case_by_key",
        args: { case_key: auditTcKey, include_history: true, history_filter: "all" },
        count: histLen,
        responseChars: byKeyText.length,
        notes: histLen === 0 ? "H8: empty history with include_history=all" : undefined,
      });
      if (histLen === 0) {
        rows.push({
          project,
          scenario: "h8_empty_history",
          tool: "adv_get_test_case_by_key",
          args: { case_key: auditTcKey },
          notes: "include_history=true returned history:[] — verify /changes API has data (R19)",
        });
      }
    }

    await auditTool(rows, project, "by_key_fields_projection", "adv_get_test_case_by_key", {
      case_key: auditTcKey,
      detail: "summary",
      fields: ["key", "title", "automationState"],
      include_history: true,
      history_filter: "all",
      history_limit: 5,
    });
  }

  await auditTool(rows, project, "find_field_history_probe", "adv_find_field_history_changes", {
    field: "automationState",
    max_results: 1,
  });

  return rows;
}

async function main(): Promise<void> {
  const projects = (process.env.ZEBRUNNER_AUDIT_PROJECTS ?? process.env.ZEBRUNNER_VERIFY_PROJECTS ?? "MCP")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  console.error(`[mcp-pagination-audit] projects: ${projects.join(", ")}`);
  await startMCPServer();

  const allRows: AuditRow[] = [];
  try {
    for (const project of projects) {
      console.error(`[mcp-pagination-audit] auditing ${project}...`);
      allRows.push(...(await auditProject(project)));
    }
  } finally {
    stopMCPServer();
  }

  const outDir = join(process.cwd(), "docs", "investigation");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = join(outDir, `mcp-pagination-audit-${stamp}.json`);
  writeFileSync(outPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), rows: allRows }, null, 2)}\n`);
  console.error(`[mcp-pagination-audit] wrote ${outPath} (${allRows.length} rows)`);

  const gaps = allRows.filter(
    (r) =>
      r.scenario.endsWith("_gap") ||
      r.scenario.endsWith("_duplicate") ||
      r.scenario === "h8_empty_history" ||
      r.error,
  );
  if (gaps.length > 0) {
    console.error(`[mcp-pagination-audit] ${gaps.length} finding(s) — see ${outPath}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
