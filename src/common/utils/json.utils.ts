/**
 * Shared JSON utilities.
 */

/**
 * Extracts the outermost JSON object from a string that may contain
 * markdown fences or surrounding prose.
 */
export function extractJsonObject(rawText: string): string | null {
  const jsonStart = rawText.indexOf('{');
  const jsonEnd = rawText.lastIndexOf('}') + 1;
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    return null;
  }

  return rawText.slice(jsonStart, jsonEnd);
}
