---
name: zebrunner-jira-automation-plan
description: >-
  Build Jira automation parent tasks and per-test-case subtasks from a Zebrunner
  suite URL. Use when the user mentions QAT-32410, Jira automation intake, QAS
  automation tasks, suite link to Jira, adv_prepare_jira_automation_plan, or
  /jira-automation-plan.
---

# Zebrunner → Jira automation plan (QAT-32410)

Copy this file into your app repo as `.cursor/skills/zebrunner-jira-automation-plan/SKILL.md` (or use as a Claude Code project skill).

**Driving ticket:** QAT-32410 — auto-create Jira automation tasks from a Zebrunner test suite link.

## Setup

- **Zebrunner MCP** (`mcp-zebrunner` / `zbr-*`) — plan tool only; reconnect via `/mcp` if tools drop.
- **Atlassian MCP** — required for dedup, preview approval, and issue create (this server has **no Jira credentials**).
- Optional: set `jiraAutomationPlan` in `zebrunner-config.json` (`targetProject` default **QAS**, `platformByProjectKey`, components, `analyticsTagMatch`).

## Mode picker

| User goal | What to use |
|-----------|-------------|
| Plan JSON/markdown only, no Jira | `adv_prepare_jira_automation_plan` |
| End-to-end with dedup + create | `/jira-automation-plan` **or** follow phases below |

## CRITICAL rules

1. **All suite grouping, titles, components, and case URLs** come from **`adv_prepare_jira_automation_plan`** — never re-walk suites with `adv_get_test_cases_by_suite_smart` or hand-build `caseKey` links.
2. Subtask **description** must be the plan’s Zebrunner URL with **`caseId=`** (numeric id).
3. **Never create Jira issues** until the user explicitly approves the preview.
4. Default automation intake: **Not Automated** + **To be automated**; **Automated** and **Manual Only** are excluded unless `include_automated_or_manual_only: true`.
5. **Final report:** one line per **parent** actually created (key, title, link) — do not list every subtask.

## Phase 1 — Zebrunner plan (read-only)

Call **`adv_prepare_jira_automation_plan`** with:

- `suite_url` — `.../projects/<PROJECT>/test-cases?suiteId=<id>` **or** `project_key` + `suite_id`
- `format`: `"json"` (default; use `"markdown"` only when the user wants a readable preview first)

Review `parentTasks`, `skippedGroups`, `warnings`. If `parentTasks` is empty, explain `skippedGroups` and **stop** (no Jira).

Optional: if total subtasks > ~100, warn and confirm before dedup/create.

## Phase 2 — Jira dedup (Atlassian MCP)

For each subtask in the plan:

- JQL in plan `parentTasks[].project` (usually **QAS**)
- **Exact** summary match on subtask `summary` (test case key)
- Status **To Do** or **In Progress** → treat as covered (skip create)

If a parent with the same `summary` already exists, **ask** whether to reuse it for missing subtasks.

## Phase 3 — Preview and approval

Show a short table: parent summary, component, subtasks to create vs skipped (dedup), plus `skippedGroups` from Zebrunner.

**STOP** — wait for explicit approval.

## Phase 4 — Create (Atlassian MCP)

Create parent issues, then subtasks with plan `summary` + `description` (caseId URL). Set assignee/reporter only if the user provided them.

## Phase 5 — Final report

One line per parent created; brief dedup/skip counts; note that re-run plan tool or `/jira-automation-plan` after suite changes.

## Example prompts

Plan only:

> Prepare a Jira automation plan from: `https://example.zebrunner.com/projects/PROJ/test-cases?suiteId=42`

Full workflow:

> `/jira-automation-plan` with suite_url `https://example.zebrunner.com/projects/PROJ/test-cases?suiteId=42`

Markdown preview first:

> Same suite URL — show the Jira automation plan as markdown before any Jira calls.

## Config

See `jiraAutomationPlan` in `zebrunner-config.json` and [change-logs.md v9.4.3](../../change-logs.md#v943--jira-automation-plan-tool-qat-32410).

## Reference

- [TEST_PROMPTS.md §20](../TEST_PROMPTS.md#20-jira-automation-plan-v943) — manual eval-style prompts
- [RESOURCES_AND_PROMPTS.md](../RESOURCES_AND_PROMPTS.md) — `/jira-automation-plan` slash prompt
- [QAT-32410 spec](../investigation/QAT-32410-adv_prepare_jira_automation_plan-spec.md)
