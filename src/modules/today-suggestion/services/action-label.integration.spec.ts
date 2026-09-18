import { readFileSync } from 'node:fs';
import { humanizeActionLabel } from './presentation.service.js';

/**
 * Exercises action-label resolution against the REAL en i18n table.
 *
 * The unit specs use a stub translator, so they cannot catch a mismatch
 * between the keys the rules emit and the keys actually registered. The
 * production bug this guards against (a raw `complete_profile` on the
 * suggestion card) was exactly that mismatch going unnoticed.
 */
const table = JSON.parse(
  readFileSync('src/i18n/en/today-suggestion.json', 'utf8'),
) as { action: Record<string, string> };

function lookup(label: string): string | null {
  return table.action[label] ?? null;
}

/** Mirrors SuggestionPresentationService.localizeActionLabel. */
function resolve(label: string, fallback?: string): string {
  const hit = lookup(label);
  if (hit != null) return hit;
  const candidate = (fallback ?? '').trim();
  if (candidate.length > 0 && candidate !== label) {
    const translated = lookup(candidate);
    if (translated != null) return translated;
  }
  return humanizeActionLabel(candidate.length > 0 ? candidate : label);
}

describe('action label resolution against the production table', () => {
  it('resolves the registered rule key to display text', () => {
    expect(resolve('complete_profile')).toBe('Complete profile');
  });

  it('never returns an i18n key path or an internal identifier', () => {
    const cases: ReadonlyArray<[string, string?]> = [
      ['complete_profile'],
      ['complete_profile', 'complete_profile'],
      ['unregistered_action'],
      ['unregistered_action', 'log_dose'],
    ];

    for (const [label, fallback] of cases) {
      const out = resolve(label, fallback);
      expect(out).not.toContain('today-suggestion.action.');
      expect(out).not.toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/);
      expect(out.trim().length).toBeGreaterThan(0);
    }
  });
});
