import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";

import {
  isCompactDefaultsEnabled,
  isInlineMetricsEnabled,
  isSummaryDefaultsEnabled,
  defaultMaxResults,
} from "../../src/utils/mcp-output-flags.js";

describe("mcp-output-flags", () => {
  const prev = {
    compact: process.env.MCP_COMPACT_DEFAULTS,
    summary: process.env.MCP_SUMMARY_DEFAULTS,
    inline: process.env.MCP_INLINE_METRICS,
    maxResults: process.env.MCP_MAX_RESULTS,
  };

  beforeEach(() => {
    delete process.env.MCP_COMPACT_DEFAULTS;
    delete process.env.MCP_SUMMARY_DEFAULTS;
    delete process.env.MCP_INLINE_METRICS;
    delete process.env.MCP_MAX_RESULTS;
  });

  afterEach(() => {
    if (prev.compact === undefined) delete process.env.MCP_COMPACT_DEFAULTS;
    else process.env.MCP_COMPACT_DEFAULTS = prev.compact;
    if (prev.summary === undefined) delete process.env.MCP_SUMMARY_DEFAULTS;
    else process.env.MCP_SUMMARY_DEFAULTS = prev.summary;
    if (prev.inline === undefined) delete process.env.MCP_INLINE_METRICS;
    else process.env.MCP_INLINE_METRICS = prev.inline;
    if (prev.maxResults === undefined) delete process.env.MCP_MAX_RESULTS;
    else process.env.MCP_MAX_RESULTS = prev.maxResults;
  });

  it("isInlineMetricsEnabled is false by default", () => {
    assert.equal(isInlineMetricsEnabled(), false);
  });

  it("isInlineMetricsEnabled is true when MCP_INLINE_METRICS=true", () => {
    process.env.MCP_INLINE_METRICS = "true";
    assert.equal(isInlineMetricsEnabled(), true);
  });

  it("isInlineMetricsEnabled is false for other values", () => {
    process.env.MCP_INLINE_METRICS = "1";
    assert.equal(isInlineMetricsEnabled(), false);
  });

  it("isCompactDefaultsEnabled respects MCP_COMPACT_DEFAULTS", () => {
    assert.equal(isCompactDefaultsEnabled(), false);
    process.env.MCP_COMPACT_DEFAULTS = "true";
    assert.equal(isCompactDefaultsEnabled(), true);
  });

  it("isSummaryDefaultsEnabled respects MCP_SUMMARY_DEFAULTS", () => {
    assert.equal(isSummaryDefaultsEnabled(), false);
    process.env.MCP_SUMMARY_DEFAULTS = "true";
    assert.equal(isSummaryDefaultsEnabled(), true);
  });

  describe("defaultMaxResults()", () => {
    it("returns schema fallback when MCP_MAX_RESULTS unset", () => {
      assert.equal(defaultMaxResults(5000), 5000);
      assert.equal(defaultMaxResults(500), 500);
    });

    it("returns env value when positive integer", () => {
      process.env.MCP_MAX_RESULTS = "200";
      assert.equal(defaultMaxResults(5000), 200);
      assert.equal(defaultMaxResults(500), 200);
    });

    it("falls back on invalid env", () => {
      process.env.MCP_MAX_RESULTS = "0";
      assert.equal(defaultMaxResults(5000), 5000);
      process.env.MCP_MAX_RESULTS = "nope";
      assert.equal(defaultMaxResults(500), 500);
    });
  });
});
