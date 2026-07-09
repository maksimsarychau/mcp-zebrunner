/**
 * Pass-rate widget view → templateId mapping (TAM SQL templates 3, 5, 8, 14, 17, 90).
 * @see docs/todos/TCM_TAM_WIDGET_BACKLOG.md
 */

export const PASS_RATE_VIEWS = ['pie', 'line', 'bar', 'calendar', 'pie_line', 'summary'] as const;
export type PassRateView = (typeof PASS_RATE_VIEWS)[number];

export const PASS_RATE_GROUP_BY = ['PLATFORM', 'OWNER', 'BUILD', 'PRIORITY'] as const;
export type PassRateGroupBy = (typeof PASS_RATE_GROUP_BY)[number];

export const PASS_RATE_GROUPING_PERIOD = ['DAY', 'WEEK', 'MONTH'] as const;
export type PassRateGroupingPeriod = (typeof PASS_RATE_GROUPING_PERIOD)[number];

/** Default template 8 — pie (unchanged v9.2.2 behavior). */
export const DEFAULT_PASS_RATE_TEMPLATE_ID = 8;

export const VIEW_TO_TEMPLATE_ID: Record<PassRateView, number> = {
  pie: 8,
  line: 5,
  bar: 3,
  calendar: 90,
  pie_line: 17,
  summary: 14,
};

export interface PassRateViewExtraInput {
  group_by?: PassRateGroupBy;
  grouping_period?: PassRateGroupingPeriod;
  passed_value_threshold?: number;
}

/**
 * Resolve widget SQL templateId from view.
 * Explicit non-default templateId always wins (backward compatible override).
 */
export function resolvePassRateTemplateId(
  view: PassRateView,
  explicitTemplateId?: number,
): number {
  if (
    explicitTemplateId != null &&
    explicitTemplateId !== DEFAULT_PASS_RATE_TEMPLATE_ID
  ) {
    return explicitTemplateId;
  }
  if (view !== 'pie') {
    return VIEW_TO_TEMPLATE_ID[view];
  }
  return explicitTemplateId ?? DEFAULT_PASS_RATE_TEMPLATE_ID;
}

/** Build paramsConfig.extra fields for pass-rate view variants. */
export function buildPassRateViewExtra(
  view: PassRateView,
  input: PassRateViewExtraInput,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};

  if (view === 'bar' || view === 'summary') {
    if (input.group_by) {
      extra.GROUP_BY = input.group_by;
    } else if (view === 'bar') {
      extra.GROUP_BY = 'PRIORITY';
    } else if (view === 'summary') {
      extra.GROUP_BY = 'BUILD';
    }
  }

  if (view === 'line' || view === 'pie_line') {
    extra.groupingPeriod = input.grouping_period ?? 'DAY';
  }

  if (view === 'calendar') {
    extra.PASSED_VALUE = String(input.passed_value_threshold ?? 75);
  }

  return extra;
}
