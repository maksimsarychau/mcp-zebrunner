/**
 * Read a single string from an Express query parameter.
 * Returns undefined when the value is missing, duplicated (?key=a&key=b), or not a string.
 */
export function queryParamString(
  query: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = query[name];
  return typeof value === 'string' ? value : undefined;
}
