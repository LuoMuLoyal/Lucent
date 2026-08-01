import { describe, expect, it } from 'vitest';
import { validateReadResults } from './validate';

describe('validateReadResults', () => {
  it('returns defaults for empty or non-read results', () => {
    expect(validateReadResults([])).toEqual({
      hasEmptyResults: false,
      hasPartialCoverage: false,
      hasAmbiguities: false,
      missingProposedActions: false,
    });
    expect(
      validateReadResults([
        { name: 'propose_create_daily_record', data: { draft: {} } },
      ]),
    ).toEqual({
      hasEmptyResults: false,
      hasPartialCoverage: false,
      hasAmbiguities: false,
      missingProposedActions: false,
    });
  });

  it('flags empty coverage', () => {
    const flags = validateReadResults([
      {
        name: 'get_records_by_range',
        data: {
          coverage: { status: 'empty', reason: 'No records found.' },
          ambiguities: [],
        },
      },
    ]);
    expect(flags.hasEmptyResults).toBe(true);
  });

  it('flags partial coverage', () => {
    const flags = validateReadResults([
      {
        name: 'get_records_by_range',
        data: {
          coverage: { status: 'partial', reason: 'Some sources omitted.' },
          ambiguities: [],
        },
      },
    ]);
    expect(flags.hasPartialCoverage).toBe(true);
  });

  it('flags ambiguities', () => {
    const flags = validateReadResults([
      {
        name: 'get_records_by_date',
        data: {
          coverage: { status: 'complete', reason: null },
          ambiguities: ['Defaulted to 2026-07-01.'],
        },
      },
    ]);
    expect(flags.hasAmbiguities).toBe(true);
    expect(flags.hasEmptyResults).toBe(false);
  });
});
