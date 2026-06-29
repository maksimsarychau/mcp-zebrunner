/** Minimal launch shape for rerun eligibility checks. */
export interface LaunchRerunInput {
  id?: number;
  name?: string;
  failed?: number;
  aborted?: number;
  isRelaunchPossible?: boolean;
  status?: string;
}

export interface LaunchRerunTarget {
  launchId: number;
  name: string;
  failed: number;
  aborted: number;
  status: string;
}

const RUNNING_STATUSES = new Set(["IN_PROGRESS", "RUNNING"]);

export function getLaunchFailureCount(launch: Pick<LaunchRerunInput, "failed" | "aborted">): number {
  return (launch.failed ?? 0) + (launch.aborted ?? 0);
}

export function getLaunchRerunIneligibilityReason(
  launch: LaunchRerunInput,
  minFailed = 1
): string | null {
  const status = launch.status?.toUpperCase();
  if (status && RUNNING_STATUSES.has(status)) {
    return `launch is ${launch.status}`;
  }
  if (launch.isRelaunchPossible === false) {
    return "relaunch is not possible for this launch";
  }
  const failureCount = getLaunchFailureCount(launch);
  if (failureCount < minFailed) {
    return `failure count (${failureCount}) below min_failed (${minFailed})`;
  }
  return null;
}

export function isLaunchEligibleForFailureRerun(
  launch: LaunchRerunInput,
  minFailed = 1
): boolean {
  return getLaunchRerunIneligibilityReason(launch, minFailed) === null;
}

export function toLaunchRerunTarget(launch: LaunchRerunInput & { id: number; name: string }): LaunchRerunTarget {
  return {
    launchId: launch.id,
    name: launch.name,
    failed: launch.failed ?? 0,
    aborted: launch.aborted ?? 0,
    status: launch.status ?? "UNKNOWN",
  };
}
