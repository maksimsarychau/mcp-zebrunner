# TCM + TAM Widget Backlog (22 templates)

> **Archived 2026-07-10** — **22/22** widgets MCP-covered in v9.2.5.  
> **Live docs:** [TEST_PROMPTS.md §18](../TEST_PROMPTS.md#18-dashboard-widgets-22-templates--v925), [TOOLS_CATALOG.md](../../TOOLS_CATALOG.md), [change-logs.md](../../change-logs.md#v925--test-authoring-trend-template-7).

**Status:** v9.2.5 ships `adv_get_test_authoring_trend` — **22/22** widgets MCP-covered.

See also: [WIDGET_PERIOD_COMPATIBILITY.md](./WIDGET_PERIOD_COMPATIBILITY.md) (archived)

---

## API families

| Family | Endpoint | Period |
|--------|----------|--------|
| TAM | `POST /api/reporting/v1/widget-templates/sql` | preset / ABSOLUTE / DYNAMIC |
| TCM | `POST /api/tcm/v1/widgets/{systemName}/content:get` | snapshot filters only |

---

## Full matrix (22 templates)

| Template | systemName / UI | MCP today | API test ID | Shipped |
|----------|-----------------|-----------|-------------|---------|
| **37780** | Distribution by field | **`adv_get_test_case_distribution_by_field`** | TCM-DIST-* | v9.2.3 |
| **37777** | Net change | **`adv_get_tcm_case_analytics`** (`net_change`) | TCM-NET | v9.2.4 |
| **37778** | Updated by user | **`adv_get_tcm_case_analytics`** (`updated_by_user`) | TCM-UPDATED | v9.2.4 |
| **37779** | Created by user | **`adv_get_tcm_case_analytics`** (`created_by_user`) | TCM-CREATED | v9.2.4 |
| **4** | Top defects | `adv_get_top_bugs` | W-TPL4 | Tier A |
| **9** | Failures by reason | `adv_get_bug_review` | W-TPL9 | Tier A |
| **6** | Failure info | `adv_get_bug_failure_info` | W-TPL6 | Tier A |
| **10** | Failure details | `adv_get_bug_failure_info` | W-TPL10 | Tier A |
| **8** | Pass rate pie | `adv_get_platform_results_by_period` (`view: pie`) | W-TPL8*, W-TPL8-WEEK | Tier A |
| **3** | Pass rate bar | **`adv_get_platform_results_by_period`** (`view: bar`) | W-TPL3, W-TPL3-OWNER-TODAY | v9.2.4 |
| **5** | Pass rate line | **`adv_get_platform_results_by_period`** (`view: line`) | W-TPL5 | v9.2.4 |
| **17** | Pass rate pie+line | **`adv_get_platform_results_by_period`** (`view: pie_line`) | W-TPL17 | v9.2.4 |
| **90** | Pass rate calendar | **`adv_get_platform_results_by_period`** (`view: calendar`) | W-TPL90 | v9.2.4 |
| **14** | Tests summary | **`adv_get_platform_results_by_period`** (`view: summary`) | W-TPL14 | v9.2.4 |
| **7** | TC development trend | **`adv_get_test_authoring_trend`** | W-TPL7, W-TPL7-ABS | **v9.2.5** |
| **40112** | Failure tag pie | **`adv_get_failure_analytics`** (`tag_distribution`) | W-TPL40112 | v9.2.4 |
| **55991** | Tags × maintainer | **`adv_get_failure_analytics`** (`tags_by_maintainer`) | W-TPL55991 | v9.2.4 |
| **57086** | Jira × maintainer | **`adv_get_failure_analytics`** (`jira_by_maintainer`) | W-TPL57086 | v9.2.4 |
| **57085** | Launch duration | **`adv_get_execution_analytics`** (`launch_duration`) | W-TPL57085 | v9.2.4 |
| **131** | Execution duration | **`adv_get_execution_analytics`** (`duration_trend`) | W-TPL131, W-TPL131-RUN | v9.2.4 |
| **1** | Execution ROI | **`adv_get_execution_analytics`** (`roi`) | W-TPL1-ROI | v9.2.4 |
| **16** | Stability table | **`adv_get_execution_analytics`** (`stability_table`) | W-TPL16 | v9.2.4 |

---

## Period modes (v9.2.2+)

See [WIDGET_PERIOD_COMPATIBILITY.md](./WIDGET_PERIOD_COMPATIBILITY.md).

---

## Overlap map (not the same tool)

| Widget | Looks like | Actually |
|--------|------------|----------|
| 37780 distribution | `adv_get_test_cases_by_automation_state` | Different API — pie vs paginated list |
| 16 stability | `adv_find_flaky_tests` | Sub-threshold table vs flip-flop detection |
| 131 duration | `adv_analyze_regression_runtime` | Widget SQL daily stats vs launches API |
| 8 pass rate | `adv_generate_report` pass_rate leg | Same data family; report is composite |
| 7 authoring | `adv_get_tcm_case_analytics` net_change | CREATED_AT×AMOUNT trend vs net delta |
