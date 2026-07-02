/**
 * Shared on-disk writer for report artifacts.
 *
 * `generate_report` used to inline the whole self-contained HTML dashboard plus up to 4 base64
 * PNG charts (plus repeated CSS/JS scaffold) into the tool response — hundreds of KB of tokens on
 * every call. When inline=false (the new default) we write those blobs to disk and return their
 * paths, so the response carries only the markdown summary + file references.
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

/** Resolve the output directory (caller override → <tmp>/zebrunner-reports) and ensure it exists. */
export function resolveReportDir(outputDir?: string): string {
  const dir = outputDir && outputDir.trim().length > 0 ? outputDir : join(tmpdir(), "zebrunner-reports");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Write the HTML dashboard and PNG chart buffers to disk. `stamp` should be a caller-supplied,
 * collision-resistant token (e.g. the report's generatedAt) so concurrent reports don't clobber.
 */
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
