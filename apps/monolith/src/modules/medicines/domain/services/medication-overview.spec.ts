import { describe, expect, it } from 'vitest';

import type { MedicationFact } from './medication-overview.js';
import {
  buildMedicationOverview,
  findDuplicateIngredients,
  groupBySource,
} from './medication-overview.js';

/**
 * 用药全景的聚合逻辑。
 *
 * 核心断言是「不同商品名、同一成分能被判为重复」——这是整个功能存在的理由。
 * 现有接口返回的是条目列表，患者从列表里看不出自己吃了两份同一个成分。
 */

function fact(overrides: Partial<MedicationFact> = {}): MedicationFact {
  return {
    entryId: 'entry-1',
    displayName: '药品 A',
    drugbankId: 'DB00001',
    ingredientKeys: ['ibuprofen'],
    healthEventIds: [],
    ...overrides,
  };
}

describe('findDuplicateIngredients', () => {
  it('flags two different brand names that share one ingredient', () => {
    // 患者自己加购时最常见的重复：商品名完全不同，成分相同。
    // 按药名比对永远发现不了这件事。
    const groups = findDuplicateIngredients([
      fact({
        entryId: 'e1',
        displayName: '芬必得',
        ingredientKeys: ['ibuprofen'],
      }),
      fact({
        entryId: 'e2',
        displayName: '布洛芬缓释胶囊',
        ingredientKeys: ['ibuprofen'],
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      ingredientKey: 'ibuprofen',
      entryIds: ['e1', 'e2'],
      displayNames: ['芬必得', '布洛芬缓释胶囊'],
      severity: 'medium',
    });
  });

  it('does not flag a single medicine as a duplicate', () => {
    const groups = findDuplicateIngredients([fact({ entryId: 'e1' })]);

    expect(groups).toEqual([]);
  });

  it('does not flag different ingredients', () => {
    const groups = findDuplicateIngredients([
      fact({ entryId: 'e1', ingredientKeys: ['ibuprofen'] }),
      fact({ entryId: 'e2', ingredientKeys: ['paracetamol'] }),
    ]);

    expect(groups).toEqual([]);
  });

  it('ignores entries without parseable ingredients', () => {
    // 手动录入与 CN 源可能解析不出成分；它们无法参与判定，但不该让整体失败。
    const groups = findDuplicateIngredients([
      fact({ entryId: 'e1', ingredientKeys: [] }),
      fact({ entryId: 'e2', ingredientKeys: [] }),
    ]);

    expect(groups).toEqual([]);
  });

  it('counts an entry once even when it shares several ingredient keys', () => {
    // 复方药可能同时命中多个成分键，但同一条目在同一个键的分组里只出现一次。
    const groups = findDuplicateIngredients([
      fact({ entryId: 'e1', ingredientKeys: ['ibuprofen', 'pseudoephedrine'] }),
      fact({ entryId: 'e2', ingredientKeys: ['ibuprofen'] }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.entryIds).toEqual(['e1', 'e2']);
  });

  it('raises severity to high for three or more entries', () => {
    const groups = findDuplicateIngredients([
      fact({ entryId: 'e1' }),
      fact({ entryId: 'e2' }),
      fact({ entryId: 'e3' }),
    ]);

    expect(groups[0]?.severity).toBe('high');
  });

  it('raises severity to high when duplicates span drugbank and non-drugbank sources', () => {
    // 跨源重复比同源重复更难被用户察觉：两套数据里是不同的商品。
    const groups = findDuplicateIngredients([
      fact({ entryId: 'e1', drugbankId: 'DB00001' }),
      fact({ entryId: 'e2', drugbankId: null }),
    ]);

    expect(groups[0]?.severity).toBe('high');
  });

  it('sorts high severity first', () => {
    const groups = findDuplicateIngredients([
      fact({ entryId: 'e1', ingredientKeys: ['a'] }),
      fact({ entryId: 'e2', ingredientKeys: ['a'] }),
      fact({ entryId: 'e3', ingredientKeys: ['b'] }),
      fact({ entryId: 'e4', ingredientKeys: ['b'] }),
      fact({ entryId: 'e5', ingredientKeys: ['b'] }),
    ]);

    expect(groups[0]?.ingredientKey).toBe('b');
    expect(groups[1]?.ingredientKey).toBe('a');
  });
});

describe('groupBySource', () => {
  it('groups by health event and buckets unattributed entries separately', () => {
    const groups = groupBySource([
      fact({ entryId: 'e1', healthEventIds: ['event-a'], displayName: 'A' }),
      fact({ entryId: 'e2', healthEventIds: ['event-a'], displayName: 'B' }),
      fact({ entryId: 'e3', healthEventIds: [], displayName: 'C' }),
    ]);

    expect(groups).toEqual([
      { source: 'event-a', medicineCount: 2, displayNames: ['A', 'B'] },
      { source: 'unattributed', medicineCount: 1, displayNames: ['C'] },
    ]);
  });

  it('counts one entry under each event it belongs to', () => {
    // HealthEventMedicine 是多对多：一个药可以同时挂在两条病程下。
    // 用单值字段会把这个「同时属于两个病程」的信号掩盖掉。
    const groups = groupBySource([
      fact({
        entryId: 'e1',
        healthEventIds: ['event-a', 'event-b'],
        displayName: 'A',
      }),
      fact({ entryId: 'e2', healthEventIds: ['event-b'], displayName: 'B' }),
    ]);

    expect(groups).toEqual([
      { source: 'event-b', medicineCount: 2, displayNames: ['A', 'B'] },
      { source: 'event-a', medicineCount: 1, displayNames: ['A'] },
    ]);
  });

  it('sorts by count descending', () => {
    const groups = groupBySource([
      fact({ entryId: 'e1', healthEventIds: [] }),
      fact({ entryId: 'e2', healthEventIds: ['event-a'] }),
      fact({ entryId: 'e3', healthEventIds: ['event-a'] }),
    ]);

    expect(groups[0]?.source).toBe('event-a');
  });
});

describe('buildMedicationOverview', () => {
  it('reports both the total and the resolvable counts', () => {
    // 两个数都要给：只看 total 会让「有 3 个药没解析出成分」这件事隐形，
    // 而分析结论的可靠性正取决于可解析比例。
    const overview = buildMedicationOverview([
      fact({ entryId: 'e1' }),
      fact({ entryId: 'e2', ingredientKeys: [] }),
      fact({ entryId: 'e3', ingredientKeys: [] }),
    ]);

    expect(overview.totalMedicines).toBe(3);
    expect(overview.resolvableMedicines).toBe(1);
  });

  it('returns empty aggregates for an empty list', () => {
    expect(buildMedicationOverview([])).toEqual({
      totalMedicines: 0,
      resolvableMedicines: 0,
      duplicates: [],
      sourceOverlaps: [],
    });
  });
});
