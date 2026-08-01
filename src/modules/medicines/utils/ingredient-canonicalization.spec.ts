import { describe, expect, it } from 'vitest';
import {
  asNonEmptyString,
  canonicalIngredientKeysFor,
  duplicateIngredientEvidence,
  expandCanonicalIngredientTokens,
  extractIngredientTokens,
  firstNonEmpty,
  getAllSourceIngredientTokens,
  getCanonicalIngredientKeys,
  getDisplayName,
  getDrugbankIds,
  getDrugbankInteractionTargets,
  getDrugbankSynonymTokens,
  normalizeToken,
  type MedicineDetailWrapper,
} from './ingredient-canonicalization';

function wrapper(
  overrides: {
    source?: 'cn' | 'drugbank' | 'manual';
    displayName?: string;
    name?: string;
    detail?: Record<string, unknown>;
    sourceRefId?: string | null;
  } = {},
): MedicineDetailWrapper {
  return {
    item: {
      id: 'm1',
      source: overrides.source ?? 'cn',
      sourceRefId: overrides.sourceRefId ?? 's1',
      displayName: overrides.displayName ?? ' 阿司匹林肠溶片 ',
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    detail: {
      id: 'd1',
      source: overrides.source ?? 'cn',
      name: overrides.name ?? 'Aspirin',
      detail: overrides.detail ?? {},
    } as unknown as MedicineDetailWrapper['detail'],
  };
}

describe('normalizeToken', () => {
  it('lowercases and strips all whitespace', () => {
    expect(normalizeToken('  IBUprofeN 100mg ')).toBe('ibuprofen100mg');
  });
});

describe('asNonEmptyString', () => {
  it('trims and returns text', () => {
    expect(asNonEmptyString('  abc  ')).toBe('abc');
  });
  it('returns null for empty / blank / null', () => {
    expect(asNonEmptyString('')).toBeNull();
    expect(asNonEmptyString('   ')).toBeNull();
    expect(asNonEmptyString(null)).toBeNull();
    expect(asNonEmptyString(undefined)).toBeNull();
  });
});

describe('firstNonEmpty', () => {
  it('returns the first non-empty argument', () => {
    expect(firstNonEmpty('', 'b', null)).toBe('b');
    expect(firstNonEmpty('a', 'b', 'c')).toBe('a');
    expect(firstNonEmpty('', '', '')).toBeNull();
  });
});

describe('extractIngredientTokens', () => {
  it('splits on separators and strips strengths', () => {
    const tokens = extractIngredientTokens(
      '对乙酰氨基酚(扑热息痛) 500mg、布洛芬+咖啡因；维生素C and 维生素B1',
    );
    expect(tokens.has(normalizeToken('对乙酰氨基酚'))).toBe(true);
    // 括号内别名被当作注释剥离，不产出独立 token
    expect(tokens.has(normalizeToken('扑热息痛'))).toBe(false);
    expect(tokens.has(normalizeToken('布洛芬'))).toBe(true);
    expect(tokens.has(normalizeToken('咖啡因'))).toBe(true);
    expect(tokens.has(normalizeToken('维生素C'))).toBe(true);
    expect(tokens.has(normalizeToken('维生素B1'))).toBe(true);
    // 剂量被剥离
    expect(tokens.has('500mg')).toBe(false);
  });
});

describe('canonicalIngredientKeysFor', () => {
  it('maps variants to the canonical key', () => {
    const keys = canonicalIngredientKeysFor(
      new Set([normalizeToken('paracetamol')]),
    );
    expect(keys.has('acetaminophen')).toBe(true);
  });
  it('keeps unknown tokens as-is', () => {
    const keys = canonicalIngredientKeysFor(new Set(['someunknown']));
    expect(keys.has('someunknown')).toBe(true);
  });
});

describe('expandCanonicalIngredientTokens', () => {
  it('expands one variant into the full variant family', () => {
    const expanded = expandCanonicalIngredientTokens(
      new Set([normalizeToken('阿司匹林')]),
    );
    expect(expanded.has('aspirin')).toBe(true);
    expect(expanded.has(normalizeToken('乙酰水杨酸'))).toBe(true);
  });
});

describe('duplicateIngredientEvidence', () => {
  it('joins sorted tokens', () => {
    expect(duplicateIngredientEvidence(new Set(['b', 'a']))).toBe('a / b');
  });
});

describe('getDisplayName', () => {
  it('prefers trimmed item displayName over detail.name', () => {
    expect(getDisplayName(wrapper({ displayName: ' 布洛芬缓释胶囊 ' }))).toBe(
      '布洛芬缓释胶囊',
    );
  });
  it('falls back to detail.name when displayName is blank', () => {
    expect(
      getDisplayName(wrapper({ displayName: '   ', name: 'Fallback Name' })),
    ).toBe('Fallback Name');
  });
});

describe('getCanonicalIngredientKeys', () => {
  it('extracts cn ingredients and maps to canonical keys', () => {
    const med = wrapper({
      detail: { ingredients: '对乙酰氨基酚 500mg, 伪麻黄碱' },
    });
    const keys = getCanonicalIngredientKeys(med);
    expect(keys.has('acetaminophen')).toBe(true);
    // 命中 canonical 映射后原始 token 被归一，不再保留
    expect(keys.has('pseudoephedrine')).toBe(true);
  });
  it('returns empty set for manual sources', () => {
    expect(getCanonicalIngredientKeys(wrapper({ source: 'manual' })).size).toBe(
      0,
    );
  });
});

describe('getDrugbankSynonymTokens', () => {
  it('returns name + synonyms for drugbank source', () => {
    const med = wrapper({
      source: 'drugbank',
      name: 'Aspirin',
      detail: { synonyms: ['Acetylsalicylic Acid', '  '] },
    });
    const tokens = getDrugbankSynonymTokens(med);
    expect(tokens.has('aspirin')).toBe(true);
    expect(tokens.has(normalizeToken('acetylsalicylic acid'))).toBe(true);
    expect(tokens.has('')).toBe(false);
  });
  it('returns empty set for non-drugbank sources', () => {
    expect(getDrugbankSynonymTokens(wrapper({ source: 'cn' })).size).toBe(0);
  });
});

describe('getDrugbankIds', () => {
  it('uses sourceRefId for drugbank source', () => {
    expect(
      getDrugbankIds(wrapper({ source: 'drugbank', sourceRefId: 'DB0001' })),
    ).toEqual(new Set(['DB0001']));
  });
  it('reads drugbankIds array for cn source', () => {
    const med = wrapper({
      source: 'cn',
      detail: { drugbankIds: ['DB0001', '  ', 'DB0002'] },
    });
    expect(getDrugbankIds(med)).toEqual(new Set(['DB0001', 'DB0002']));
  });
});

describe('getDrugbankInteractionTargets', () => {
  it('extracts non-empty drugbankId targets', () => {
    const med = wrapper({
      source: 'drugbank',
      detail: {
        drugInteractions: [
          { drugbankId: 'DB0001', description: 'x' },
          { drugbankId: '  ', description: 'blank' },
          null,
          'string-not-object',
        ],
      },
    });
    expect(getDrugbankInteractionTargets(med)).toEqual(new Set(['DB0001']));
  });
  it('returns empty set for non-drugbank sources', () => {
    expect(getDrugbankInteractionTargets(wrapper({ source: 'cn' })).size).toBe(
      0,
    );
  });
});

describe('getAllSourceIngredientTokens', () => {
  it('includes canonical keys and the normalized display name', () => {
    const med = wrapper({
      displayName: '对乙酰氨基酚片',
      detail: { ingredients: '对乙酰氨基酚' },
    });
    const tokens = getAllSourceIngredientTokens(med);
    expect(tokens.has('acetaminophen')).toBe(true);
    expect(tokens.has(normalizeToken('对乙酰氨基酚片'))).toBe(true);
  });
});
