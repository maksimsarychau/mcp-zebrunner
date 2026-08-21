import { getConfig } from "./config-loader.js";

export interface ProjectResolution {
  projectKey: string;
  source: "project_key" | "repository_map" | "alias" | "passthrough";
}

/** Normalize repo slug to basename, lowercased. */
export function normalizeRepositorySlug(slug: string): string {
  const trimmed = slug.trim().replace(/\\/g, "/");
  const base = trimmed.split("/").filter(Boolean).pop() ?? trimmed;
  return base.toLowerCase();
}

export function resolveImpactProjectKey(
  projectKey?: string,
  repositorySlug?: string,
): ProjectResolution | { error: string } {
  const cfg = getConfig();

  if (projectKey?.trim()) {
    const raw = projectKey.trim();
    const alias = cfg.projectAliases[raw.toLowerCase()] ?? cfg.projectAliases[raw];
    if (alias) return { projectKey: alias, source: "alias" };
    return { projectKey: raw, source: "project_key" };
  }

  if (repositorySlug?.trim()) {
    const slug = normalizeRepositorySlug(repositorySlug);
    const fromRepo = Object.entries(cfg.repositoryProjectMap).find(
      ([k]) => k.toLowerCase() === slug,
    );
    if (fromRepo) {
      return { projectKey: fromRepo[1], source: "repository_map" };
    }
    const fromAlias = cfg.projectAliases[slug];
    if (fromAlias) return { projectKey: fromAlias, source: "alias" };
    return { projectKey: slug.toUpperCase(), source: "passthrough" };
  }

  const configuredSlugs = Object.keys(cfg.repositoryProjectMap);
  return {
    error:
      `project_key or repository_slug is required. ` +
      (configuredSlugs.length
        ? `Configured repository slugs: ${configuredSlugs.join(", ")}. `
        : "") +
      `Use adv_get_available_projects to list projects.`,
  };
}
