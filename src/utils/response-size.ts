/** Soft warning threshold (~800 KB) before MCP clients hit the ~1 MB limit. */
export const RESPONSE_SIZE_WARN_BYTES = 800_000;

export function appendResponseSizeNotice(text: string, hints?: string[]): string {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes < RESPONSE_SIZE_WARN_BYTES) return text;
  const tipLines = [
    `_notice: Response is ~${Math.round(bytes / 1024)} KB. Consider token-efficient options:`,
    '- format: "compact" (minified JSON)',
    '- detail: "summary" (trim list payloads)',
    '- count_only: true (metrics without rows)',
    ...(hints ?? []),
  ];
  return `${text}\n\n${tipLines.join('\n')}`;
}
