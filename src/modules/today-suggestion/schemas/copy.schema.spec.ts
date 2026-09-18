import {
  GeneratedCopySchema,
  parseGeneratedCopy,
  safeParseGeneratedCopy,
} from './copy.schema.js';

const validCopy = {
  title: 'Hydrate more',
  reason: 'Water intake is below your recent average.',
  boundary: 'This is a suggestion, not medical advice.',
  actionLabel: 'Log water',
};

describe('GeneratedCopySchema', () => {
  it('accepts ordinary display text', () => {
    expect(safeParseGeneratedCopy(validCopy)).toEqual(validCopy);
  });

  it.each([
    'complete_profile',
    'mark_as_taken',
    'completeProfile',
    'logDose',
    'go_complete_profile',
  ])('rejects the internal identifier %s as an action label', (label) => {
    // The prompt hands the model `templateKey`/`params`, so it can echo a key
    // back as its answer; accepting one would put an internal identifier on
    // the suggestion card.
    expect(
      safeParseGeneratedCopy({ ...validCopy, actionLabel: label }),
    ).toBeNull();
    expect(() =>
      parseGeneratedCopy({ ...validCopy, actionLabel: label }),
    ).toThrow(/internal identifier/i);
  });

  it.each(['Log water', 'Mark done', 'Dismiss', 'Show basis'])(
    'keeps the multi-word display label %s',
    (label) => {
      expect(
        safeParseGeneratedCopy({ ...validCopy, actionLabel: label })
          ?.actionLabel,
      ).toBe(label);
    },
  );

  it('still enforces the length bound', () => {
    const result = GeneratedCopySchema.safeParse({
      ...validCopy,
      actionLabel: 'a'.repeat(11),
    });
    expect(result.success).toBe(false);
  });
});
