import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ZebrunnerReportingClient } from "../../src/api/reporting-client.js";
import {
  LaunchJobParametersResponseSchema,
  StartLaunchBuildResponseSchema,
} from "../../src/types/reporting.js";

describe("ZebrunnerReportingClient launch build methods", () => {
  it("GETs job parameters from the correct URL", async () => {
    const client = new ZebrunnerReportingClient({
      baseUrl: "https://mfp.zebrunner.com",
      accessToken: "test-token",
    });

    let capturedUrl = "";
    (client as any).makeAuthenticatedRequest = async (_method: string, url: string) => {
      capturedUrl = url;
      return {
        items: [{ name: "build", parameterClass: "STRING", value: ".*" }],
      };
    };

    const result = await client.getLaunchJobParameters(132452, 7);
    assert.equal(
      capturedUrl,
      "/api/reporting/v1/launches/132452/job/parameters?projectId=7"
    );
    assert.equal(result.items[0].name, "build");
  });

  it("POSTs job:build with JSON payload", async () => {
    const client = new ZebrunnerReportingClient({
      baseUrl: "https://mfp.zebrunner.com",
      accessToken: "test-token",
    });

    let capturedMethod = "";
    let capturedUrl = "";
    let capturedBody: unknown;

    (client as any).makeAuthenticatedRequest = async (
      method: string,
      url: string,
      body?: unknown
    ) => {
      capturedMethod = method;
      capturedUrl = url;
      capturedBody = body;
      return { id: 140100, name: "Critical", status: "IN_PROGRESS" };
    };

    const payload = { build: ".*", locale: "en_US", suite: "mfp/android/critical-flow" };
    const result = await client.startLaunchBuild(132452, 7, payload);

    assert.equal(capturedMethod, "POST");
    assert.equal(
      capturedUrl,
      "/api/reporting/v1/launches/132452/job:build?projectId=7"
    );
    assert.deepEqual(capturedBody, payload);
    assert.equal(result.id, 140100);
  });
});

describe("Launch job schemas", () => {
  it("parses job parameters response", () => {
    const parsed = LaunchJobParametersResponseSchema.parse({
      items: [{ name: "env", parameterClass: "STRING", value: "PRODUCTION" }],
    });
    assert.equal(parsed.items.length, 1);
  });

  it("parses start build response with extras", () => {
    const parsed = StartLaunchBuildResponseSchema.parse({
      id: 1,
      status: "IN_PROGRESS",
      extra: "ok",
    });
    assert.equal((parsed as any).extra, "ok");
  });
});
