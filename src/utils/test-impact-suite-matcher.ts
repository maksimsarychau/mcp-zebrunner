import type { ZebrunnerTestSuite } from "../types/core.js";
import { HierarchyProcessor } from "./hierarchy.js";

export interface MatchedSuite {
  id: number;
  name: string;
  matchReason: string;
  rootSuiteId: number;
  descendantSuiteIds: number[];
}

const MAX_ROOT_MATCHES = 3;

function suiteLabel(suite: ZebrunnerTestSuite): string {
  return (suite.title || suite.name || `Suite ${suite.id}`).trim();
}

/** Case-insensitive partial match on suite path/name; empty query → top roots by order. */
export function searchSuitesByName(
  suites: ZebrunnerTestSuite[],
  query: string,
  limit = 10,
): ZebrunnerTestSuite[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? suites.filter((s) => suiteLabel(s).toLowerCase().includes(q))
    : suites;
  return filtered.slice(0, limit);
}

export function matchRootSuites(
  allSuites: ZebrunnerTestSuite[],
  features: string[],
  keywords: string[],
  searchPhrases: string[],
): MatchedSuite[] {
  const enriched = HierarchyProcessor.setRootParentsToSuites(allSuites);
  const roots = HierarchyProcessor.getRootSuites(enriched);
  const queries = dedupeQueries([...features, ...keywords, ...searchPhrases.slice(0, 5)]);

  const matches: Array<{ suite: ZebrunnerTestSuite; reason: string; score: number }> = [];

  for (const root of roots) {
    const label = suiteLabel(root).toLowerCase();
    for (const q of queries) {
      const nq = q.toLowerCase();
      if (label.includes(nq) || nq.includes(label.replace(/^\d+\.\s*/, ""))) {
        matches.push({
          suite: root,
          reason: `feature/keyword '${q}' matched root suite '${suiteLabel(root)}'`,
          score: nq.length + (label.includes(nq) ? 10 : 5),
        });
      }
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const seen = new Set<number>();
  const out: MatchedSuite[] = [];

  for (const m of matches) {
    if (seen.has(m.suite.id)) continue;
    seen.add(m.suite.id);
    const rootId = m.suite.id;
    const descendants = HierarchyProcessor.getSuiteDescendants(rootId, enriched).map((s) => s.id);
    out.push({
      id: rootId,
      name: suiteLabel(m.suite),
      matchReason: m.reason,
      rootSuiteId: rootId,
      descendantSuiteIds: [rootId, ...descendants],
    });
    if (out.length >= MAX_ROOT_MATCHES) break;
  }

  return out;
}

function dedupeQueries(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const n = item.trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function caseInMatchedSuites(
  suiteId: number | undefined,
  rootSuiteId: number | undefined,
  matched: MatchedSuite[],
): boolean {
  if (matched.length === 0) return false;
  const id = suiteId ?? rootSuiteId;
  if (id == null) return false;
  for (const m of matched) {
    if (m.descendantSuiteIds.includes(id)) return true;
  }
  return false;
}
