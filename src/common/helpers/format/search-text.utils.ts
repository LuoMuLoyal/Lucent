import { normalizeNullableText } from './string.utils.js';

export function buildSearchText(
  parts: Array<string | null | undefined>,
): string | null {
  const values = parts
    .map((item) => normalizeNullableText(item))
    .filter((item): item is string => item != null);

  if (values.length === 0) {
    return null;
  }

  return values.join(' ');
}
