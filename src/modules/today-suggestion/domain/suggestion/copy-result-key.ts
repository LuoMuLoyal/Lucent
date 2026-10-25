/**
 * Canonical key for a generated-copy result.
 *
 * Copy is requested per (template, params), and two requests that differ only
 * in property order are the *same* request — the params are sorted so the key
 * is stable and de-duplication actually works.
 */
export function buildCopyResultKey(
  templateKey: string,
  params: Record<string, string | number>,
): string {
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${String(v)}`)
    .join('|');
  return `${templateKey}:${sortedParams}`;
}
