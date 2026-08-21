# Test Impact Analysis Workflow (v9.2.8)

Guide for developers using **`adv_analyze_test_impact`** and the **`/test-impact`** MCP prompt.

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

## Output sections

| Section | Meaning |
|---------|---------|
| `regression.byTheme` | Existing cases to re-run, grouped by theme |
| `regression.byTheme[].automated` / `.manual` | Split by automation state |
| `newCoverageNeeded` | Potential coverage gaps (not proof of absence) |
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
