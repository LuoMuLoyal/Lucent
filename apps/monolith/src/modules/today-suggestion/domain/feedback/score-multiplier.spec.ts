import {
  feedbackRatios,
  MAX_BOOST_MULTIPLIER,
  MIN_REDUCTION_MULTIPLIER,
  NEUTRAL_MULTIPLIER,
  scoreMultiplier,
  STATS_MIN_SAMPLE_SIZE,
} from './score-multiplier.js';

/**
 * Pure unit tests for the feedback-driven score adjustment.
 *
 * Boundary values first (they are the rule), then the "no opinion" cases.
 */

function counts(
  accepted: number,
  later = 0,
  notApplicable = 0,
  suppress = 0,
): {
  accepted: number;
  later: number;
  notApplicable: number;
  suppress: number;
} {
  return { accepted, later, notApplicable, suppress };
}

describe('feedbackRatios', () => {
  it('divides each directional count by the total', () => {
    const ratios = feedbackRatios(counts(3, 1, 1, 5));
    expect(ratios.total).toBe(10);
    expect(ratios.acceptRatio).toBeCloseTo(0.3);
    expect(ratios.suppressRatio).toBeCloseTo(0.5);
  });

  it('returns zero ratios (not NaN) for an empty sample', () => {
    // NaN would poison every comparison downstream.
    const ratios = feedbackRatios(counts(0));
    expect(ratios).toEqual({ total: 0, acceptRatio: 0, suppressRatio: 0 });
  });

  it('counts deferred feedback toward the sample without a direction', () => {
    // `later` / `notApplicable` tell us the rule fires, not whether it landed.
    const ratios = feedbackRatios(counts(0, 2, 3, 0));
    expect(ratios.total).toBe(5);
    expect(ratios.acceptRatio).toBe(0);
    expect(ratios.suppressRatio).toBe(0);
  });
});

describe('scoreMultiplier — sample size', () => {
  it('stays neutral below the minimum sample size', () => {
    const below = STATS_MIN_SAMPLE_SIZE - 1;
    expect(scoreMultiplier(feedbackRatios(counts(below)))).toBe(
      NEUTRAL_MULTIPLIER,
    );
  });

  it('applies at exactly the minimum sample size', () => {
    // Five acceptances out of five: the boost now counts.
    const ratios = feedbackRatios(counts(STATS_MIN_SAMPLE_SIZE));
    expect(scoreMultiplier(ratios)).toBeGreaterThan(NEUTRAL_MULTIPLIER);
  });

  it('is neutral for an empty sample', () => {
    expect(scoreMultiplier(feedbackRatios(counts(0)))).toBe(NEUTRAL_MULTIPLIER);
  });
});

describe('scoreMultiplier — caps', () => {
  it('reaches the maximum boost at a 100% accept ratio', () => {
    const ratios = feedbackRatios(counts(10));
    expect(scoreMultiplier(ratios)).toBe(MAX_BOOST_MULTIPLIER);
  });

  it('reaches the maximum reduction at a 100% suppress ratio', () => {
    const ratios = feedbackRatios(counts(0, 0, 0, 10));
    expect(scoreMultiplier(ratios)).toBe(MIN_REDUCTION_MULTIPLIER);
  });

  it('never exceeds the caps even when both ratios are extreme', () => {
    const boosts = scoreMultiplier(feedbackRatios(counts(50, 0, 0, 0)));
    const reductions = scoreMultiplier(feedbackRatios(counts(0, 0, 0, 50)));
    expect(boosts).toBeLessThanOrEqual(MAX_BOOST_MULTIPLIER);
    expect(reductions).toBeGreaterThanOrEqual(MIN_REDUCTION_MULTIPLIER);
  });
});

describe('scoreMultiplier — symmetry and shape', () => {
  it('is neutral when accept and suppress ratios are equal', () => {
    const ratios = feedbackRatios(counts(5, 0, 0, 5));
    expect(scoreMultiplier(ratios)).toBe(NEUTRAL_MULTIPLIER);
  });

  it('boosts and reduces by the same magnitude for mirrored inputs', () => {
    const boosted = scoreMultiplier(feedbackRatios(counts(8, 0, 0, 2)));
    const reduced = scoreMultiplier(feedbackRatios(counts(2, 0, 0, 8)));
    expect(boosted - NEUTRAL_MULTIPLIER).toBeCloseTo(
      NEUTRAL_MULTIPLIER - reduced,
      5,
    );
  });

  it('rounds to two decimals', () => {
    // 7/9 accept ratio produces a repeating decimal before rounding.
    const value = scoreMultiplier(feedbackRatios(counts(7, 2, 0, 0)));
    expect(Number.isInteger(value * 100)).toBe(true);
  });

  it('stays inside [min, max] for every ratio sampled', () => {
    for (let accepted = 0; accepted <= 10; accepted += 1) {
      for (let suppress = 0; suppress <= 10; suppress += 1) {
        const value = scoreMultiplier(
          feedbackRatios(counts(accepted, 0, 0, suppress)),
        );
        expect(value).toBeGreaterThanOrEqual(MIN_REDUCTION_MULTIPLIER);
        expect(value).toBeLessThanOrEqual(MAX_BOOST_MULTIPLIER);
      }
    }
  });
});
