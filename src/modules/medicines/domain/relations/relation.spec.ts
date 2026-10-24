import { describe, expect, it } from 'vitest';

import {
  resolveRelationDirection,
  resolveRelationKind,
  UNKNOWN_RELATION_KIND,
} from './relation.js';

/**
 * 边类型归一是所有图查询共用的最小单元：Neo4j 的边标签是**大写**的
 * （`INHIBITS`），领域层用**驼峰**（`inhibits`）。这一层错一次，所有查询都会
 * 静默查到空。
 */
describe('resolveRelationKind', () => {
  it('maps every known edge label', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['INHIBITS', 'inhibits'],
      ['INDUCES', 'induces'],
      ['SUBSTRATE_OF', 'substrateOf'],
      ['ACTS_ON', 'actsOn'],
      ['INTERACTS_WITH', 'interactsWith'],
      ['CARRIED_BY', 'carriedBy'],
      ['TRANSPORTED_BY', 'transportedBy'],
    ];

    for (const [label, expected] of cases) {
      expect(resolveRelationKind(label)).toBe(expected);
    }
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    // 上游导出的大小写不保证；这里放宽比到处写 .toUpperCase() 更省事。
    expect(resolveRelationKind('inhibits')).toBe('inhibits');
    expect(resolveRelationKind('  Inhibits  ')).toBe('inhibits');
  });

  it('keeps unknown labels distinguishable instead of dropping them', () => {
    // 上游新增关系类型时必须能识别出「我们不认识它」，而不是当成已知类型处理。
    expect(resolveRelationKind('SOME_NEW_RELATION')).toBe(
      UNKNOWN_RELATION_KIND,
    );
    expect(resolveRelationKind('')).toBe(UNKNOWN_RELATION_KIND);
  });
});

describe('resolveRelationDirection', () => {
  it('treats interactions as symmetric', () => {
    // 相互作用在语义上无方向，界面不能画成单向箭头——讲反方向和讲错结论一样危险。
    expect(resolveRelationDirection('interactsWith')).toBe('symmetric');
  });

  it('treats every other relation as directed', () => {
    for (const kind of [
      'inhibits',
      'induces',
      'substrateOf',
      'actsOn',
      'carriedBy',
      'transportedBy',
      UNKNOWN_RELATION_KIND,
    ] as const) {
      expect(resolveRelationDirection(kind)).toBe('forward');
    }
  });
});
