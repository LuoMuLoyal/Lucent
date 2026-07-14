import {
  dailyRecordCandidateSchema,
  dailyRecordCandidatesSchema,
  sleepPayloadSchema,
  DAILY_RECORD_CANDIDATE_KINDS,
} from './daily-record-candidates.schema';

describe('sleepPayloadSchema', () => {
  function buildValid(overrides: Record<string, unknown> = {}) {
    return {
      durationMinutes: 480,
      ...overrides,
    };
  }

  it('accepts a valid sleep payload', () => {
    const result = sleepPayloadSchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('accepts optional startAt, endAt, and quality', () => {
    const result = sleepPayloadSchema.safeParse(
      buildValid({
        startAt: '2026-07-09T22:00:00.000Z',
        endAt: '2026-07-10T06:00:00.000Z',
        quality: 'good',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects non-positive duration', () => {
    const result = sleepPayloadSchema.safeParse(
      buildValid({ durationMinutes: 0 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects duration over 1440 minutes', () => {
    const result = sleepPayloadSchema.safeParse(
      buildValid({ durationMinutes: 1441 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects non-integer duration', () => {
    const result = sleepPayloadSchema.safeParse(
      buildValid({ durationMinutes: 480.5 }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects extra unknown fields (strict mode)', () => {
    const result = sleepPayloadSchema.safeParse(
      buildValid({ extraField: 'not allowed' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects missing durationMinutes', () => {
    const result = sleepPayloadSchema.safeParse({ quality: 'good' });
    expect(result.success).toBe(false);
  });

  it('rejects quality exceeding 40 chars', () => {
    const result = sleepPayloadSchema.safeParse(
      buildValid({ quality: 'x'.repeat(41) }),
    );
    expect(result.success).toBe(false);
  });
});

describe('dailyRecordCandidateSchema', () => {
  function buildValid(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'water',
      occurredAt: '2026-07-09',
      title: '喝水',
      value: '1',
      unit: '杯',
      note: null,
      payload: null,
      rationale: '用户记录了饮水',
      ...overrides,
    };
  }

  it('accepts a valid candidate with null payload', () => {
    const result = dailyRecordCandidateSchema.safeParse(buildValid());
    expect(result.success).toBe(true);
  });

  it('accepts all valid kinds', () => {
    for (const kind of DAILY_RECORD_CANDIDATE_KINDS) {
      const result = dailyRecordCandidateSchema.safeParse(buildValid({ kind }));
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid kind', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ kind: 'exercise' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects occurredAt that does not match YYYY-MM-DD', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ occurredAt: '2026/07/09' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an empty rationale', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ rationale: '  ' }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects rationale exceeding 160 chars', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ rationale: 'x'.repeat(161) }),
    );
    expect(result.success).toBe(false);
  });

  it('accepts a valid sleep payload', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({
        kind: 'sleep',
        payload: {
          durationMinutes: 480,
          quality: 'good',
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts a generic record payload', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({
        payload: { customKey: 'customValue', count: 3 },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts title and value as null', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ title: null, value: null, unit: null, note: null }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects title exceeding 200 chars', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ title: 'x'.repeat(201) }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects note exceeding 1000 chars', () => {
    const result = dailyRecordCandidateSchema.safeParse(
      buildValid({ note: 'x'.repeat(1001) }),
    );
    expect(result.success).toBe(false);
  });
});

describe('dailyRecordCandidatesSchema', () => {
  function buildItem(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'water',
      occurredAt: '2026-07-09',
      title: '喝水',
      value: '1',
      unit: '杯',
      note: null,
      payload: null,
      rationale: '用户记录了饮水',
      ...overrides,
    };
  }

  it('accepts an array with 1–5 items', () => {
    const result = dailyRecordCandidatesSchema.safeParse({
      items: [buildItem()],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an array with exactly 5 items', () => {
    const result = dailyRecordCandidatesSchema.safeParse({
      items: Array.from({ length: 5 }, () => buildItem()),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty items array', () => {
    const result = dailyRecordCandidatesSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an array with more than 5 items', () => {
    const result = dailyRecordCandidatesSchema.safeParse({
      items: Array.from({ length: 6 }, () => buildItem()),
    });
    expect(result.success).toBe(false);
  });
});
