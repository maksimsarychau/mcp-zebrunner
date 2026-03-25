# Zebrunner Terminology: Test vs Test Case vs Test Run vs Launch

This document clarifies the key entities in the Zebrunner ecosystem and how they relate to each other. Understanding these distinctions is critical for accurate metrics and reporting.

---

## Launch

A **Launch** is a single execution of an automated test suite (or set of suites) against a specific build and milestone.

| Property        | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| **Contains**    | One or more **Tests**                                                 |
| **Identified by** | Launch ID, project, suite name, milestone, build number            |
| **Metrics**     | Total elapsed time, pass/fail/skip counts, attempt history            |
| **Example**     | _"Android Regression Suite" launched for milestone develop-49771_     |

A launch may have multiple **attempts** (re-runs). The first attempt is the initial run; subsequent attempts re-execute failed or incomplete tests.

---

## Test

A **Test** is an **atomic execution item** inside a Launch. It represents a single automated test method that either passes, fails, is skipped, blocked, or aborted.

| Property        | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| **Belongs to**  | Exactly one Launch                                                    |
| **Identified by** | Test ID within the launch                                          |
| **Status**      | PASSED, FAILED, SKIPPED, BLOCKED, ABORTED, KNOWN_ISSUE               |
| **Duration**    | Measured in seconds; classified as Short (<300s), Medium (300–600s), or Long (≥600s) by default. Thresholds are configurable via `medium_threshold_seconds` and `long_threshold_seconds` parameters |
| **Covers**      | 0, 1, or many **Test Cases** from TCM                                |

### Relationship to Test Cases

One Test may be linked to **multiple Test Cases** from the Test Case Management (TCM) system:

```
Test: topTest
├── Test Case: MCP-1859  (TCM)
└── Test Case: MCP-1860  (TCM)
```

When counting:
- **"Number of Executed Tests"** counts this as **1 test**
- **"Number of Test Cases Covered"** counts this as **2 test cases**

It is also possible that a test has **zero** linked test cases (not yet mapped in TCM).

---

## Test Case

A **Test Case** is an **atomic item in the Test Case Management (TCM) system**. It includes steps, expected results, preconditions, and other specification details. Test cases are used primarily for:

- **Manual testing** — executed by QA engineers through Test Runs
- **Automation coverage tracking** — linked to automated Tests to show which specifications are covered

| Property        | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| **Identified by** | Test Case Key (e.g., `MCP-1859`)                               |
| **Contains**    | Steps, expected results, preconditions, description                   |
| **Used by**     | Manual Test Runs and linked to automated Tests                        |
| **Automation states** | Automated, Not Automated, Manual Only, etc.                    |

---

## Test Run

A **Test Run** is a separate entity used for **manual test case execution**. It contains only atomic Test Cases (not Tests from automated launches).

| Property        | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| **Contains**    | Test Cases from TCM                                                   |
| **Purpose**     | Manual execution of test specifications                               |
| **Automation link** | Results from automated Launches can be mapped into Test Runs to reduce manual effort — QA only needs to check non-automated or manual-only test cases |

---

## Test Session

A **Test Session** represents a single device/browser session in which a test executes. A test may run across **multiple sessions** due to:

- **Launch re-runs** (attempt-level retries)
- **CI retry configuration** (`retry > 0` per test at the framework/CI level)
- **Infrastructure retries** (device provisioning failures)

| Property        | Description                                                           |
|-----------------|-----------------------------------------------------------------------|
| **Belongs to**  | A Test within a Launch                                                |
| **Identified by** | Session ID (UUID)                                                  |
| **Contains**    | Device/platform info, `durationInSeconds`, video, logs                |
| **Status**      | COMPLETED, FAILED, ABORTED                                           |

### Effective Duration vs Wall-Clock Duration

When a test has multiple sessions, the **wall-clock duration** (`test.finishTime - test.startTime`) includes queue time, device provisioning gaps, and all retry overhead. This inflates per-test metrics.

| Duration Type | Formula | When to Use |
|--------------|---------|-------------|
| **Effective Duration** | `durationInSeconds` from the session that produced the final result (passed, or last) | Per-test metrics, duration classification |
| **Longest Session** | Highest `durationInSeconds` across all sessions | Worst-case analysis |
| **Total Retry Duration** | Sum of all sessions' `durationInSeconds` | Total compute cost |
| **Wall-Clock Duration** | `finishTime - startTime` on the test | Total calendar time (includes gaps) |

**Example:** Test 5728425 with 2 sessions:

| Session | Device | Duration | Status |
|---------|--------|----------|--------|
| Session 1 | iPhone_SE_2 | 7m 58s | FAILED |
| Session 2 | iPhone_XR_2 | 16m 19s | PASSED |

- **Effective Duration**: 16m 19s (passed session)
- **Longest Session**: 16m 19s
- **Total Retry Duration**: 24m 17s (478 + 979)
- **Wall-Clock Duration**: 40m 59s (includes 13m gap)

The `session_resolution` parameter on tools (`auto`, `per_test`, `launch_level`) controls how session data is fetched for duration resolution.

---

## Counting Rules for Metrics

| Metric | What It Counts | Unit |
|--------|---------------|------|
| **Number of Executed Tests** | Atomic test items in a launch | Tests |
| **Number of Test Cases Covered** | TCM test cases linked to tests in a launch | Test Cases |
| **Average Runtime per Test** | `Total Elapsed / Number of Executed Tests` | seconds/test |
| **Average Runtime per Test Case** | `Total Elapsed / Number of Test Cases Covered` | seconds/test-case |
| **Pass Rate** | `Passed Tests / Total Tests × 100` | % |
| **Test Case Coverage** | Breakdown by linked count: 0 TCs, 1 TC, 2+ TCs | count |

### Coverage Breakdown Example

Given 4 tests in a launch:

| Test | Linked Test Cases | Count |
|------|------------------|-------|
| loginTest | MCP-100 | 1 |
| topTest | MCP-200, MCP-201 | 2 |
| settingsTest | _(none)_ | 0 |
| profileTest | MCP-300, MCP-301, MCP-302 | 3 |

**Summary:**
- Executed Tests: **4**
- Test Cases Covered: **6**
- Tests with 0 TCs: **1** (settingsTest)
- Tests with 1 TC: **1** (loginTest)
- Tests with 2+ TCs: **2** (topTest, profileTest)

---

## Related Tools

| Tool | Relevant Metrics |
|------|-----------------|
| `analyze_regression_runtime` | Avg Runtime per Test, Avg Runtime per Test Case, WRI (per Test), WRI (per Test Case), Duration Classification (configurable thresholds), Duration Distribution (tests and test cases), Attempt Breakdown, Test Case Coverage Breakdown, Baseline Comparison (deltas for all metrics) |
| `get_launch_details` | Test counts, test case coverage statistics |
| `get_launch_test_summary` | Per-test details with linked test case keys |
| `generate_weekly_regression_stability_report` | Pass rates, total test cases covered |
| `get_launch_summary` | Lightweight overview with test/test-case note |

---

_v6.5.4 — March 2026_
