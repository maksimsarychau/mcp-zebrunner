---
name: zebrunner-test-impact
description: >-
  Analyze PR or local code changes and find Zebrunner test cases to run for
  regressions and new coverage gaps. Use when the user mentions test impact,
  PR test planning, which tests to run, regression coverage, or Zebrunner +
  pull request / code changes.
---

# Zebrunner Test Impact (Claude Code / Cursor skill)

Copy this file into your app repo as `.cursor/skills/zebrunner-test-impact/SKILL.md` (or use as a Claude Code project skill).

## Setup

- Connect the Zebrunner MCP server (`zbr-mfp` or `mcp-zebrunner`). Reconnect via `/mcp` if tools drop from the session.
- For PR workflows, ensure `gh` is authenticated locally.

## Workflow

1. **Read changes locally** — never ask Zebrunner MCP to run git or access GitHub.
   - PR: `gh pr view <url> --json title,body,files,additions,deletions`
   - Local: inspect git diff vs base branch
2. **Summarize** into compact metadata: `change_summary`, `features`, `behaviors`, `changed_symbols`, `changed_files`, `keywords`. Do not send huge raw diffs.
3. **Resolve platform:** pass `project_key` or `repository_slug` (workspace folder name mapped in `repositoryProjectMap`).
4. **Call once:** `adv_analyze_test_impact` (or invoke `/test-impact` prompt).
5. **Do not chain** `adv_get_test_cases_by_suite_smart`, `adv_aggregate_test_cases_by_feature`, or multiple `adv_get_test_case_by_title` unless the impact tool returns insufficient results.
6. **Present:**
   - A. Regression — by theme, automated vs manual, confidence, links
   - B. New functionality to verify (`newCoverageNeeded`)
   - C. Recommended smoke suites (if any)
   - D. Scoping notes

## Example prompt

> Analyze test impact for my PR. Project PROJ2. Include automated and manual cases separately.
>
> PR: https://github.com/org/repo-android/pull/1234

## Config

See `docs/TEST_IMPACT_WORKFLOW.md` in mcp-zebrunner and `.env.example` `ZEBRUNNER_CONFIG_JSON` for `repositoryProjectMap` / `testImpactSmokeSuites`.
