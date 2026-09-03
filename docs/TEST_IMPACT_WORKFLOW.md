# Test Impact Analysis Workflow (v9.3.0)

Guide for developers using **`adv_analyze_test_impact`**, **`/test-impact`**, and **`/test-impact-period`** MCP prompts.

## Quick start

1. Connect Zebrunner MCP (`zbr-mfp` / `mcp-zebrunner`).
2. Inspect changes **locally** (git diff or `gh pr view`).
3. Call **`adv_analyze_test_impact`** once with compact change metadata — or invoke **`/test-impact`**.

Example utterance:

> Analyze which Zebrunner tests may be affected by my current code changes.

## PR workflow (Claude Code / Cursor)

```
/test-impact
project: PROJ2
pr_url: https://github.com/org/repo-android/pull/10630
```

The client should:

1. Run `gh pr view <url> --json title,body,files,...` locally.
2. Derive `features`, `behaviors`, `changed_symbols`, `keywords`.
3. Call `adv_analyze_test_impact` with `format: compact`.
4. Present regression (auto/manual) → new coverage needed → smoke → scoping notes.

**Do not** ask Zebrunner MCP to access Git or GitHub.

## Multi-PR workflow

Paste multiple PR URLs or invoke `/test-impact` with `pr_urls`:

```
/test-impact
project: PROJ2
pr_urls: https://github.com/org/repo-android/pull/10630, https://github.com/org/repo-android/pull/10612
```

Resolve each PR client-side (GitHub MCP, `gh pr view`, or manual), then call **`adv_analyze_test_impact` once** with `change_batches[]` — one object per PR (`id`, `source_url`, semantic fields).

## Period workflow (merged PRs in a sprint)

```
/test-impact-period
repo: org/repo-android
since: 2026-08-01
until: 2026-08-21
pr_state: merged
project: PROJ2
max_prs: 20
```

Client runs `gh pr list` or GitHub MCP, builds `change_batches[]`, single tool call.

## Output sections

| Section | Meaning |
|---------|---------|
| `regression.byTheme` | Existing cases to re-run, grouped by theme |
| `regression.byTheme[].automated` / `.manual` | Split by automation state; `sources` when using `change_batches` |
| `changeBatches` | Count and labels when batch mode was used |
| `newCoverageNeeded` | Potential coverage gaps (not proof of absence); includes `suggestedTestCase` draft (title + steps + suite/theme) |
| `recommendedSmokeSuites` | When infra keywords match config |
| `scopingNotes` | Why full suites were not recommended |

## Configuration

Set via `ZEBRUNNER_CONFIG_JSON` or `zebrunner-config.json` (see `.env.example`):

| Key | Purpose |
|-----|---------|
| `repositoryProjectMap` | Map repo folder → project key (`repo-android` → `PROJ2`) |
| `testImpactSmokeSuites` | Per-project smoke root suites when infra changes |
| `testImpactInfraKeywords` | Keywords that trigger smoke recommendations |

Generic example (placeholders):

```json
{
  "repositoryProjectMap": { "repo-android": "PROJ2" },
  "testImpactSmokeSuites": {
    "PROJ2": [{ "rootSuiteId": 100, "name": "Smoke Suite", "reason": "Core nav changes" }]
  }
}
```

## Fallback (manual skill)

If the tool returns thin results, you may still use:

- `adv_get_test_case_by_title` for additional feature words
- `adv_get_root_suites` + `adv_get_suite_hierarchy` for scoping

Avoid `adv_get_test_cases_by_suite_smart` on large suites unless necessary.

## Creating a Cursor / Claude Code skill

Copy [docs/skills/zebrunner-test-impact-SKILL.md](skills/zebrunner-test-impact-SKILL.md) into your app repo under `.cursor/skills/zebrunner-test-impact/SKILL.md`.

## Limitations

- No git/GitHub inside MCP.
- Returns `automationState` only — no invented test class/method mappings.
- Title search may miss step-only matches; enrichment uses steps for scoring when cases are in the shortlist.

## Multi-PR / period analysis (design)

For sprint rollups, multiple pasted PR URLs, or merged/open PR lists — see [TEST_IMPACT_PR_PERIOD_DESIGN.md](TEST_IMPACT_PR_PERIOD_DESIGN.md). Supports `gh`, GitHub MCP, or manual metadata; Zebrunner tool contract unchanged in v9.2.9.
