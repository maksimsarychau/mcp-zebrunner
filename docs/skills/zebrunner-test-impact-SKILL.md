---
name: zebrunner-test-impact
description: >-
  Analyze PR or local code changes and find Zebrunner test cases to run for
  regressions and new coverage gaps. Use when the user mentions test impact,
  PR test planning, which tests to run, regression coverage, sprint PR rollups,
  or Zebrunner + pull request / code changes.
---

# Zebrunner Test Impact (Claude Code / Cursor skill)

Copy this file into your app repo as `.cursor/skills/zebrunner-test-impact/SKILL.md` (or use as a Claude Code project skill).

## Setup

- Connect the Zebrunner MCP server (`zbr-mfp` or `mcp-zebrunner`). Reconnect via `/mcp` if tools drop from the session.
- For PR workflows, use **GitHub MCP** and/or **`gh`** when available — neither is required if the user pastes PR metadata.

## Resolver decision tree

Pick the **first** option that works (Zebrunner MCP never runs git/GitHub):

1. **Pasted PR URL(s)** → GitHub MCP fetch **or** `gh pr view <url> --json title,body,files` **or** ask user for title/files
2. **Period query** (merged/open PRs + dates) → `gh pr list` **or** GitHub MCP list/search **or** user pastes URLs
3. **Local changes** → git diff vs base branch **or** user describes behaviors/files

## Workflow

1. **Read changes locally** — never ask Zebrunner MCP to run git or access GitHub.
2. **Summarize** into compact metadata per PR: `change_summary`, `features`, `behaviors`, `changed_symbols`, `changed_files`, `keywords`. Do not send huge raw diffs.
3. **Resolve platform:** pass `project_key` or `repository_slug` (workspace folder name mapped in `repositoryProjectMap`).
4. **Call once:**
   - Single PR / local diff → top-level fields on `adv_analyze_test_impact` (or `/test-impact`)
   - Multiple PRs or period → `change_batches[]` (max 20), one object per PR with `id`, `source_url`, semantic fields
   - Period listing → `/test-impact-period` then single tool call with batches
5. **Do not chain** `adv_get_test_cases_by_suite_smart`, `adv_aggregate_test_cases_by_feature`, or multiple `adv_get_test_case_by_title` unless the impact tool returns insufficient results.
6. **Present:**
   - A. Regression — by theme, automated vs manual, confidence, `sources` (batch mode), links
   - B. New functionality to verify (`newCoverageNeeded`)
   - C. Recommended smoke suites (if any)
   - D. Scoping notes

## Example prompts

Single PR:

> Analyze test impact for my PR. Project PROJ2. PR: https://github.com/org/repo-android/pull/1234

Multiple PRs:

> /test-impact project: PROJ2 pr_urls: https://github.com/org/repo/pull/1, https://github.com/org/repo/pull/2

Period:

> /test-impact-period repo: org/repo-android since: 2026-08-01 until: 2026-08-21 pr_state: merged project: PROJ2

## Config

See `docs/TEST_IMPACT_WORKFLOW.md` in mcp-zebrunner and `.env.example` `ZEBRUNNER_CONFIG_JSON` for `repositoryProjectMap` / `testImpactSmokeSuites`.

## Reference

- [TEST_IMPACT_WORKFLOW.md](https://github.com/maksimsarychau/mcp-zebrunner/blob/main/docs/TEST_IMPACT_WORKFLOW.md)
- [TEST_IMPACT_PR_PERIOD_DESIGN.md](https://github.com/maksimsarychau/mcp-zebrunner/blob/main/docs/TEST_IMPACT_PR_PERIOD_DESIGN.md)
