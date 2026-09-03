export type ToolCatalogEntry = {
  name: string;
  description: string;
  category?: string | null;
  examples?: string[];
};

export type RoleBenefit = { role: string; value: string };

const ADV_PREFIX = "adv_";
const ADV_DESC_PREFIX = "[Advanced Zebrunner MCP] ";

export function parseToolsJson(raw: string): ToolCatalogEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item: { name?: string }) => item && typeof item.name === "string")
      .map((item: { name: string; description?: string }) => ({
        name: item.name,
        description: typeof item.description === "string" ? item.description : "",
      }));
  } catch {
    return [];
  }
}

export function parseToolsCatalog(raw: string): Map<string, ToolCatalogEntry> {
  const result = new Map<string, ToolCatalogEntry>();
  if (!raw) return result;

  const lines = raw.split(/\r?\n/);
  let category: string | null = null;
  let current: ToolCatalogEntry | null = null;
  let inExamples = false;

  const flush = () => {
    if (current) result.set(current.name, current);
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      category = line.replace(/^##\s+/, "").trim();
      continue;
    }

    const toolMatch = line.match(/^###\s+`([^`]+)`/);
    if (toolMatch) {
      flush();
      current = {
        name: toolMatch[1],
        description: "",
        category,
        examples: [],
      };
      inExamples = false;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("**Description:**")) {
      current.description = line.replace("**Description:**", "").trim();
      continue;
    }

    if (line.startsWith("**Example Prompts:**")) {
      inExamples = true;
      continue;
    }

    if (line.startsWith("**") && !line.startsWith("**Example Prompts:**")) {
      inExamples = false;
      continue;
    }

    if (inExamples && line.trim().startsWith("- ")) {
      current.examples?.push(line.trim().replace(/^- /, ""));
    }
  }

  flush();
  return result;
}

export function parseRoleBenefits(raw: string): RoleBenefit[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const entries: RoleBenefit[] = [];
  let tableActive = false;

  for (const line of lines) {
    if (line.startsWith("| Role |")) {
      tableActive = true;
      continue;
    }
    if (!tableActive) continue;
    if (!line.startsWith("|")) break;
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 2 || cells[0] === "Role" || cells[0].startsWith("------")) continue;
    entries.push({
      role: cells[0].replace(/\*\*/g, ""),
      value: cells[1].replace(/\*\*/g, ""),
    });
  }

  return entries;
}

export function catalogMapToRecord(
  catalog: Map<string, ToolCatalogEntry>,
): Record<string, ToolCatalogEntry> {
  return Object.fromEntries(catalog.entries());
}

export function catalogRecordToMap(
  record: Record<string, ToolCatalogEntry> | undefined,
): Map<string, ToolCatalogEntry> {
  return new Map(Object.entries(record ?? {}));
}

export function shouldRegisterLegacyAliases(): boolean {
  const LEGACY_ALIAS_TRUTHY = ["1", "true", "yes", "on"];
  return LEGACY_ALIAS_TRUTHY.includes(
    (process.env.ZEBRUNNER_REGISTER_LEGACY_ALIASES ?? "").trim().toLowerCase(),
  );
}

/** Expand tools.json entries with catalog metadata; optionally add legacy alias rows. */
export function buildExpandedTools(
  tools: ToolCatalogEntry[],
  catalogByTool: Map<string, ToolCatalogEntry>,
  registerLegacyAliases: boolean,
): ToolCatalogEntry[] {
  const expanded: ToolCatalogEntry[] = [];

  for (const tool of tools) {
    const advName = tool.name.startsWith(ADV_PREFIX) ? tool.name : `${ADV_PREFIX}${tool.name}`;
    const legacyName = advName.slice(ADV_PREFIX.length);
    const catalog = catalogByTool.get(advName) ?? catalogByTool.get(legacyName);
    const baseDescription = catalog?.description || tool.description || "";
    const category = catalog?.category ?? null;
    const examples = catalog?.examples ?? [];

    expanded.push({
      name: advName,
      description: baseDescription.startsWith(ADV_DESC_PREFIX)
        ? baseDescription
        : `${ADV_DESC_PREFIX}${baseDescription}`,
      category,
      examples,
    });

    if (registerLegacyAliases) {
      expanded.push({
        name: legacyName,
        description: `[deprecated alias — use ${advName}] ${baseDescription.replace(ADV_DESC_PREFIX, "")}`,
        category,
        examples,
      });
    }
  }

  return expanded;
}
