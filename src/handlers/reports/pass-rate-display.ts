/**
 * Shared formatting for PassRateData in reports and dashboards.
 */

import type { PassRateData } from "./types.js";

export function hasPassRateMetrics(d: PassRateData): boolean {
  return !d.noMilestoneLaunches;
}

export function noMilestoneLaunchesMessage(milestone: string): string {
  return (
    `No launches are assigned to milestone "${milestone}". ` +
    `Pass rate is not shown (not 0%). Link launches to this milestone in Zebrunner, ` +
    `or use launch-level tools for suite rollup.`
  );
}

/** Markdown table row for the standard pass-rate columns. */
export function formatPassRateTableRow(d: PassRateData, target: number): string {
  if (d.noMilestoneLaunches) {
    return (
      `| ${d.project} | — | — | — | — | — | — | — | ${target}% | ` +
      `⚠️ No launches assigned to milestone |`
    );
  }
  const icon = d.passRate >= target ? "✅" : "⚠️";
  return (
    `| ${d.project} | ${d.total} | ${d.passed} | ${d.failed} | ${d.knownIssue} | ${d.skipped} | ` +
    `${d.passRate}% | ${d.passRateExclKnown}% | ${target}% | ${icon} |`
  );
}

/** Compact executive-style row. */
export function formatPassRateExecutiveRow(d: PassRateData, target: number): string {
  if (d.noMilestoneLaunches) {
    return `| ${d.project} | — | — | ${target}% | ⚠️ No launches on milestone |`;
  }
  const icon = d.passRate >= target ? "✅" : "⚠️";
  return `| ${d.project} | ${d.passRate}% | ${d.passRateExclKnown}% | ${target}% | ${icon} |`;
}

/** Chart / dashboard summary line. */
export function formatPassRateSummaryLine(d: PassRateData, target: number): string {
  if (d.noMilestoneLaunches) {
    return `${d.project}: no launches assigned to milestone ⚠️`;
  }
  const icon = d.passRate >= target ? "✅" : "⚠️";
  return (
    `${d.project}: ${d.passRate}% ${icon} (target: ${target}%) | excl. known: ${d.passRateExclKnown}%`
  );
}
