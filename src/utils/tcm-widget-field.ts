import type { FieldsLayout, FieldLayoutItem } from '../api/reporting-client.js';
import { HierarchyProcessor } from './hierarchy.js';
import type { ZebrunnerTestSuite } from '../types/core.js';

/** Zebrunner systemFieldDataType values for distribution widget. */
export const SYSTEM_FIELD_DATA_TYPES = [
  'AUTOMATION_STATE',
  'PRIORITY',
  'AUTHOR',
  'CASE_STATUS',
  'MANUAL_ONLY',
  'TESTRAIL_CASE_TYPE',
] as const;

export type SystemFieldDataType = (typeof SYSTEM_FIELD_DATA_TYPES)[number];

/** UI / fields-layout name → API systemFieldDataType */
export const SYSTEM_FIELD_NAME_MAP: Record<string, SystemFieldDataType> = {
  'automation state': 'AUTOMATION_STATE',
  'priority': 'PRIORITY',
  'author': 'AUTHOR',
  'case status': 'CASE_STATUS',
  'manual only': 'MANUAL_ONLY',
  'testrail case type': 'TESTRAIL_CASE_TYPE',
};

export type DistributionFieldFilter =
  | { field: { systemFieldDataType: SystemFieldDataType } }
  | { field: { customFieldId: number } };

export interface ResolvedDistributionField {
  filter: DistributionFieldFilter;
  fieldLabel: string;
  fieldType: 'system' | 'custom';
  customFieldId?: number;
  systemFieldDataType?: SystemFieldDataType;
}

export interface ResolveDistributionFieldInput {
  field?: string;
  system_field?: SystemFieldDataType;
  custom_field_id?: number;
}

function findFieldByName(fieldsLayout: FieldsLayout, name: string): FieldLayoutItem | undefined {
  const norm = name.trim().toLowerCase();
  return fieldsLayout.fields.find(f => f.name.trim().toLowerCase() === norm);
}

function systemDataTypeFromField(item: FieldLayoutItem): SystemFieldDataType | undefined {
  const byName = SYSTEM_FIELD_NAME_MAP[item.name.trim().toLowerCase()];
  if (byName) return byName;
  const dt = (item.dataType || '').toUpperCase();
  if (SYSTEM_FIELD_DATA_TYPES.includes(dt as SystemFieldDataType)) {
    return dt as SystemFieldDataType;
  }
  return undefined;
}

/**
 * Resolve distribution widget `filters.field` from tool args + fields-layout.
 * Mutually exclusive: custom_field_id | system_field | field name lookup.
 */
export function resolveDistributionField(
  input: ResolveDistributionFieldInput,
  fieldsLayout: FieldsLayout,
): ResolvedDistributionField {
  const provided = [
    input.custom_field_id != null,
    input.system_field != null,
    input.field != null && input.field.trim() !== '',
  ].filter(Boolean).length;

  if (provided === 0) {
    throw new Error('Provide one of: field (display name), system_field, or custom_field_id');
  }
  if (provided > 1) {
    throw new Error('Use only one of: field, system_field, or custom_field_id');
  }

  if (input.custom_field_id != null) {
    const match = fieldsLayout.fields.find(f => f.id === input.custom_field_id);
    return {
      filter: { field: { customFieldId: input.custom_field_id } },
      fieldLabel: match?.name ?? `customField:${input.custom_field_id}`,
      fieldType: 'custom',
      customFieldId: input.custom_field_id,
    };
  }

  if (input.system_field != null) {
    const match = fieldsLayout.fields.find(f => systemDataTypeFromField(f) === input.system_field);
    return {
      filter: { field: { systemFieldDataType: input.system_field } },
      fieldLabel: match?.name ?? input.system_field,
      fieldType: 'system',
      systemFieldDataType: input.system_field,
    };
  }

  const item = findFieldByName(fieldsLayout, input.field!);
  if (!item) {
    throw new Error(`Field "${input.field}" not found in project fields-layout`);
  }

  if (item.type === 'SYSTEM') {
    const systemType = systemDataTypeFromField(item);
    if (!systemType) {
      throw new Error(`Cannot map system field "${item.name}" to systemFieldDataType`);
    }
    return {
      filter: { field: { systemFieldDataType: systemType } },
      fieldLabel: item.name,
      fieldType: 'system',
      systemFieldDataType: systemType,
    };
  }

  return {
    filter: { field: { customFieldId: item.id } },
    fieldLabel: item.name,
    fieldType: 'custom',
    customFieldId: item.id,
  };
}

function collectDescendantIds(suites: ZebrunnerTestSuite[], rootId: number): number[] {
  const ids: number[] = [];
  function walk(parentId: number) {
    for (const s of suites) {
      if (s.parentSuiteId === parentId && s.id !== parentId) {
        ids.push(s.id);
        walk(s.id);
      }
    }
  }
  walk(rootId);
  return ids;
}

/** Merge explicit suite IDs with expanded root suites (deduped). */
export function expandSuiteIds(
  allSuites: ZebrunnerTestSuite[],
  rootSuiteIds: number[],
  explicitIds: number[],
  expandDescendants = true,
): number[] {
  const out = new Set<number>(explicitIds);

  if (rootSuiteIds.length === 0) {
    return [...out];
  }

  const processed = HierarchyProcessor.setRootParentsToSuites(allSuites);

  for (const rootId of rootSuiteIds) {
    out.add(rootId);
    if (expandDescendants) {
      for (const id of collectDescendantIds(processed, rootId)) {
        out.add(id);
      }
    }
  }

  return [...out];
}

/** First enabled boolean custom field from fields-layout (for API smoke discovery). */
export function findFirstBooleanCustomField(fieldsLayout: FieldsLayout): FieldLayoutItem | undefined {
  return fieldsLayout.fields.find(
    f => f.type === 'CUSTOM' && f.enabled && f.dataType?.toLowerCase() === 'boolean',
  );
}

/** Field named "Manual Only" (case-insensitive). */
export function findManualOnlyField(fieldsLayout: FieldsLayout): FieldLayoutItem | undefined {
  return fieldsLayout.fields.find(
    f => f.enabled && f.name.trim().toLowerCase() === 'manual only',
  );
}
