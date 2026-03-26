import "dotenv/config";
import { EvalLayer } from "./eval-config.js";

/**
 * Runtime-discovered context from real Zebrunner data.
 * All IDs come from API calls at eval startup — nothing is hardcoded.
 */
export interface EvalDiscoveryContext {
  projectKey: string;
  projectId: number;
  suiteId: number;
  suiteName: string;
  testCaseKey: string;
  testCaseId: number;

  launchId?: number;
  launchName?: string;
  launchTestId?: number;
  failedLaunchId?: number;
  failedLaunchTestId?: number;
  milestoneName?: string;
  testRunId?: number;
  automationStateId?: number;
  automationStateName?: string;
  secondTestCaseKey?: string;
}

interface DiscoveryDeps {
  EnhancedZebrunnerClient: any;
  ZebrunnerReportingClient: any;
}

async function loadClients(): Promise<DiscoveryDeps> {
  const [enhanced, reporting] = await Promise.all([
    import("../../src/api/enhanced-client.js"),
    import("../../src/api/reporting-client.js"),
  ]);
  return {
    EnhancedZebrunnerClient: enhanced.EnhancedZebrunnerClient,
    ZebrunnerReportingClient: reporting.ZebrunnerReportingClient,
  };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`${name} is required in .env for eval discovery`);
  return val;
}

/**
 * Progressive data discovery from Zebrunner.
 *
 * Layer 1/2 (minimal): ~4 API calls — project, suites, test cases.
 * Layer 3 (full): ~12-15 API calls — adds launches, milestones, test runs.
 */
export async function discoverEvalContext(layer: EvalLayer): Promise<EvalDiscoveryContext> {
  const baseUrl = requireEnv("ZEBRUNNER_URL").replace(/\/+$/, "");
  const login = requireEnv("ZEBRUNNER_LOGIN");
  const token = requireEnv("ZEBRUNNER_TOKEN");

  const { EnhancedZebrunnerClient, ZebrunnerReportingClient } = await loadClients();

  const publicClient = new EnhancedZebrunnerClient({
    baseUrl,
    username: login,
    token,
    timeout: 30_000,
    retryAttempts: 2,
    retryDelay: 500,
    debug: false,
    defaultPageSize: 10,
    maxPageSize: 100,
  });

  const reportingBase = baseUrl.replace("/api/public/v1", "");
  const reportingClient = new ZebrunnerReportingClient({
    baseUrl: reportingBase,
    accessToken: token,
    timeout: 30_000,
    debug: false,
  });

  console.error("[eval-discovery] Discovering starred projects...");

  const projectsResp = await reportingClient.getAvailableProjects({ starred: true });
  if (!projectsResp.items.length) {
    throw new Error(
      "No starred projects found in Zebrunner. Star at least one project to run eval tests."
    );
  }

  const project = projectsResp.items[0];
  const projectKey = project.key;
  const projectId = project.id;
  console.error(`[eval-discovery] Using starred project: ${projectKey} (id=${projectId})`);

  // ── Minimal discovery (Layer 1/2/3) ──

  console.error("[eval-discovery] Fetching suites...");
  const suitesResp = await publicClient.getTestSuites(projectKey, { size: 5 });
  const firstSuite = suitesResp.items?.[0];
  if (!firstSuite) {
    throw new Error(`Project ${projectKey} has no test suites. Cannot run eval.`);
  }

  console.error("[eval-discovery] Fetching test cases...");
  const casesResp = await publicClient.getTestCases(projectKey, { size: 5 });
  const firstCase = casesResp.items?.[0];
  if (!firstCase) {
    throw new Error(`Project ${projectKey} has no test cases. Cannot run eval.`);
  }

  const ctx: EvalDiscoveryContext = {
    projectKey,
    projectId,
    suiteId: firstSuite.id,
    suiteName: firstSuite.title || firstSuite.name || `Suite ${firstSuite.id}`,
    testCaseKey: firstCase.key || `${projectKey}-${firstCase.id}`,
    testCaseId: firstCase.id,
  };

  if (casesResp.items.length > 1) {
    const second = casesResp.items[1];
    ctx.secondTestCaseKey = second.key || `${projectKey}-${second.id}`;
  }

  if (layer < 3) {
    console.error("[eval-discovery] Minimal discovery complete (Layer 1/2).");
    logContext(ctx);
    return ctx;
  }

  // ── Full discovery (Layer 3 only) ──

  console.error("[eval-discovery] Full discovery for Layer 3...");

  try {
    console.error("[eval-discovery] Fetching launches...");
    const launchesResp = await reportingClient.getLaunches(projectId, { page: 1, pageSize: 10 });
    const launches = launchesResp.items || [];
    const firstLaunch = launches[0];

    if (firstLaunch) {
      ctx.launchId = firstLaunch.id;
      ctx.launchName = firstLaunch.name;
      console.error(`[eval-discovery]   launch: ${firstLaunch.name} (id=${firstLaunch.id})`);

      try {
        const testsResp = await reportingClient.getTestRuns(firstLaunch.id, projectId, {
          page: 1,
          pageSize: 2,
        });
        const firstTest = testsResp.items?.[0];
        if (firstTest) {
          ctx.launchTestId = firstTest.id;
        }
      } catch {
        console.error("[eval-discovery]   Could not fetch launch tests (skipped)");
      }
    }

    // Try to find a launch with failures for failure-analysis prompts
    const launchWithFailures = launches.find(
      (l: any) => (l.failed || 0) + (l.failedAsKnown || 0) > 0
    );
    if (launchWithFailures) {
      ctx.failedLaunchId = launchWithFailures.id;
      console.error(`[eval-discovery]   launch with failures: ${launchWithFailures.name} (id=${launchWithFailures.id}, failed=${launchWithFailures.failed})`);

      try {
        const failedTestsResp = await reportingClient.getTestRuns(launchWithFailures.id, projectId, {
          page: 1,
          pageSize: 20,
        });
        const failedTest = failedTestsResp.items?.find(
          (t: any) => t.status === "FAILED" || t.status === "SKIPPED"
        );
        if (failedTest) {
          ctx.failedLaunchTestId = failedTest.id;
          console.error(`[eval-discovery]   failed test: id=${failedTest.id} (status=${failedTest.status})`);
        }
      } catch {
        console.error("[eval-discovery]   Could not fetch failed launch tests (skipped)");
      }
    } else {
      console.error("[eval-discovery]   No launches with failures found in recent 10 launches");
    }
  } catch {
    console.error("[eval-discovery]   Could not fetch launches (skipped)");
  }

  try {
    console.error("[eval-discovery] Fetching milestones...");
    const msResp = await reportingClient.getMilestones(projectId, {
      page: 1,
      pageSize: 5,
      completed: "all",
    });
    const firstMs = msResp.items?.[0];
    if (firstMs) {
      ctx.milestoneName = firstMs.name;
      console.error(`[eval-discovery]   milestone: ${firstMs.name}`);
    }
  } catch {
    console.error("[eval-discovery]   Could not fetch milestones (skipped)");
  }

  try {
    console.error("[eval-discovery] Fetching automation states...");
    const states = await reportingClient.getAutomationStates(projectId);
    const automatedState = states.find(
      (s: { name: string }) => s.name.toLowerCase() === "automated"
    );
    if (automatedState) {
      ctx.automationStateId = automatedState.id;
      ctx.automationStateName = automatedState.name;
    }
  } catch {
    console.error("[eval-discovery]   Could not fetch automation states (skipped)");
  }

  try {
    console.error("[eval-discovery] Fetching test runs...");
    const runsResp = await publicClient.getTestRuns(projectKey, { size: 2 });
    const firstRun = runsResp.items?.[0];
    if (firstRun) {
      ctx.testRunId = firstRun.id;
      console.error(`[eval-discovery]   test run: id=${firstRun.id}`);
    }
  } catch {
    console.error("[eval-discovery]   Could not fetch test runs (skipped)");
  }

  console.error("[eval-discovery] Full discovery complete (Layer 3).");
  logContext(ctx);
  return ctx;
}

function logContext(ctx: EvalDiscoveryContext): void {
  const entries = Object.entries(ctx).filter(([, v]) => v !== undefined);
  console.error(
    "[eval-discovery] Context:\n" +
      entries.map(([k, v]) => `  ${k}: ${v}`).join("\n")
  );
}
