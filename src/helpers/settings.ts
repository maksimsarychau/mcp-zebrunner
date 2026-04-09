import type { ZebrunnerMutationClient } from "../api/mutation-client.js";

// --------------- Types ---------------

export interface SettingsItem {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface CustomFieldDef {
  id: number;
  systemName: string;
  name: string;
  enabled: boolean;
  dataType:
    | "DATE"
    | "DROPDOWN"
    | "MULTI_SELECT"
    | "STRING"
    | "TEXT"
    | "URI"
    | "USER";
  valueDefinition: unknown;
}

// --------------- Validators (pure — no network) ---------------

/**
 * Validates an { id } or { name } reference against a fetched settings list.
 * Throws a descriptive error listing valid options if the reference is invalid.
 */
export function validateIdOrName(
  value: { id?: number; name?: string },
  items: SettingsItem[],
  fieldLabel: string,
): void {
  if (value.id !== undefined) {
    if (!items.some((i) => i.id === value.id)) {
      const valid = items.map((i) => `${i.id} (${i.name})`).join(", ");
      throw new Error(
        `Invalid ${fieldLabel} id: ${value.id}. Valid options: ${valid}`,
      );
    }
  } else if (value.name !== undefined) {
    if (!items.some((i) => i.name === value.name)) {
      const valid = items.map((i) => i.name).join(", ");
      throw new Error(
        `Invalid ${fieldLabel} name: "${value.name}". Valid options: ${valid}`,
      );
    }
  }
}

/**
 * Validates all keys in a customField object against project-specific definitions.
 * - Key must be a known systemName
 * - Field must be enabled
 * - Value format must match the field's dataType
 * Throws a descriptive error on the first violation found.
 */
export function validateCustomFields(
  customField: Record<string, unknown>,
  fieldDefs: CustomFieldDef[],
): void {
  const defMap = new Map(fieldDefs.map((f) => [f.systemName, f]));

  for (const [key, value] of Object.entries(customField)) {
    const def = defMap.get(key);

    if (!def) {
      const validKeys = fieldDefs
        .filter((f) => f.enabled)
        .map((f) => f.systemName)
        .join(", ");
      throw new Error(
        `Unknown custom field systemName: "${key}". Valid keys: ${validKeys}`,
      );
    }

    if (!def.enabled) {
      throw new Error(
        `Custom field "${key}" is disabled and cannot be used`,
      );
    }

    if (value === null || value === undefined) continue;

    switch (def.dataType) {
      case "STRING":
      case "TEXT":
      case "URI":
        if (typeof value !== "string") {
          throw new Error(
            `Custom field "${key}" (${def.dataType}) must be a string`,
          );
        }
        break;
      case "DROPDOWN":
        if (typeof value !== "string") {
          throw new Error(
            `Custom field "${key}" (DROPDOWN) must be a string option name`,
          );
        }
        break;
      case "MULTI_SELECT":
        if (
          !Array.isArray(value) ||
          !value.every((v) => typeof v === "string")
        ) {
          throw new Error(
            `Custom field "${key}" (MULTI_SELECT) must be an array of strings`,
          );
        }
        break;
      case "DATE":
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          throw new Error(
            `Custom field "${key}" (DATE) must be a "YYYY-MM-DD" string`,
          );
        }
        break;
      case "USER":
        if (
          typeof value !== "object" ||
          Array.isArray(value) ||
          !["id", "email", "username"].some(
            (k) => (value as Record<string, unknown>)[k] != null,
          )
        ) {
          throw new Error(
            `Custom field "${key}" (USER) must be an object with at least one of: id, email, username`,
          );
        }
        break;
    }
  }
}

// --------------- Fetch + Validate (requires network) ---------------

/**
 * Fetches automation states, priorities, and custom fields for a project,
 * then validates the provided arguments against them.
 * Caches settings within a single call to avoid redundant requests.
 */
export async function validateMutationSettings(
  projectKey: string,
  mutationClient: ZebrunnerMutationClient,
  args: {
    automationState?: { id?: number; name?: string };
    priority?: { id?: number; name?: string };
    customField?: Record<string, unknown>;
  },
): Promise<void> {
  const tasks: Array<Promise<void>> = [];

  if (args.automationState) {
    tasks.push(
      mutationClient.getAutomationStates(projectKey).then((res) => {
        validateIdOrName(args.automationState!, res.items as SettingsItem[], "automationState");
      }),
    );
  }

  if (args.priority) {
    tasks.push(
      mutationClient.getPriorities(projectKey).then((res) => {
        validateIdOrName(args.priority!, res.items as SettingsItem[], "priority");
      }),
    );
  }

  if (args.customField && Object.keys(args.customField).length > 0) {
    tasks.push(
      mutationClient.getCustomFields(projectKey).then((res) => {
        validateCustomFields(args.customField!, res.items as unknown as CustomFieldDef[]);
      }),
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}
