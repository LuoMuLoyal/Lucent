import {
  canExpireAfterFading,
  canFade,
  fadeExpiryThreshold,
  fadingThreshold,
  lifecycleRank,
  SUGGESTION_ACTIVE_DURATION_MS,
  SUGGESTION_FADING_DURATION_MS,
  type SuggestionLifecycleState,
} from './daily-suggestion.js';

/**
 * Pure unit tests for the suggestion lifecycle rule — no Prisma, no container.
 *
 * Time is passed in rather than read from a clock, so every boundary below is
 * an exact timestamp comparison instead of a fake-timer dance.
 */

const HOUR_MS = 60 * 60 * 1000;

/** A fixed reference instant; nothing here depends on the real clock. */
const NOW = new Date('2026-10-25T12:00:00.000Z');

describe('lifecycle durations', () => {
  it('declares the 8h/4h windows', () => {
    expect(SUGGESTION_ACTIVE_DURATION_MS).toBe(8 * HOUR_MS);
    expect(SUGGESTION_FADING_DURATION_MS).toBe(4 * HOUR_MS);
  });
});

describe('fadingThreshold', () => {
  it('is 8 hours before the given instant', () => {
    expect(fadingThreshold(NOW).toISOString()).toBe('2026-10-25T04:00:00.000Z');
  });
});

describe('fadeExpiryThreshold', () => {
  it('is 12 hours before the given instant (active + fading windows)', () => {
    expect(fadeExpiryThreshold(NOW).toISOString()).toBe(
      '2026-10-25T00:00:00.000Z',
    );
  });
});

describe('canFade', () => {
  it('is true once the card is older than the active window', () => {
    expect(canFade(new Date(NOW.getTime() - 9 * HOUR_MS), NOW)).toBe(true);
  });

  it('is false while the card is still inside the active window', () => {
    expect(canFade(new Date(NOW.getTime() - 7 * HOUR_MS), NOW)).toBe(false);
  });

  it('is false exactly at the boundary', () => {
    // The batch predicate is `activatedAt < threshold`, so a card activated
    // exactly 8h ago has not faded yet. Pinning the strictness keeps the
    // domain rule and the SQL predicate identical.
    expect(canFade(new Date(NOW.getTime() - 8 * HOUR_MS), NOW)).toBe(false);
  });

  it('is true one millisecond past the boundary', () => {
    expect(canFade(new Date(NOW.getTime() - 8 * HOUR_MS - 1), NOW)).toBe(true);
  });
});

describe('canExpireAfterFading', () => {
  it('is true past the combined 12h window', () => {
    expect(
      canExpireAfterFading(new Date(NOW.getTime() - 13 * HOUR_MS), NOW),
    ).toBe(true);
  });

  it('is false inside the 8h..12h fading band', () => {
    expect(
      canExpireAfterFading(new Date(NOW.getTime() - 10 * HOUR_MS), NOW),
    ).toBe(false);
  });

  it('is false exactly at the 12h boundary', () => {
    expect(
      canExpireAfterFading(new Date(NOW.getTime() - 12 * HOUR_MS), NOW),
    ).toBe(false);
  });
});

describe('lifecycleRank', () => {
  it('orders active > fading > dismissed > expired', () => {
    const ordered: SuggestionLifecycleState[] = [
      'active',
      'fading',
      'dismissed',
      'expired',
    ];
    const ranks = ordered.map(lifecycleRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it('puts active strictly above every other state', () => {
    const others: SuggestionLifecycleState[] = [
      'fading',
      'dismissed',
      'expired',
    ];
    for (const state of others) {
      expect(lifecycleRank('active')).toBeGreaterThan(lifecycleRank(state));
    }
  });

  it('ranks dismissed above expired', () => {
    // A dismissed card reflects a user decision; an expired one ran out of time.
    expect(lifecycleRank('dismissed')).toBeGreaterThan(
      lifecycleRank('expired'),
    );
  });
});
