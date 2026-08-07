import type { LaunchListItem, LaunchResponse, TestRunResponse } from "../types/reporting.js";

export type DetailedStatusSource = "launch" | "testRuns" | "tcm" | "widget";
export type ManualKnownIssueScope = "allLaunchTests" | "filteredTests";

export interface DetailedStatusCounts {
  source: DetailedStatusSource;
  passed?: number;
  passedManually?: number;
  failed?: number;
  failedAsKnown?: number;
  skipped?: number;
  blocked?: number;
  inProgress?: number;
  aborted?: number;
  /** Source-specific widget/TCM bucket; never inferred from launch failedAsKnown. */
  knownIssue?: number;
  manualAndKnownIssue?: {
    passedManually: number;
    knownIssue: number;
    bothConditions: number;
    eitherCondition: number;
    totalConsidered: number;
    scope: ManualKnownIssueScope;
  };
  unavailable?: string[];
}

type LaunchStatusInput = Partial<Pick<
  LaunchResponse & LaunchListItem,
  "passed" | "passedManually" | "failed" | "failedAsKnown" | "skipped" | "blocked" | "inProgress" | "aborted"
>>;

const launchBucketNames = [
  "passed",
  "passedManually",
  "failed",
  "failedAsKnown",
  "skipped",
  "blocked",
  "inProgress",
  "aborted",
] as const;

function suppliedCounts<T extends Record<string, number | undefined>>(
  input: T,
  names: ReadonlyArray<keyof T>
): { counts: Partial<T>; unavailable: string[] } {
  const counts: Partial<T> = {};
  const unavailable: string[] = [];
  for (const name of names) {
    const count = input[name];
    if (count === undefined) unavailable.push(String(name));
    else counts[name] = count;
  }
  return { counts, unavailable };
}

export function getLaunchDetailedStatusCounts(
  launch: LaunchStatusInput,
  _context?: string
): DetailedStatusCounts {
  const { counts, unavailable } = suppliedCounts(launch, launchBucketNames);
  return {
    source: "launch",
    ...counts,
    ...(unavailable.length > 0 ? { unavailable } : {}),
  };
}

export function getTestRunDetailedStatusCounts(
  tests: ReadonlyArray<Pick<TestRunResponse, "passedManually" | "knownIssue">>,
  scope: ManualKnownIssueScope = "allLaunchTests"
): DetailedStatusCounts {
  let passedManually = 0;
  let knownIssue = 0;
  let bothConditions = 0;

  for (const test of tests) {
    const manual = test.passedManually === true;
    const known = test.knownIssue === true;
    if (manual) passedManually++;
    if (known) knownIssue++;
    if (manual && known) bothConditions++;
  }

  return {
    source: "testRuns",
    manualAndKnownIssue: {
      passedManually,
      knownIssue,
      bothConditions,
      eitherCondition: passedManually + knownIssue - bothConditions,
      totalConsidered: tests.length,
      scope,
    },
  };
}

export function getTcmDetailedStatusCounts(
  statusCounts: Readonly<Record<string, number>>,
  _context?: string
): DetailedStatusCounts {
  const normalized = new Map(
    Object.entries(statusCounts).map(([name, count]) => [
      name.toUpperCase().replace(/[\s-]+/g, "_"),
      count,
    ])
  );
  const result: DetailedStatusCounts = { source: "tcm" };
  const mappings: Array<[keyof DetailedStatusCounts, string[]]> = [
    ["passed", ["PASSED"]],
    ["failed", ["FAILED"]],
    ["skipped", ["SKIPPED"]],
    ["blocked", ["BLOCKED"]],
    ["inProgress", ["IN_PROGRESS", "INPROGRESS"]],
    ["aborted", ["ABORTED"]],
    ["knownIssue", ["KNOWN_ISSUE", "KNOWNISSUE"]],
  ];
  for (const [field, names] of mappings) {
    const name = names.find((candidate) => normalized.has(candidate));
    if (name) {
      (result as unknown as Record<string, unknown>)[field] = normalized.get(name);
    }
  }
  const unavailable = ["passedManually", "failedAsKnown"];
  for (const [field] of mappings) {
    if (result[field] === undefined) unavailable.push(String(field));
  }
  return {
    ...result,
    unavailable,
  };
}

export function getWidgetDetailedStatusCounts(
  counts: Partial<Record<"passed" | "failed" | "skipped" | "knownIssue" | "aborted", number>>,
  _context?: string
): DetailedStatusCounts {
  const names = ["passed", "failed", "skipped", "knownIssue", "aborted"] as const;
  const { counts: availableCounts, unavailable } = suppliedCounts(counts, names);
  return {
    source: "widget",
    ...availableCounts,
    unavailable: [
      "passedManually",
      "failedAsKnown",
      "blocked",
      "inProgress",
      ...unavailable,
    ],
  };
}
