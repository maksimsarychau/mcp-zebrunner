/**
 * Zebrunner widget SQL period modes: preset, absolute, dynamic.
 * @see docs/todos/WIDGET_PERIOD_COMPATIBILITY.md
 */

import { z } from 'zod';
import { ALL_PERIODS } from './widget-sql.js';

export const WIDGET_PERIOD_MODES = ['preset', 'absolute', 'dynamic'] as const;
export type WidgetPeriodMode = (typeof WIDGET_PERIOD_MODES)[number];

export const DYNAMIC_ANCHORS = [
  'TODAY',
  'START_OF_WEEK',
  'START_OF_MONTH',
  'START_OF_QUARTER',
  'START_OF_YEAR',
  'END_OF_WEEK',
  'END_OF_MONTH',
  'END_OF_QUARTER',
  'END_OF_YEAR',
] as const;
export type DynamicAnchor = (typeof DYNAMIC_ANCHORS)[number];

export const DYNAMIC_UNITS = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export type DynamicUnit = (typeof DYNAMIC_UNITS)[number];

/** Zebrunner paramsConfig period-related fields. */
export interface WidgetPeriodParamsConfig {
  PERIOD: string;
  periodStartDate: string | null;
  periodEndDate: string | null;
  periodStartExpression: string | null;
  periodEndExpression: string | null;
}

export interface WidgetPeriodInput {
  period_mode?: WidgetPeriodMode;
  period?: string;
  period_start_date?: string;
  period_end_date?: string;
  period_start_expression?: string;
  period_end_expression?: string;
  period_dynamic_from_anchor?: DynamicAnchor;
  period_dynamic_from_offset?: number;
  period_dynamic_from_unit?: DynamicUnit;
  period_dynamic_to_anchor?: DynamicAnchor;
  period_dynamic_to_offset?: number;
  period_dynamic_to_unit?: DynamicUnit;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RESOLVED_LABEL_RE = /^\d{4}-\d{2}-\d{2}\s*-\s*\d{4}-\d{2}-\d{2}$/;

function hasStructuredFrom(input: WidgetPeriodInput): boolean {
  return input.period_dynamic_from_anchor !== undefined;
}

function hasStructuredTo(input: WidgetPeriodInput): boolean {
  return input.period_dynamic_to_anchor !== undefined;
}

function hasRawExpressions(input: WidgetPeriodInput): boolean {
  return !!(input.period_start_expression?.trim() && input.period_end_expression?.trim());
}

/** Infer period mode when period_mode is omitted. */
export function inferWidgetPeriodMode(input: WidgetPeriodInput): WidgetPeriodMode {
  if (input.period_mode) return input.period_mode;
  if (input.period_start_date && input.period_end_date) return 'absolute';
  if (
    hasStructuredFrom(input) ||
    hasStructuredTo(input) ||
    hasRawExpressions(input)
  ) {
    return 'dynamic';
  }
  return 'preset';
}

/** Build a Zebrunner dynamic expression string from UI-style anchor/offset/unit. */
export function composeDynamicExpression(
  anchor: DynamicAnchor,
  offset: number,
  unit?: DynamicUnit,
): string {
  if (anchor === 'TODAY' && offset === 0) {
    return 'TODAY';
  }
  if (unit === undefined) {
    throw new Error(`Dynamic unit is required for anchor "${anchor}" with offset ${offset}`);
  }
  return `${anchor} ${offset} ${unit}`;
}

function composeStructuredExpression(
  anchor: DynamicAnchor | undefined,
  offset: number | undefined,
  unit: DynamicUnit | undefined,
  side: 'from' | 'to',
): string {
  if (!anchor) {
    throw new Error(`period_dynamic_${side}_anchor is required for structured dynamic period`);
  }
  const resolvedOffset = offset ?? 0;
  if (anchor === 'TODAY' && resolvedOffset === 0) {
    return 'TODAY';
  }
  if (!unit) {
    throw new Error(`period_dynamic_${side}_unit is required when offset is non-zero or anchor is not TODAY`);
  }
  return composeDynamicExpression(anchor, resolvedOffset, unit);
}

/** Resolve start/end expressions: structured fields first, then raw strings. */
export function resolveDynamicExpressions(input: WidgetPeriodInput): {
  periodStartExpression: string;
  periodEndExpression: string;
} {
  if (hasStructuredFrom(input) || hasStructuredTo(input)) {
    const periodStartExpression = composeStructuredExpression(
      input.period_dynamic_from_anchor,
      input.period_dynamic_from_offset,
      input.period_dynamic_from_unit,
      'from',
    );
    const periodEndExpression = composeStructuredExpression(
      input.period_dynamic_to_anchor,
      input.period_dynamic_to_offset,
      input.period_dynamic_to_unit,
      'to',
    );
    return { periodStartExpression, periodEndExpression };
  }

  const start = input.period_start_expression?.trim();
  const end = input.period_end_expression?.trim();
  if (start && end) {
    return { periodStartExpression: start, periodEndExpression: end };
  }

  throw new Error(
    'Dynamic period requires structured anchor/offset/unit fields or both period_start_expression and period_end_expression',
  );
}

function normalizePresetPeriod(period: string): string {
  const normalized = ALL_PERIODS.find(p => p.toLowerCase() === period.toLowerCase());
  if (!normalized) {
    throw new Error(`Invalid period: ${period}. Allowed: ${ALL_PERIODS.join(', ')}`);
  }
  return normalized;
}

/** Map tool/report args to Zebrunner widget period paramsConfig fields. */
export function resolveWidgetPeriodParams(
  input: WidgetPeriodInput,
  defaultPeriod = 'Last 7 Days',
): WidgetPeriodParamsConfig {
  const mode = inferWidgetPeriodMode(input);

  if (mode === 'preset') {
    const period = input.period ?? defaultPeriod;
    return {
      PERIOD: normalizePresetPeriod(period),
      periodStartDate: null,
      periodEndDate: null,
      periodStartExpression: null,
      periodEndExpression: null,
    };
  }

  if (mode === 'absolute') {
    const start = input.period_start_date?.trim();
    const end = input.period_end_date?.trim();
    if (!start || !end) {
      throw new Error('Absolute period requires period_start_date and period_end_date (YYYY-MM-DD)');
    }
    if (!ISO_DATE_RE.test(start) || !ISO_DATE_RE.test(end)) {
      throw new Error('period_start_date and period_end_date must be ISO dates (YYYY-MM-DD)');
    }
    return {
      PERIOD: 'ABSOLUTE',
      periodStartDate: start,
      periodEndDate: end,
      periodStartExpression: null,
      periodEndExpression: null,
    };
  }

  const { periodStartExpression, periodEndExpression } = resolveDynamicExpressions(input);
  return {
    PERIOD: 'DYNAMIC',
    periodStartDate: null,
    periodEndDate: null,
    periodStartExpression,
    periodEndExpression,
  };
}

/** Extract period fields from tool handler args (unprefixed). */
export function pickWidgetPeriodInput(args: Record<string, unknown>): WidgetPeriodInput {
  return {
    period_mode: args.period_mode as WidgetPeriodMode | undefined,
    period: args.period as string | undefined,
    period_start_date: args.period_start_date as string | undefined,
    period_end_date: args.period_end_date as string | undefined,
    period_start_expression: args.period_start_expression as string | undefined,
    period_end_expression: args.period_end_expression as string | undefined,
    period_dynamic_from_anchor: args.period_dynamic_from_anchor as DynamicAnchor | undefined,
    period_dynamic_from_offset: args.period_dynamic_from_offset as number | undefined,
    period_dynamic_from_unit: args.period_dynamic_from_unit as DynamicUnit | undefined,
    period_dynamic_to_anchor: args.period_dynamic_to_anchor as DynamicAnchor | undefined,
    period_dynamic_to_offset: args.period_dynamic_to_offset as number | undefined,
    period_dynamic_to_unit: args.period_dynamic_to_unit as DynamicUnit | undefined,
  };
}

/** Extract widget_period_* fields from adv_generate_report args. */
export function pickWidgetPeriodInputFromReport(args: Record<string, unknown>): WidgetPeriodInput {
  return {
    period_mode: args.widget_period_mode as WidgetPeriodMode | undefined,
    period: args.period as string | undefined,
    period_start_date: args.widget_period_start_date as string | undefined,
    period_end_date: args.widget_period_end_date as string | undefined,
    period_start_expression: args.widget_period_start_expression as string | undefined,
    period_end_expression: args.widget_period_end_expression as string | undefined,
    period_dynamic_from_anchor: args.widget_period_dynamic_from_anchor as DynamicAnchor | undefined,
    period_dynamic_from_offset: args.widget_period_dynamic_from_offset as number | undefined,
    period_dynamic_from_unit: args.widget_period_dynamic_from_unit as DynamicUnit | undefined,
    period_dynamic_to_anchor: args.widget_period_dynamic_to_anchor as DynamicAnchor | undefined,
    period_dynamic_to_offset: args.widget_period_dynamic_to_offset as number | undefined,
    period_dynamic_to_unit: args.widget_period_dynamic_to_unit as DynamicUnit | undefined,
  };
}

/** First widget row whose label is a resolved date range (YYYY-MM-DD - YYYY-MM-DD). */
export function extractResolvedPeriodLabel(rows: unknown[]): string | null {
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const label = String((row as Record<string, unknown>).label ?? '').trim();
    if (RESOLVED_LABEL_RE.test(label)) return label;
  }
  return null;
}

/** Human-readable period label for charts and summaries. */
export function formatWidgetPeriodLabel(
  input: WidgetPeriodInput,
  resolvedLabel?: string | null,
  defaultPeriod = 'Last 7 Days',
): string {
  if (resolvedLabel) return resolvedLabel;

  const mode = inferWidgetPeriodMode(input);
  if (mode === 'preset') {
    const period = input.period ?? defaultPeriod;
    return ALL_PERIODS.find(p => p.toLowerCase() === period.toLowerCase()) ?? period;
  }
  if (mode === 'absolute') {
    if (input.period_start_date && input.period_end_date) {
      return `${input.period_start_date} - ${input.period_end_date}`;
    }
    return 'Custom date range';
  }
  try {
    const { periodStartExpression, periodEndExpression } = resolveDynamicExpressions(input);
    return `${periodStartExpression} → ${periodEndExpression}`;
  } catch {
    return 'Dynamic period';
  }
}

/** Whether widget-specific period mode is active (non-preset). */
export function isNonPresetWidgetPeriod(input: WidgetPeriodInput): boolean {
  return inferWidgetPeriodMode(input) !== 'preset';
}

/** Extract active widget period input from adv_generate_report args (widget legs only). */
export function resolveReportWidgetPeriodInput(
  input: Record<string, unknown>,
): WidgetPeriodInput | undefined {
  const periodInput = pickWidgetPeriodInputFromReport(input);
  return isNonPresetWidgetPeriod(periodInput) ? periodInput : undefined;
}

/** Shared Zod fields for Tier A widget tools. */
export function widgetPeriodZodFields(defaultPeriod: string) {
  return {
    period_mode: z.enum(WIDGET_PERIOD_MODES).default('preset').describe(
      "Widget period mode: preset (ALL_PERIODS), absolute (fixed dates), or dynamic (relative expressions)",
    ),
    period_start_date: z.string().optional().describe(
      "Absolute mode: start date (YYYY-MM-DD)",
    ),
    period_end_date: z.string().optional().describe(
      "Absolute mode: end date (YYYY-MM-DD)",
    ),
    period_start_expression: z.string().optional().describe(
      "Dynamic mode: raw start expression (e.g. START_OF_MONTH -2 QUARTER). Used when structured fields omitted.",
    ),
    period_end_expression: z.string().optional().describe(
      "Dynamic mode: raw end expression (e.g. TODAY or END_OF_MONTH -1 DAY)",
    ),
    period_dynamic_from_anchor: z.enum(DYNAMIC_ANCHORS).optional().describe(
      "Dynamic mode (preferred): start anchor (e.g. START_OF_MONTH)",
    ),
    period_dynamic_from_offset: z.number().int().optional().describe(
      "Dynamic mode: start offset (e.g. -2)",
    ),
    period_dynamic_from_unit: z.enum(DYNAMIC_UNITS).optional().describe(
      "Dynamic mode: start unit (DAY, WEEK, MONTH, QUARTER, YEAR)",
    ),
    period_dynamic_to_anchor: z.enum(DYNAMIC_ANCHORS).optional().describe(
      "Dynamic mode (preferred): end anchor (e.g. TODAY, END_OF_WEEK)",
    ),
    period_dynamic_to_offset: z.number().int().optional().describe(
      "Dynamic mode: end offset (e.g. -1)",
    ),
    period_dynamic_to_unit: z.enum(DYNAMIC_UNITS).optional().describe(
      "Dynamic mode: end unit",
    ),
  };
}

/** Zod fields for adv_generate_report widget legs only (widget_period_* prefix). */
export function widgetReportPeriodZodFields() {
  return {
    widget_period_mode: z.enum(WIDGET_PERIOD_MODES).optional().describe(
      "Widget SQL period mode for pass_rate/bugs sections only. Does not affect flaky/runtime legs.",
    ),
    widget_period_start_date: z.string().optional().describe(
      "Widget absolute mode: start date (YYYY-MM-DD)",
    ),
    widget_period_end_date: z.string().optional().describe(
      "Widget absolute mode: end date (YYYY-MM-DD)",
    ),
    widget_period_start_expression: z.string().optional().describe(
      "Widget dynamic mode: raw start expression",
    ),
    widget_period_end_expression: z.string().optional().describe(
      "Widget dynamic mode: raw end expression",
    ),
    widget_period_dynamic_from_anchor: z.enum(DYNAMIC_ANCHORS).optional(),
    widget_period_dynamic_from_offset: z.number().int().optional(),
    widget_period_dynamic_from_unit: z.enum(DYNAMIC_UNITS).optional(),
    widget_period_dynamic_to_anchor: z.enum(DYNAMIC_ANCHORS).optional(),
    widget_period_dynamic_to_offset: z.number().int().optional(),
    widget_period_dynamic_to_unit: z.enum(DYNAMIC_UNITS).optional(),
  };
}
