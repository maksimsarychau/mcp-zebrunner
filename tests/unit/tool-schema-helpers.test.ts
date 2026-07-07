import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { z } from "zod";

import { withCallMetricsSchema } from "../../src/utils/tool-schema-helpers.js";

describe("withCallMetricsSchema()", () => {
  it("should add include_call_metrics to zod object schemas", () => {
    const base = z.object({ project_key: z.string() });
    const extended = withCallMetricsSchema(base) as z.ZodObject<z.ZodRawShape>;
    const shape = extended.shape;

    assert.ok(shape.include_call_metrics);
    assert.ok(shape.project_key);
  });

  it("should pass through non-object schemas unchanged", () => {
    const passthrough = withCallMetricsSchema("not-a-schema");
    assert.equal(passthrough, "not-a-schema");
  });
});
