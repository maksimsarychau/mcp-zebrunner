import type { LaunchListItem, LaunchResponse, TestRunResponse } from "../types/reporting.js";

export type DetailedStatusSource = "launch" | "testRuns" | "tcm" | "widget";
export type DetailedStatusValue = number | "unavailable";

export interface DetailedStatusCounts {
  source: DetailedStatusSource;
  scope: string;
  passedManually: DetailedStatusValue;
  knownIssue: DetailedStatusValue;
  bothConditions: DetailedStatusValue;
  eitherCondition: DetailedStatusValue;
  totalConsidered: number;
  unavailable: string[];
}

export interface LaunchStatusBuckets {
  passed: DetailedStatusValue;
  passedManually: DetailedStatusValue;
  failed: DetailedStatusValue;
  failedAsKnown: DetailedStatusValue;
  skipped: DetailedStatusValue;
  blocked: DetailedStatusValue;
  inProgress: DetailedStatusValue;
  aborted: DetailedStatusValue;
}

export interface LaunchDetailedStatusCounts extends DetailedStatusCounts {
  source: "launch";
  buckets: LaunchStatusBuckets;
}

type LaunchStatusInput = Partial<Pick<
  LaunchResponse & LaunchListItem,
  "passed" | "passedManually" | "failed" | "failedAsKnown" | "skipped" | "blocked" | "inProgress" | "aborted"
>>;

const unavailable = "unavailable" as const;

function value(input: number | undefined): DetailedStatusValue {
  return input === undefined ? unavailable : input;
}

export function getLaunchDetailedStatusCounts(
  launch: LaunchStatusInput,
  scope = "launch"
): LaunchDetailedStatusCounts {
  const buckets: LaunchStatusBuckets = {
    passed: value(launch.passed),
    passedManually: value(launch.passedManually),
    failed: value(launch.failed),
    failedAsKnown: value(launch.failedAsKnown),
    skipped: value(launch.skipped),
    blocked: value(launch.blocked),
    inProgress: value(launch.inProgress),
    aborted: value(launch.aborted),
  };
  const missing = Object.entries(buckets)
    .filter(([, count]) => count === unavailable)
    .map(([field]) => field);
  const totalConsidered = [
    launch.passed,
    launch.failed,
    launch.skipped,
    launch.blocked,
    launch.inProgress,
    launch.aborted,
  ].reduce<number>((sum, count) => sum + (count ?? 0), 0);

  return {
    source: "launch",
    scope,
    buckets,
    passedManually: buckets.passedManually,
    // Launch-level failedAsKnown is a distinct API bucket. Do not relabel it as
    // the per-test knownIssue boolean.
    knownIssue: unavailable,
    bothConditions: unavailable,
    eitherCondition: unavailable,
    totalConsidered,
    unavailable: [...missing, "knownIssue", "bothConditions", "eitherCondition"],
  };
}

export function getTestRunDetailedStatusCounts(
  tests: ReadonlyArray<Pick<TestRunResponse, "passedManually" | "knownIssue">>,
  scope = "all test runs"
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
    scope,
    passedManually,
    knownIssue,
    bothConditions,
    eitherCondition: passedManually + knownIssue - bothConditions,
    totalConsidered: tests.length,
    unavailable: [],
  };
}

export function getTcmDetailedStatusCounts(
  statusCounts: Readonly<Record<string, number>>,
  scope = "TCM results"
): DetailedStatusCounts {
  const knownEntry = Object.entries(statusCounts).find(([name]) =>
    /known[\s_-]*issue/i.test(name)
  );
  return {
    source: "tcm",
    scope,
    passedManually: unavailable,
    knownIssue: knownEntry?.[1] ?? unavailable,
    bothConditions: unavailable,
    eitherCondition: unavailable,
    totalConsidered: Object.values(statusCounts).reduce((sum, count) => sum + count, 0),
    unavailable: [
      "passedManually",
      ...(knownEntry ? [] : ["knownIssue"]),
      "bothConditions",
      "eitherCondition",
    ],
  };
}

export function getWidgetDetailedStatusCounts(
  counts: Partial<Record<"passed" | "failed" | "skipped" | "knownIssue" | "aborted", number>>,
  scope = "widget results"
): DetailedStatusCounts {
  return {
    source: "widget",
    scope,
    passedManually: unavailable,
    knownIssue: value(counts.knownIssue),
    bothConditions: unavailable,
    eitherCondition: unavailable,
    totalConsidered: Object.values(counts).reduce<number>((sum, count) => sum + (count ?? 0), 0),
    unavailable: [
      "passedManually",
      ...(counts.knownIssue === undefined ? ["knownIssue"] : []),
      "bothConditions",
      "eitherCondition",
    ],
  };
}
