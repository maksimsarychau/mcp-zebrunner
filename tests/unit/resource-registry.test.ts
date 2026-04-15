import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import {
  ResourceCache,
  buildReportTypesContent,
  buildPeriodsContent,
  buildChartOptionsContent,
  buildFormatReferenceContent,
  getResourcesCatalog,
  MAX_CACHE_ENTRIES,
  type ResourceMeta,
} from "../../src/resources.js";
import { ALL_PERIODS } from "../../src/utils/widget-sql.js";

function getProjectRoot() {
  return path.resolve(process.cwd());
}

// ── Registration coverage ────────────────────────────────────────────────────

function extractResourceRegistrations(source: string): string[] {
  const regex = /server\.registerResource\(\s*"([^"]+)"/g;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    names.push(match[1]);
  }
  return names;
}

describe("Resource Registry Coverage", () => {
  const root = getProjectRoot();
  const resourceSource = fs.readFileSync(path.join(root, "src", "resources.ts"), "utf-8");
  const registeredResources = extractResourceRegistrations(resourceSource);

  it("registers the expected number of resources", () => {
    assert.equal(registeredResources.length, 13, `Expected 13 resources, got ${registeredResources.length}: ${registeredResources.join(", ")}`);
  });

  it("has unique resource names", () => {
    assert.equal(new Set(registeredResources).size, registeredResources.length, "all resource names should be unique");
  });

  it("includes all expected resource names", () => {
    const expected = [
      "available_projects",
      "report_types",
      "project_root_suites",
      "project_automation_states",
      "project_priorities",
      "time_periods",
      "chart_options",
      "output_formats",
      "project_milestones",
      "project_result_statuses",
      "project_configuration_groups",
      "project_fields_layout",
      "project_suite_hierarchy",
    ];
    for (const name of expected) {
      assert.ok(registeredResources.includes(name), `Missing resource: ${name}`);
    }
  });

  it("uses zebrunner:// URI scheme for all resources", () => {
    const uriRegex = /zebrunner:\/\/[a-z\-\/{}_.]+/g;
    const uris: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = uriRegex.exec(resourceSource)) !== null) {
      uris.push(match[0]);
    }
    assert.ok(uris.length >= 13, `should have at least 13 zebrunner:// URIs, got ${uris.length}`);
    for (const uri of uris) {
      assert.ok(uri.startsWith("zebrunner://"), `URI should use zebrunner:// scheme: ${uri}`);
    }
  });
});

// ── Static content validation ────────────────────────────────────────────────

describe("Report Types Resource Content", () => {
  const content = buildReportTypesContent() as any;

  it("contains exactly 6 report types", () => {
    assert.equal(content.report_types.length, 6);
  });

  it("includes all expected report type names", () => {
    const names = content.report_types.map((r: any) => r.name);
    const expected = ["quality_dashboard", "coverage", "pass_rate", "runtime_efficiency", "executive_dashboard", "release_readiness"];
    assert.deepEqual(names, expected);
  });

  it("each report type has required fields", () => {
    for (const rt of content.report_types) {
      assert.ok(rt.name, `report type missing name`);
      assert.ok(rt.title, `${rt.name} missing title`);
      assert.ok(rt.description, `${rt.name} missing description`);
      assert.ok(rt.outputs && rt.outputs.length > 0, `${rt.name} missing outputs`);
      assert.ok(rt.example, `${rt.name} missing example`);
    }
  });

  it("includes shared_params and tips", () => {
    assert.ok(content.shared_params, "missing shared_params");
    assert.ok(content.shared_params.projects, "missing projects param");
    assert.ok(content.tips && content.tips.length > 0, "missing tips");
  });
});

describe("Periods Resource Content", () => {
  const content = buildPeriodsContent() as any;

  it("contains all 12 period values", () => {
    assert.equal(content.periods.length, 12);
  });

  it("matches ALL_PERIODS from widget-sql", () => {
    const values = content.periods.map((p: any) => p.value);
    assert.deepEqual(values, [...ALL_PERIODS]);
  });

  it("each period has a days equivalent", () => {
    for (const p of content.periods) {
      assert.ok(p.value, "period missing value");
      assert.ok(typeof p.days === "number" || p.days === null, `${p.value}: days should be number or null`);
    }
  });

  it("includes used_by list with defaults", () => {
    assert.ok(content.used_by && content.used_by.length >= 5, "should list at least 5 tools");
    for (const entry of content.used_by) {
      assert.ok(entry.tool, "used_by entry missing tool name");
      assert.ok(entry.default, "used_by entry missing default value");
    }
  });
});

describe("Chart Options Resource Content", () => {
  const content = buildChartOptionsContent() as any;

  it("includes delivery_formats", () => {
    assert.ok(content.delivery_formats && content.delivery_formats.length === 4);
    const values = content.delivery_formats.map((f: any) => f.value);
    assert.deepEqual(values, ["none", "png", "html", "text"]);
  });

  it("includes chart_types", () => {
    assert.ok(content.chart_types && content.chart_types.length === 6);
    const values = content.chart_types.map((t: any) => t.value);
    assert.deepEqual(values, ["auto", "pie", "bar", "stacked_bar", "horizontal_bar", "line"]);
  });

  it("lists supported tools", () => {
    assert.ok(content.supported_tools && content.supported_tools.length === 17, `Expected 17 supported tools, got ${content.supported_tools?.length}`);
  });
});

describe("Format Reference Resource Content", () => {
  const content = buildFormatReferenceContent() as any;

  it("includes 5 format families", () => {
    assert.equal(content.format_families.length, 5);
  });

  it("each family has required fields", () => {
    for (const family of content.format_families) {
      assert.ok(family.name, "family missing name");
      assert.ok(family.values && family.values.length >= 2, `${family.name} should have at least 2 values`);
      assert.ok(family.description, `${family.name} missing description`);
      assert.ok(typeof family.tools_count === "number", `${family.name} missing tools_count`);
      assert.ok(family.default, `${family.name} missing default`);
    }
  });
});

// ── Resource Catalog API ─────────────────────────────────────────────────────

describe("getResourcesCatalog()", () => {
  const catalog = getResourcesCatalog();

  it("returns exactly 13 resources matching registered count", () => {
    assert.equal(catalog.length, 13);
  });

  it("every entry has required fields", () => {
    for (const r of catalog) {
      assert.ok(r.name && r.name.length > 0, `resource missing name`);
      assert.ok(r.uri && r.uri.length > 0, `${r.name} missing uri`);
      assert.ok(r.description && r.description.length > 0, `${r.name} missing description`);
      assert.ok(r.type === "static" || r.type === "template", `${r.name} has invalid type: ${r.type}`);
    }
  });

  it("catalog names match registered resource names", () => {
    const root = getProjectRoot();
    const resourceSource = fs.readFileSync(path.join(root, "src", "resources.ts"), "utf-8");
    const registered = extractResourceRegistrations(resourceSource);
    const catalogNames = catalog.map(r => r.name);
    assert.deepEqual(catalogNames.sort(), registered.sort(), "catalog names should match registered names");
  });

  it("has unique names", () => {
    const names = catalog.map(r => r.name);
    assert.equal(new Set(names).size, names.length, "catalog names should be unique");
  });

  it("includes 5 static and 8 template resources", () => {
    const statics = catalog.filter(r => r.type === "static");
    const templates = catalog.filter(r => r.type === "template");
    assert.equal(statics.length, 5, `expected 5 static, got ${statics.length}`);
    assert.equal(templates.length, 8, `expected 8 template, got ${templates.length}`);
  });

  it("all URIs use zebrunner:// scheme", () => {
    for (const r of catalog) {
      assert.ok(r.uri.startsWith("zebrunner://"), `${r.name} URI should start with zebrunner://`);
    }
  });

  it("template resources contain {project_key} placeholder", () => {
    for (const r of catalog.filter(r => r.type === "template")) {
      assert.ok(r.uri.includes("{project_key}"), `${r.name} template should contain {project_key}`);
    }
  });

  it("static resources do not contain template variables", () => {
    for (const r of catalog.filter(r => r.type === "static")) {
      assert.ok(!r.uri.includes("{"), `${r.name} static URI should not contain template variables`);
    }
  });
});

// ── Cache unit tests ─────────────────────────────────────────────────────────

describe("ResourceCache", () => {
  it("returns undefined for missing keys", () => {
    const cache = new ResourceCache();
    assert.equal(cache.get("nonexistent"), undefined);
  });

  it("stores and retrieves data", () => {
    const cache = new ResourceCache();
    cache.set("key1", { hello: "world" });
    const result = cache.get<{ hello: string }>("key1");
    assert.deepEqual(result, { hello: "world" });
  });

  it("returns undefined for expired entries", () => {
    const cache = new ResourceCache();
    cache.set("expired", "data", 1); // 1ms TTL
    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }
    assert.equal(cache.get("expired"), undefined);
  });

  it("tracks size correctly", () => {
    const cache = new ResourceCache();
    assert.equal(cache.size, 0);
    cache.set("a", 1);
    cache.set("b", 2);
    assert.equal(cache.size, 2);
  });

  it("clears all entries", () => {
    const cache = new ResourceCache();
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get("a"), undefined);
  });

  it("evicts oldest entry when max size is reached", () => {
    const cache = new ResourceCache();
    for (let i = 0; i < MAX_CACHE_ENTRIES; i++) {
      cache.set(`key-${i}`, i);
    }
    assert.equal(cache.size, MAX_CACHE_ENTRIES);
    cache.set("overflow", "new");
    assert.ok(cache.size <= MAX_CACHE_ENTRIES, `cache size ${cache.size} should not exceed ${MAX_CACHE_ENTRIES}`);
    assert.equal(cache.get("overflow"), "new");
  });

  it("exports MAX_CACHE_ENTRIES constant", () => {
    assert.equal(typeof MAX_CACHE_ENTRIES, "number");
    assert.ok(MAX_CACHE_ENTRIES > 0);
  });
});
