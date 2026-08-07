/**
 * TCM dashboard widget content API (POST .../widgets/{systemName}/content:get).
 * HTTP transport lives on ZebrunnerReportingClient; this module holds widget names and response types.
 */

export const TCM_WIDGET_SYSTEM_NAMES = {
  DISTRIBUTION_BY_FIELD: 'test-cases-distribution-by-field',
  NET_CHANGE: 'test-cases-net-change',
  CREATED_BY_USER: 'test-cases-created-by-user',
  UPDATED_BY_USER: 'test-cases-updated-by-user',
} as const;

export interface TcmDistributionItem {
  label: string;
  value: number;
}

export interface TcmDistributionResponse {
  items: TcmDistributionItem[];
}

export interface TcmNetChangeItem {
  period: string;
  valueFrom: number;
  valueTo: number;
}

export interface TcmLabeledValueItem {
  label: string;
  value: number;
}

/** Unwrap `{ items: T[] }` from TCM widget responses. */
export function unwrapTcmWidgetItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}
