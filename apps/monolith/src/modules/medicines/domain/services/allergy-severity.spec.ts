import { describe, expect, it } from 'vitest';
import {
  inferredAllergySeverity,
  isSevereAllergy,
  type AllergyRecord,
} from './allergy-severity.js';

function allergy(overrides: Partial<AllergyRecord> = {}): AllergyRecord {
  return {
    label: '青霉素',
    reaction: null,
    severity: null,
    isActive: true,
    ...overrides,
  };
}

describe('inferredAllergySeverity', () => {
  it('returns severe when reaction contains anaphylaxis keywords', () => {
    expect(inferredAllergySeverity(allergy({ reaction: '过敏性休克' }))).toBe(
      'severe',
    );
    expect(
      inferredAllergySeverity(allergy({ reaction: 'Anaphylaxis reported' })),
    ).toBe('severe');
  });
  it('falls back to the recorded severity', () => {
    expect(inferredAllergySeverity(allergy({ severity: 'moderate' }))).toBe(
      'moderate',
    );
  });
  it('returns unknown when severity is missing / blank / unknown', () => {
    expect(inferredAllergySeverity(allergy())).toBe('unknown');
    expect(inferredAllergySeverity(allergy({ severity: '' }))).toBe('unknown');
    expect(inferredAllergySeverity(allergy({ severity: 'UNKNOWN' }))).toBe(
      'unknown',
    );
  });
});

describe('isSevereAllergy', () => {
  it('is true only for severe', () => {
    expect(isSevereAllergy(allergy({ severity: 'severe' }))).toBe(true);
    expect(isSevereAllergy(allergy({ severity: 'mild' }))).toBe(false);
    expect(isSevereAllergy(allergy())).toBe(false);
  });
});
