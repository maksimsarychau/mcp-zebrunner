import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { ZebrunnerReportingClient } from "../../src/api/reporting-client.js";
import { RerunLaunchResponseSchema } from "../../src/types/reporting.js";

describe("ZebrunnerReportingClient.rerunLaunchFailures", () => {
  it("POSTs to the rerun failures endpoint with correct query params", async () => {
    const client = new ZebrunnerReportingClient({
      baseUrl: "https://mfp.zebrunner.com",
      accessToken: "test-token",
    });

    let capturedMethod = "";
    let capturedUrl = "";

    (client as any).makeAuthenticatedRequest = async (method: string, url: string) => {
      capturedMethod = method;
      capturedUrl = url;
      return { id: 140001, name: "Rerun launch", status: "IN_PROGRESS" };
    };

    const result = await client.rerunLaunchFailures(132522, 7);

    assert.equal(capturedMethod, "POST");
    assert.equal(
      capturedUrl,
      "/api/reporting/v1/launches/132522:rerun?projectId=7&rerunFailures=true"
    );
    assert.equal(result.id, 140001);
  });

  it("supports rerunFailures=false when requested", async () => {
    const client = new ZebrunnerReportingClient({
      baseUrl: "https://mfp.zebrunner.com",
      accessToken: "test-token",
    });

    let capturedUrl = "";
    (client as any).makeAuthenticatedRequest = async (_method: string, url: string) => {
      capturedUrl = url;
      return { id: 1 };
    };

    await client.rerunLaunchFailures(100, 7, { rerunFailures: false });
    assert.ok(capturedUrl.includes("rerunFailures=false"));
  });
});

describe("RerunLaunchResponseSchema", () => {
  it("parses known fields and passes through extras", () => {
    const parsed = RerunLaunchResponseSchema.parse({
      id: 999,
      name: "Rerun",
      status: "IN_PROGRESS",
      extraField: "kept",
    });
    assert.equal(parsed.id, 999);
    assert.equal((parsed as any).extraField, "kept");
  });
});
