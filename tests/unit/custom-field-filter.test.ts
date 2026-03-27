import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  resolveFieldPath,
  matchesField,
  filterByField,
  discoverFieldPaths,
  type FieldFilter,
} from "../../src/utils/custom-field-filter.js";

const SAMPLE_TC = {
  id: 1076,
  key: "MFPAND-180",
  title: "[Diary]Nutrients get updated after adding a food item",
  deleted: false,
  deprecated: false,
  draft: false,
  description: null,
  testSuite: { id: 453 },
  priority: { id: 16, name: "Medium" },
  automationState: { id: 12, name: "Automated" },
  createdBy: { id: 604, username: "maksim.sarychau", email: "maksim.sarychau@ext.myfitnesspal.com" },
  lastModifiedBy: { id: 676, username: "tatsiana.yemelyanchyk", email: "tatsiana.yemelyanchyk@ext.myfitnesspal.com" },
  customField: {
    manualOnly: "No",
    isAutomated: "Yes",
    caseStatus: "Implemented correctly",
    testrailId: "12245",
    legacy_id: "C1726762",
    testrailCaseType: "Other",
  },
};

const SAMPLE_MANUAL = {
  ...SAMPLE_TC,
  id: 2000,
  key: "MFPAND-999",
  title: "Manual barcode scanning test",
  automationState: { id: 10, name: "Not Automated" },
  customField: {
    manualOnly: "Yes",
    isAutomated: "No",
    caseStatus: "Updated",
  },
};

describe("Custom Field Filter Unit Tests", () => {
  describe("resolveFieldPath", () => {
    it("should resolve top-level string field", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "key"), "MFPAND-180");
    });

    it("should resolve top-level boolean field", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "deprecated"), false);
    });

    it("should resolve top-level null field", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "description"), null);
    });

    it("should resolve nested field (priority.name)", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "priority.name"), "Medium");
    });

    it("should resolve nested field (automationState.name)", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "automationState.name"), "Automated");
    });

    it("should resolve nested field (testSuite.id)", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "testSuite.id"), 453);
    });

    it("should resolve nested field (createdBy.username)", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "createdBy.username"), "maksim.sarychau");
    });

    it("should resolve custom field (customField.manualOnly)", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.manualOnly"), "No");
    });

    it("should resolve custom field (customField.caseStatus)", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.caseStatus"), "Implemented correctly");
    });

    it("should return undefined for nonexistent path", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "nonexistent"), undefined);
    });

    it("should return undefined for nonexistent nested path", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "priority.nonexistent"), undefined);
    });

    it("should return undefined for deeply nonexistent path", () => {
      assert.strictEqual(resolveFieldPath(SAMPLE_TC, "a.b.c.d"), undefined);
    });

    describe("fuzzy key resolution", () => {
      it("should resolve 'Manual Only' → manualOnly via camelCase", () => {
        assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.Manual Only"), "No");
      });

      it("should resolve 'manual_only' → manualOnly via case-insensitive", () => {
        assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.manual_only"), "No");
      });

      it("should resolve 'ManualOnly' → manualOnly via case-insensitive", () => {
        assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.ManualOnly"), "No");
      });

      it("should resolve 'MANUALONLY' → manualOnly via case-insensitive", () => {
        assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.MANUALONLY"), "No");
      });

      it("should resolve 'is_automated' → isAutomated via case-insensitive", () => {
        assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.is_automated"), "Yes");
      });

      it("should resolve 'Case Status' → caseStatus via camelCase", () => {
        assert.strictEqual(resolveFieldPath(SAMPLE_TC, "customField.Case Status"), "Implemented correctly");
      });
    });
  });

  describe("matchesField — exact mode", () => {
    it("should match custom field exact value (case-insensitive)", () => {
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", fieldValue: "yes", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_MANUAL, filter), true);
    });

    it("should not match wrong value", () => {
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", fieldValue: "yes", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });

    it("should match nested field exact", () => {
      const filter: FieldFilter = { fieldPath: "priority.name", fieldValue: "Medium", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should match top-level field exact", () => {
      const filter: FieldFilter = { fieldPath: "key", fieldValue: "MFPAND-180", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should match boolean as string", () => {
      const filter: FieldFilter = { fieldPath: "deprecated", fieldValue: "false", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should match number as string", () => {
      const filter: FieldFilter = { fieldPath: "testSuite.id", fieldValue: "453", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });
  });

  describe("matchesField — contains mode", () => {
    it("should match title substring", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "Nutrients", matchMode: "contains" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should match case-insensitive substring", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "nutrients", matchMode: "contains" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should not match non-contained substring", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "ZZZnoexist", matchMode: "contains" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });

    it("should match custom field substring", () => {
      const filter: FieldFilter = { fieldPath: "customField.caseStatus", fieldValue: "Implemented", matchMode: "contains" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should match email domain", () => {
      const filter: FieldFilter = { fieldPath: "createdBy.email", fieldValue: "@ext.myfitnesspal.com", matchMode: "contains" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });
  });

  describe("matchesField — regex mode", () => {
    it("should match regex pattern on title", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "\\[Diary\\].*food", matchMode: "regex" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should match regex on custom field", () => {
      const filter: FieldFilter = { fieldPath: "customField.testrailId", fieldValue: "^\\d+$", matchMode: "regex" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should not match failing regex", () => {
      const filter: FieldFilter = { fieldPath: "key", fieldValue: "^ZZZZZ", matchMode: "regex" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });

    it("should fall back to contains on invalid regex", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "[invalid", matchMode: "regex" };
      // Falls back to contains — "[invalid" not in the title
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });
  });

  describe("matchesField — exists mode", () => {
    it("should return true for existing field", () => {
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", matchMode: "exists" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should return false for nonexistent field", () => {
      const filter: FieldFilter = { fieldPath: "customField.nonexistent", matchMode: "exists" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });

    it("should return false for null field", () => {
      const filter: FieldFilter = { fieldPath: "description", matchMode: "exists" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });

    it("should return true for nested existing field", () => {
      const filter: FieldFilter = { fieldPath: "priority.name", matchMode: "exists" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });

    it("should return true for top-level field with falsy value", () => {
      const filter: FieldFilter = { fieldPath: "deprecated", matchMode: "exists" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), true);
    });
  });

  describe("matchesField — edge cases and safety", () => {
    it("should handle object without customField", () => {
      const obj = { id: 1, title: "Test" };
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), false);
    });

    it("should handle empty object", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "test", matchMode: "exact" };
      assert.strictEqual(matchesField({}, filter), false);
    });

    it("should handle object with different custom field structure", () => {
      const obj = {
        id: 1,
        customField: { someOtherField: "value", anotherField: 42 },
      };
      const filter: FieldFilter = { fieldPath: "customField.someOtherField", fieldValue: "value", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), true);
    });

    it("should handle numeric custom field values", () => {
      const obj = { id: 1, customField: { count: 42 } };
      const filter: FieldFilter = { fieldPath: "customField.count", fieldValue: "42", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), true);
    });

    it("should return false for null input", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "test", matchMode: "exact" };
      assert.strictEqual(matchesField(null as any, filter), false);
    });

    it("should return false for undefined input", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "test", matchMode: "exact" };
      assert.strictEqual(matchesField(undefined as any, filter), false);
    });

    it("should return false for string input instead of object", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "test", matchMode: "exact" };
      assert.strictEqual(matchesField("not an object" as any, filter), false);
    });

    it("should return false for number input instead of object", () => {
      const filter: FieldFilter = { fieldPath: "title", fieldValue: "test", matchMode: "exact" };
      assert.strictEqual(matchesField(42 as any, filter), false);
    });

    it("should handle null nested field (priority is null)", () => {
      const obj = { id: 1, priority: null };
      const filter: FieldFilter = { fieldPath: "priority.name", fieldValue: "High", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), false);
    });

    it("should handle undefined nested field (automationState missing)", () => {
      const obj = { id: 1, title: "Test" };
      const filter: FieldFilter = { fieldPath: "automationState.name", fieldValue: "Automated", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), false);
    });

    it("should handle customField set to null", () => {
      const obj = { id: 1, customField: null };
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), false);
    });

    it("should handle customField set to a string instead of object", () => {
      const obj = { id: 1, customField: "unexpected" };
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), false);
    });

    it("should handle customField set to an array", () => {
      const obj = { id: 1, customField: ["a", "b"] };
      const filter: FieldFilter = { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), false);
    });

    it("should handle boolean field value matching", () => {
      const obj = { id: 1, deprecated: true };
      const filter: FieldFilter = { fieldPath: "deprecated", fieldValue: "true", matchMode: "exact" };
      assert.strictEqual(matchesField(obj, filter), true);
    });

    it("should handle empty fieldPath gracefully", () => {
      const filter: FieldFilter = { fieldPath: "", fieldValue: "test", matchMode: "exact" };
      assert.strictEqual(matchesField(SAMPLE_TC, filter), false);
    });

    it("should handle filter with no fieldPath", () => {
      assert.strictEqual(matchesField(SAMPLE_TC, { fieldPath: "", matchMode: "exact" } as any), false);
    });

    it("should handle nested object value (stringify for matching)", () => {
      const obj = { id: 1, meta: { nested: { deep: "value" } } };
      const filter: FieldFilter = { fieldPath: "meta.nested", fieldValue: "deep", matchMode: "contains" };
      assert.strictEqual(matchesField(obj, filter), true);
    });
  });

  describe("filterByField", () => {
    const items = [SAMPLE_TC, SAMPLE_MANUAL];

    it("should filter by customField.manualOnly = Yes", () => {
      const result = filterByField(items, { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "MFPAND-999");
    });

    it("should filter by automationState.name = Automated", () => {
      const result = filterByField(items, { fieldPath: "automationState.name", fieldValue: "Automated", matchMode: "exact" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "MFPAND-180");
    });

    it("should filter by title contains", () => {
      const result = filterByField(items, { fieldPath: "title", fieldValue: "barcode", matchMode: "contains" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "MFPAND-999");
    });

    it("should return empty for no matches", () => {
      const result = filterByField(items, { fieldPath: "customField.manualOnly", fieldValue: "Maybe", matchMode: "exact" });
      assert.strictEqual(result.length, 0);
    });

    it("should return all for universal match", () => {
      const result = filterByField(items, { fieldPath: "customField.manualOnly", matchMode: "exists" });
      assert.strictEqual(result.length, 2);
    });

    it("should skip null items in the array", () => {
      const mixed = [SAMPLE_TC, null, SAMPLE_MANUAL, undefined] as any[];
      const result = filterByField(mixed, { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual(result[0].key, "MFPAND-999");
    });

    it("should handle items with missing customField", () => {
      const noCustom = { id: 1, key: "TEST-1", title: "No custom fields" };
      const mixed = [SAMPLE_TC, noCustom, SAMPLE_MANUAL];
      const result = filterByField(mixed, { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" });
      assert.strictEqual(result.length, 1);
    });

    it("should handle items with null priority", () => {
      const noPriority = { id: 1, key: "TEST-2", priority: null };
      const mixed = [SAMPLE_TC, noPriority];
      const result = filterByField(mixed, { fieldPath: "priority.name", fieldValue: "Medium", matchMode: "exact" });
      assert.strictEqual(result.length, 1);
    });

    it("should return empty for null input array", () => {
      const result = filterByField(null as any, { fieldPath: "title", fieldValue: "test", matchMode: "exact" });
      assert.strictEqual(result.length, 0);
    });

    it("should return empty for undefined filter", () => {
      const result = filterByField([SAMPLE_TC], undefined as any);
      assert.strictEqual(result.length, 0);
    });

    it("should handle heterogeneous items (different custom field shapes)", () => {
      const items = [
        { id: 1, customField: { manualOnly: "Yes", caseStatus: "Active" } },
        { id: 2, customField: { legacyFlag: "true" } },
        { id: 3, customField: null },
        { id: 4 },
        { id: 5, customField: { manualOnly: "No" } },
      ];
      const result = filterByField(items, { fieldPath: "customField.manualOnly", fieldValue: "Yes", matchMode: "exact" });
      assert.strictEqual(result.length, 1);
      assert.strictEqual((result[0] as any).id, 1);
    });
  });

  describe("discoverFieldPaths", () => {
    it("should discover all field paths on a test case", () => {
      const paths = discoverFieldPaths(SAMPLE_TC);
      assert.ok(paths.includes("id"), "Should include id");
      assert.ok(paths.includes("key"), "Should include key");
      assert.ok(paths.includes("title"), "Should include title");
      assert.ok(paths.includes("priority.name"), "Should include priority.name");
      assert.ok(paths.includes("automationState.name"), "Should include automationState.name");
      assert.ok(paths.includes("customField.manualOnly"), "Should include customField.manualOnly");
      assert.ok(paths.includes("customField.caseStatus"), "Should include customField.caseStatus");
      assert.ok(paths.includes("createdBy.username"), "Should include createdBy.username");
    });

    it("should respect maxDepth", () => {
      const nested = { a: { b: { c: { d: "deep" } } } };
      const shallow = discoverFieldPaths(nested, "", 0, 2);
      assert.ok(shallow.includes("a.b"), "Should include a.b");
      assert.ok(!shallow.includes("a.b.c.d"), "Should not include deeply nested");
    });
  });
});
