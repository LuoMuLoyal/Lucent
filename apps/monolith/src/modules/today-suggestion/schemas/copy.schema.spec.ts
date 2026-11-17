import {
  GeneratedCopySchema,
  KNOWN_INTERNAL_ACTION_LABELS,
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

  it.each(['record', 'confirm', 'skip', 'go', 'review', 'consult'])(
    'rejects the single-word internal action label %s',
    (label) => {
      // 形状判断漏掉的正是这一类：单段纯小写既没有下划线也没有大小写切换，
      // 只有从 action-label 注册表派生的白名单能兜住。
      expect(
        safeParseGeneratedCopy({ ...validCopy, actionLabel: label }),
      ).toBeNull();
    },
  );

  it('derives the whitelist from the action registries', () => {
    expect(KNOWN_INTERNAL_ACTION_LABELS.has('complete_profile')).toBe(true);
    expect(KNOWN_INTERNAL_ACTION_LABELS.has('record')).toBe(true);
    expect(KNOWN_INTERNAL_ACTION_LABELS.has('go_record')).toBe(true);
    expect(KNOWN_INTERNAL_ACTION_LABELS.has('Log water')).toBe(false);
  });

  it('keeps a capitalized display label that shares a registry spelling', () => {
    // 白名单大小写敏感：模型回吐的是注册表里的小写形态，而 "Record" 是正常按钮文案。
    expect(
      safeParseGeneratedCopy({ ...validCopy, actionLabel: 'Record' })
        ?.actionLabel,
    ).toBe('Record');
  });

  it('still enforces the length bound', () => {
    const result = GeneratedCopySchema.safeParse({
      ...validCopy,
      actionLabel: 'a'.repeat(11),
    });
    expect(result.success).toBe(false);
  });
});
