# Widget Period Modes — Completed (v9.2.2+)

> **Archived 2026-07-10** — work shipped in v9.2.2–v9.2.5.  
> **Live docs:** [TEST_PROMPTS.md](../TEST_PROMPTS.md) (period_mode examples), [hub-widget-matrix.ts](../../tests/helpers/hub-widget-matrix.ts) (`PERIOD_MODE_API_SMOKES`), [api-verify.sh](../../tests/api-verify.sh).

**Status:** Done — shipped v9.2.2 (`src/utils/widget-period.ts`) and extended through v9.2.5 hub/authoring tools.

---

## What shipped

| Mode | `paramsConfig` | MCP `period_mode` |
|------|----------------|-------------------|
| Preset | `PERIOD: "Last 14 Days"` | `preset` (default) |
| Absolute | `PERIOD: "ABSOLUTE"` + ISO dates | `absolute` + `period_start_date` / `period_end_date` |
| Dynamic | `PERIOD: "DYNAMIC"` + expressions | `dynamic` + `period_start_expression` / `period_end_expression` |

**Tier A widget tools** (`adv_get_platform_results_by_period`, `adv_get_top_bugs`, `adv_get_bug_review`, `adv_get_bug_failure_info`) and **Tier B** report fetchers accept all three modes. **Hub tools** and **`adv_get_test_authoring_trend`** reuse the same resolver.

---

## API verification (`tests/api-verify.sh`)

| ID | Template | Notes |
|----|----------|-------|
| W-ABS, W-DYN, W-DYN-QUARTER, W-DYN-WEEK, W-DYN-LONG, W-PRESET | 8 | Tier A pass-rate pie |
| W-TPL3, W-TPL3-OWNER-TODAY | 3 | bar view; OWNER + Today variant |
| W-TPL7-ABS | 7 | authoring trend absolute window |
| W-TPL40112-ABS | 40112 | failure hub absolute window (lenient — MFP may return HTTP 500) |

---

## Eval (cloud suite)

Period-routing prompts live in the **cloud** eval suite (`npm run test:eval:cloud`):

- `widget.tpl8.dynamic_period`
- `authoring.period.absolute`
- `hub.failure.period_absolute`

Default local eval (`npm run test:eval`) excludes widget/hub disambiguation and period-mode routing.

---

## Out of scope (documented)

- **W2 milestone/build** tools (`adv_analyze_regression_runtime`, flaky `period_days`, launch filters) — not widget `PERIOD` modes.
- **W3 TCM ISO dates** on case-list tools — separate from widget SQL; `adv_generate_report` TCM legs use `period_start` / `period_end`.

---

## Audit log

| Date | Notes |
|------|-------|
| 2026-07-09 | Initial TODO + v9.2.2 implementation |
| 2026-07-10 | Archived; api smokes for tpl 7/40112 absolute, tpl 3 OWNER+Today; eval cloud period prompts |
