# Test Impact — Multi-PR and Period Analysis

**Status:** Implemented (v9.3.0). Tier 1 prompts + Tier 2 `change_batches[]` on `adv_analyze_test_impact`.

Companion to [TEST_IMPACT_WORKFLOW.md](TEST_IMPACT_WORKFLOW.md).

---

## 1. Problem statement

Teams need test impact analysis across:

- **One PR** — paste a link, run impact before merge
- **Several PRs** — paste multiple URLs or analyze a release branch delta
- **A time window** — all merged, open, or all PRs in a sprint (e.g. “merged in repo-android since Aug 1”)

Clients differ: some use **`gh`**, some use **GitHub MCP**, some only paste **PR URLs** or manual descriptions.

---

## 2. Architecture constraint

**Zebrunner MCP never runs git or GitHub.**

The client (Cursor, Claude Code, Claude Desktop, etc.) is responsible for:

1. Discovering PR metadata (any available tool)
2. Deriving **compact semantic change context** per PR
3. Calling `adv_analyze_test_impact` with that metadata

Zebrunner receives only: `change_summary`, `features`, `behaviors`, `changed_symbols`, `changed_files`, `keywords` — **not** raw git diffs.

---

## 3. Client resolver decision tree

```
User request
├── Paste 1+ PR URL(s)
│   ├── GitHub MCP available → fetch PR title, body, files
│   ├── gh available → gh pr view <url> --json title,body,files
│   └── Neither → ask user for PR title, description, changed files
├── Period query (merged / open / all + date range)
│   ├── gh → gh pr list --search "merged:>=DATE" ...
│   ├── GitHub MCP → search/list PRs with equivalent filters
│   └── Neither → ask user to list PR URLs or paste sprint notes
└── Manual (no GitHub)
    └── User provides behaviors, symbols, file names → existing single-context flow
```

**Rule:** Pick the first resolver that works. Never fail solely because `gh` is missing.

---

## 4. Recipes

### 4.1 Single PR — pasted URL

**User:**

> Analyze test impact for https://github.com/org/repo-android/pull/10630

**Client (gh):**

```bash
gh pr view "https://github.com/org/repo-android/pull/10630" \
  --json title,body,files,additions,deletions
```

**Client (GitHub MCP):** Use PR fetch/search tools for the same fields.

Then call `adv_analyze_test_impact` once with derived metadata.

### 4.2 Multiple pasted PR URLs

**User:**

```
Analyze test impact for:
https://github.com/org/repo-android/pull/10630
https://github.com/org/repo-android/pull/10612
```

**Client:** Loop each URL through §4.1, build one change context per PR.

**Today (v9.3.0):** Single call with `change_batches[]` (see §7). `/test-impact` supports `pr_urls`; `/test-impact-period` lists PRs client-side then batches.

### 4.3 Period — merged PRs (`gh`)

```bash
gh pr list --repo org/repo-android --state merged \
  --search "merged:>=2026-08-01 merged:<=2026-08-21" \
  --limit 50 \
  --json number,title,url,mergedAt,files
```

For each result:

```bash
gh pr view <number> --json title,body,files
```

### 4.4 Period — open PRs (`gh`)

```bash
gh pr list --repo org/repo-android --state open \
  --search "created:>=2026-08-01" \
  --limit 50 \
  --json number,title,url,files
```

### 4.5 Period — GitHub MCP

Use GitHub MCP list/search PR tools with:

- `state`: `open` | `closed` | `merged` (as supported)
- Date filters equivalent to `gh` search qualifiers
- Repo: `org/repo-android`

Fetch per-PR details; same compact metadata extraction as §4.1.

### 4.6 Manual fallback

No GitHub tools: user provides PR title, changed files, behavior bullets. Pass directly to `adv_analyze_test_impact` — unchanged from v9.2.8.

---

## 5. Tool contract (v9.3.0)

`adv_analyze_test_impact` accepts a **single** change context **or** optional **`change_batches[]`** (max 20):

| Field | Purpose |
|-------|---------|
| `project_key` / `repository_slug` | Platform resolution |
| `change_summary` | Short behavior summary |
| `features`, `behaviors` | Product areas |
| `changed_symbols`, `changed_files`, `keywords` | Search phrases |

| `change_batches` | Multi-PR / period rollup (each batch = one PR's compact metadata) |

Returns: `regression.byTheme` (with optional `sources` per case), `changeBatches`, `newCoverageNeeded`, `recommendedSmokeSuites`, `scopingNotes`.

---

## 6. Tier 1 (shipped v9.3.0)

- `/test-impact` prompt: `pr_url` + `pr_urls` (multiple)
- `/test-impact-period` prompt: `repo`, `since`, `until`, `pr_state`, `max_prs`
- [skills/zebrunner-test-impact-SKILL.md](skills/zebrunner-test-impact-SKILL.md) resolver decision tree

---

## 7. Tier 2 (shipped v9.3.0)

Optional **`change_batches[]`** on `adv_analyze_test_impact` (omit = single-context behavior):

```ts
change_batches?: Array<{
  id?: string;           // e.g. "10630"
  label?: string;        // PR title snippet
  source_url?: string;   // attribution only — MCP does NOT fetch
  merged_at?: string;
  change_summary?: string;
  features?: string[];
  behaviors?: string[];
  changed_symbols?: string[];
  changed_files?: string[];
  keywords?: string[];
}>;
```

**Server aggregation:**

- Merge + dedupe search phrases (raise cap e.g. 8 → 24 in batch mode)
- Single Zebrunner retrieval pass (`max_candidates` bounded)
- Tag candidates: `sources: ["PR#10630", "PR#10612"]`
- Boost score when multiple batches match same test case
- Union `newCoverageNeeded` with source tags

**Defaults:** `max_batches: 20`; client caps period PR list before sending.

---

## 8. Non-goals

- Zebrunner MCP calling GitHub API or running `git` / `gh`
- Ingesting full raw diffs into the tool
- Replacing manual title-search workflow (remains valid fallback)

---

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| 50+ PRs in one period | `max_prs` cap; filter by path prefix; exclude `dependencies`/`chore` labels |
| No gh and no GitHub MCP | Manual paste or ask user for PR metadata |
| Zebrunner API load | One retrieval pass per batch call (Tier 2), not per PR |
| Token budget | `format: compact`; omit `include_steps_in_output` in batch mode |
| Noisy infra PRs | Client-side label/path filters before building contexts |

---

## 10. Test coverage (v9.3.0)

| Layer | Coverage |
|-------|----------|
| **Unit** | Batch phrase merge cap, dedupe, `sources` tagging, backward compat when `change_batches` omitted |
| **Eval L2** | `test_impact.multi_pr_urls`, `test_impact.period_merged` (routing only) |
| **Eval L3** | Optional execution with mocked `change_batches` |
| **Docs** | `TEST_PROMPTS.md`, skill template, workflow cross-links |

---

## Related

- [TEST_IMPACT_WORKFLOW.md](TEST_IMPACT_WORKFLOW.md) — current single-PR / local diff workflow
- [skills/zebrunner-test-impact-SKILL.md](skills/zebrunner-test-impact-SKILL.md) — copy into app repos
