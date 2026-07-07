# Token efficiency guide (v9.2.0+)

Large Zebrunner exports (thousands of test cases with steps, preconditions, and metadata) can consume **hundreds of thousands of tokens** in a single MCP response. v9.2.0 adds **opt-in** knobs to shrink payloads without changing default behavior for existing integrations.

> **Defaults unchanged:** `format=json`, `detail=full`, `max_results=5000`, suite-smart `get_all=true`, reports `inline=true`. Enable compact/summary explicitly in prompts or via env flags below.

---

## Recommended workflow

```text
1. List / filter  →  detail=summary  +  format=compact  (or adv_batch_get_test_cases)
2. Shortlist      →  pick keys you care about
3. Full body      →  adv_get_test_case_by_key  (steps, preconditions — mutation source of truth)
4. Mutate         →  adv_create_test_case / adv_update_test_case
```

**Rule of thumb:** Never pull full step bodies for every case in a project when you only need a table of keys and titles.

---

## `format: compact` vs `json`

| Value | Output | Typical savings |
|-------|--------|-----------------|
| `json` | Pretty-printed JSON (`null, 2`) | Baseline (default) |
| `compact` | Minified JSON (no extra whitespace) | ~15–25% fewer bytes vs pretty `json` |
| `dto` | Raw structured object (no stringify) | Use when the client handles objects natively |
| `string` / `markdown` | Human-readable text | Best for chat display, not bulk analytics |

### Natural-language prompts

- *"List all test cases in project MCP with **compact JSON**."*
- *"Get suite 18824 cases as **minified JSON** (`format=compact`)."*
- *"Fetch launches for MCP in **compact** format."*

### Tools that support `format: compact` (data family)

| Tool | Notes |
|------|--------|
| `adv_list_test_suites` | Also supports `detail` / `fields` |
| `adv_get_test_case_by_key` | Pair with `detail=summary` for metadata-only |
| `adv_get_all_tcm_test_cases_by_project` | Best with `detail=summary` |
| `adv_get_test_cases_by_suite_smart` | Best with `detail=summary` |
| `adv_batch_get_test_cases` | **Defaults** to `format=compact` |
| `adv_get_all_tcm_test_cases_with_root_suite_id` | Large — prefer `count_only=true` first |

### Launch listing (`raw` / `formatted` / `compact`)

| Tool | `compact` meaning |
|------|-------------------|
| `adv_get_all_launches_for_project` | Minified JSON launch list |
| `adv_get_all_launches_with_filter` | Same |

---

## `detail: summary` vs `full`

| Value | Test case fields kept | When to use |
|-------|----------------------|-------------|
| `summary` | `id`, `key`, `title`, `priority`, `automationState`, `deprecated`, `webUrl` | Filtering, dashboards, picking keys |
| `full` | All API fields including steps (default) | Before create/update mutations |

Suite projection (`adv_list_test_suites`): `summary` keeps `id`, `title`, `name`, `parentSuiteId`, `rootSuiteId`, `testCasesCount`, `webUrl`.

Optional **`fields`** array overrides `detail` with an explicit allow-list.

### Natural-language prompts

- *"Get all cases in suite 18824 with **summary detail only** — I'll fetch full bodies later."*
- *"Export project MCP test cases with **summary fields**, not full step bodies."*
- *"Use `adv_batch_get_test_cases` for MCP-1 and MCP-2 with **summary** and **compact** JSON."*

### Tools with `detail`

| Tool | Default `detail` |
|------|------------------|
| `adv_list_test_suites` | `full` |
| `adv_get_test_case_by_key` | `full` (keep for mutations) |
| `adv_get_all_tcm_test_cases_by_project` | `full` |
| `adv_get_test_cases_by_suite_smart` | `full` |
| `adv_batch_get_test_cases` | `summary` |

### Bulk extras

| Parameter | Tool | Purpose |
|-----------|------|---------|
| `count_only=true` | Bulk TCM / suite tools | Count only — no case payload |
| `include_root_suite=true` | `adv_get_all_tcm_test_cases_by_project` | Add `rootSuiteId` without a second hierarchy call |
| `max_results` | `adv_get_all_tcm_test_cases_by_project` | Cap rows (default 5000) |

---

## `adv_batch_get_test_cases` (new in 9.2.0)

Fetch up to **50** test cases in one call with **partial success** (`notFound[]` for missing keys).

**Defaults:** `detail=summary`, `format=compact`, concurrency cap 5.

### Example (conceptual args)

```json
{
  "project_key": "MCP",
  "case_keys": ["MCP-1", "MCP-2", "MCP-99"],
  "detail": "summary",
  "format": "compact"
}
```

### Natural-language prompts

- *"Fetch MCP-1 and MCP-2 in **one batch call** with summary detail and compact JSON."*
- *"Use **adv_batch_get_test_cases** — do not call adv_get_test_case_by_key separately for each key."*

---

## Reports: `inline: false`

`adv_generate_report` defaults to `inline=true` (HTML + PNG embedded in the MCP response). For executive dashboards this can be **megabytes**.

| Setting | Behavior |
|---------|----------|
| `inline: true` (default) | HTML/PNG in response |
| `inline: false` | Writes to `<tmpdir>/zebrunner-reports/` or `output_dir`; returns file paths |

### Natural-language prompt

- *"Generate a quality dashboard for MCP with **inline false** — save HTML to disk and return paths."*

---

## Duplicate analysis caps

`adv_analyze_test_cases_duplicates` JSON/`dto` output caps large clusters (top 20, `stepCount` instead of full steps) to stay under MCP size limits. Use `format=string` or `markdown` for human-readable full narratives when needed.

---

## Response-size notices

Bulk reads near ~800 KB may include a `_notice` field suggesting `detail=summary`, `count_only`, or lower `max_results`. stderr also logs per-tool telemetry:

```text
[telemetry] tool=adv_get_all_tcm_test_cases_by_project responseBytes=… approxTokens=…
```

---

## Server env flags (optional)

Set on the **MCP server** process (not eval-only):

| Env | Effect when `true` |
|-----|-------------------|
| `MCP_COMPACT_DEFAULTS` | Default `format` becomes `compact` instead of `json` |
| `MCP_SUMMARY_DEFAULTS` | Default `detail` becomes `summary` on supported bulk reads |

**Off by default** until cloud eval gates pass. Prefer explicit args in prompts for predictable assistant behavior.

---

## Quick comparison

| Goal | Call |
|------|------|
| Smallest project-wide list | `adv_get_all_tcm_test_cases_by_project` + `detail=summary` + `format=compact` |
| Suite shortlist | `adv_get_test_cases_by_suite_smart` + `detail=summary` + `format=compact` |
| N known keys | `adv_batch_get_test_cases` |
| Count only | any bulk tool + `count_only=true` |
| Full body for one case | `adv_get_test_case_by_key` (default `detail=full`) |
| Huge dashboard | `adv_generate_report` + `inline=false` |

---

## Related docs

- [TOOLS_CATALOG.md](../TOOLS_CATALOG.md) — per-tool parameters
- [RESOURCES_AND_PROMPTS.md](RESOURCES_AND_PROMPTS.md) — `zebrunner://formats` resource
- [change-logs.md](../change-logs.md) — v9.2.0 changelog and upgrade checklist
