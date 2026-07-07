/**
 * On-disk writer for large report artifacts (HTML dashboards, PNG charts).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface WrittenArtifacts {
  dir: string;
  htmlPath: string;
  chartPaths: string[];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function resolveReportDir(outputDir?: string): string {
  const dir = outputDir && outputDir.trim().length > 0 ? outputDir : join(tmpdir(), "zebrunner-reports");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeReportArtifacts(
  reportName: string,
  htmlDashboard: string,
  chartPngs: Buffer[],
  stamp: string,
  outputDir?: string,
): WrittenArtifacts {
  const dir = resolveReportDir(outputDir);
  const base = `${slugify(reportName)}-${slugify(stamp)}`;
  const htmlPath = join(dir, `${base}.html`);
  writeFileSync(htmlPath, htmlDashboard, "utf-8");

  const chartPaths: string[] = [];
  chartPngs.forEach((png, i) => {
    const p = join(dir, `${base}-chart-${i + 1}.png`);
    writeFileSync(p, png);
    chartPaths.push(p);
  });

  return { dir, htmlPath, chartPaths };
}
