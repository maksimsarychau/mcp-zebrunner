/**
 * Normalize widget SQL / TCM widget response rows for tests and future hub tools.
 */

import type { TcmDistributionItem, TcmLabeledValueItem, TcmNetChangeItem } from './tcm-widget-client.js';

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function rowHasKeys(row: Record<string, unknown>, keys: string[]): boolean {
  const lower = new Map(Object.keys(row).map(k => [k.toLowerCase(), k]));
  return keys.every(k => {
    const hit = lower.get(k.toLowerCase());
    return hit != null && row[hit] !== undefined;
  });
}

export function parseDistributionItems(data: unknown): TcmDistributionItem[] {
  const raw = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : [];
  return raw
    .filter(isRecord)
    .map(row => ({
      label: String(row.label ?? ''),
      value: Number(row.value ?? 0),
    }));
}

export function parseNetChangeItems(data: unknown): TcmNetChangeItem[] {
  const raw = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : [];
  return raw.filter(isRecord).map(row => ({
    period: String(row.period ?? ''),
    valueFrom: Number(row.valueFrom ?? 0),
    valueTo: Number(row.valueTo ?? 0),
  }));
}

export function parseLabeledValueItems(data: unknown): TcmLabeledValueItem[] {
  const raw = Array.isArray(data)
    ? data
    : isRecord(data) && Array.isArray(data.items)
      ? data.items
      : [];
  return raw.filter(isRecord).map(row => ({
    label: String(row.label ?? ''),
    value: Number(row.value ?? 0),
  }));
}

/** Assert each row in a widget SQL JSON array contains required column keys. */
export function assertSqlRowsHaveKeys(rows: unknown, requiredKeys: string[]): boolean {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return rows.every(row => isRecord(row) && rowHasKeys(row, requiredKeys));
}

export function distributionWithPercents(items: TcmDistributionItem[]): Array<TcmDistributionItem & { percent: number }> {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) {
    return items.map(i => ({ ...i, percent: 0 }));
  }
  return items.map(i => ({
    ...i,
    percent: Math.round((i.value / total) * 1000) / 10,
  }));
}

export interface AuthoringTrendRow {
  created_at: string;
  amount: number;
}

function pickRowValue(row: Record<string, unknown>, keys: string[]): unknown {
  const lower = new Map(Object.keys(row).map(k => [k.toLowerCase(), k]));
  for (const k of keys) {
    const hit = lower.get(k.toLowerCase());
    if (hit != null && row[hit] !== undefined) return row[hit];
  }
  return undefined;
}

/** Normalize template 7 rows (CREATED_AT × AMOUNT). */
export function parseAuthoringTrendRows(rows: unknown[]): AuthoringTrendRow[] {
  return rows.filter(isRecord).map(row => ({
    created_at: String(pickRowValue(row, ['CREATED_AT', 'created_at', 'DATE']) ?? ''),
    amount: Number(pickRowValue(row, ['AMOUNT', 'amount', 'COUNT']) ?? 0),
  }));
}

export function sumAuthoringAmounts(rows: AuthoringTrendRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}
