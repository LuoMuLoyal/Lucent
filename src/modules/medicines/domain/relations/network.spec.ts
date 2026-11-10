import { describe, expect, it } from 'vitest';

import {
  buildNetworkGraph,
  countTruncated,
  splitNeighbourBudget,
  MAX_NEIGHBOUR_LIMIT,
  DEFAULT_NEIGHBOUR_LIMIT,
  type NetworkDegree,
  type NetworkEdge,
  type NetworkNeighbour,
} from './network.js';

function neighbour(
  id: string,
  overrides: Partial<NetworkNeighbour> = {},
): NetworkNeighbour {
  return {
    id,
    name: `drug-${id}`,
    nodeKind: 'drug',
    inCatalogue: true,
    ...overrides,
  };
}

function edge(
  neighbourId: string,
  overrides: Partial<NetworkEdge> = {},
): NetworkEdge {
  return {
    kind: 'interaction',
    neighbourId,
    relationKind: null,
    actions: [],
    ...overrides,
  };
}

const DEGREE: NetworkDegree = { interactions: 2249, targets: 3 };

describe('countTruncated — 截断数来自真实度数减去已展示数', () => {
  it('全展示时不为负，且为 0', () => {
    const all = Array.from({ length: 2252 }, (_, i) => neighbour(`D${i}`));
    expect(countTruncated(DEGREE, all)).toBe(0);
  });

  it('只展示 30 个时，剩余数 = 总度数 - 30', () => {
    const shown = Array.from({ length: 30 }, (_, i) => neighbour(`D${i}`));
    // 2,249 相互作用 + 3 靶点 = 2,252
    expect(countTruncated(DEGREE, shown)).toBe(2222);
  });

  it('展示数超过总数时钳到 0，不产生负数', () => {
    // 防御性：度数统计与邻居数组理论上不会不一致，但负的「未显示数量」
    // 会让界面显示「还有 -3 个未显示」——宁可钳到 0。
    const shown = Array.from({ length: 10 }, (_, i) => neighbour(`D${i}`));
    expect(countTruncated({ interactions: 5, targets: 2 }, shown)).toBe(0);
  });

  it('零度数的药（无相互作用、无靶点）不产生截断', () => {
    expect(countTruncated({ interactions: 0, targets: 0 }, [])).toBe(0);
  });
});

describe('buildNetworkGraph — 图的装配', () => {
  it('把中心、度数、邻居与边原样带出，并算出截断数', () => {
    const shown = Array.from({ length: 30 }, (_, i) => neighbour(`D${i}`));
    const edges = shown.map((n) => edge(n.id));

    const graph = buildNetworkGraph({
      center: { id: 'DB00176', name: 'Fluvoxamine' },
      degree: DEGREE,
      neighbours: shown,
      edges,
    });

    expect(graph.center).toEqual({ id: 'DB00176', name: 'Fluvoxamine' });
    expect(graph.degree).toEqual(DEGREE);
    expect(graph.neighbours).toHaveLength(30);
    expect(graph.edges).toHaveLength(30);
    expect(graph.truncated).toBe(2222);
  });

  it('ordering 恒为 drugbank_id_asc，如实声明这不是重要性排序', () => {
    const graph = buildNetworkGraph({
      center: { id: 'DB00176', name: 'Fluvoxamine' },
      degree: DEGREE,
      neighbours: [],
      edges: [],
    });

    expect(graph.ordering).toBe('drugbank_id_asc');
  });

  it('空图（无相互作用、无靶点的药）不抛错，truncated 为 0', () => {
    const graph = buildNetworkGraph({
      center: { id: 'DB99999', name: 'Orphan' },
      degree: { interactions: 0, targets: 0 },
      neighbours: [],
      edges: [],
    });

    expect(graph.neighbours).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.truncated).toBe(0);
  });

  it('只有靶点没有相互作用的药，边的 kind 为 target', () => {
    const targets: NetworkNeighbour[] = [
      neighbour('T1', { nodeKind: 'protein', name: 'CYP2C9' }),
    ];
    const graph = buildNetworkGraph({
      center: { id: 'DB00176', name: 'Fluvoxamine' },
      degree: { interactions: 0, targets: 1 },
      neighbours: targets,
      edges: [
        edge('T1', {
          kind: 'target',
          relationKind: 'enzyme',
          actions: ['inhibitor'],
        }),
      ],
    });

    expect(graph.truncated).toBe(0);
    expect(graph.edges[0]?.kind).toBe('target');
    expect(graph.edges[0]?.relationKind).toBe('enzyme');
  });
});

describe('splitNeighbourBudget — limit 是总数上限，靶点优先', () => {
  it('靶点全部放得下时，余额给相互作用', () => {
    // DB00176 的真实形状：2,249 相互作用 / 3 靶点 / limit 30
    expect(splitNeighbourBudget(3, 2249, 30)).toEqual({
      targets: 3,
      interactions: 27,
    });
  });

  it('总数严格等于 limit，不会因为分两类而翻倍', () => {
    const { targets, interactions } = splitNeighbourBudget(3, 2249, 100);
    expect(targets + interactions).toBe(100);
  });

  it('limit 小于靶点数时只给靶点，相互作用为 0', () => {
    expect(splitNeighbourBudget(5, 1950, 3)).toEqual({
      targets: 3,
      interactions: 0,
    });
  });

  it('相互作用不足预算时按实际数量给，不凭空补数', () => {
    expect(splitNeighbourBudget(2, 4, 30)).toEqual({
      targets: 2,
      interactions: 4,
    });
  });

  it('零关系的药拿不到任何名额', () => {
    expect(splitNeighbourBudget(0, 0, 30)).toEqual({
      targets: 0,
      interactions: 0,
    });
  });

  it('limit 为 0 或负数时名额全为 0（防御性，DTO 已拦）', () => {
    expect(splitNeighbourBudget(3, 100, 0)).toEqual({
      targets: 0,
      interactions: 0,
    });
    expect(splitNeighbourBudget(3, 100, -5)).toEqual({
      targets: 0,
      interactions: 0,
    });
  });
});

describe('上限常量', () => {
  it('默认上限小于硬顶，且硬顶不是无穷大', () => {
    expect(DEFAULT_NEIGHBOUR_LIMIT).toBe(30);
    expect(MAX_NEIGHBOUR_LIMIT).toBe(100);
    expect(DEFAULT_NEIGHBOUR_LIMIT).toBeLessThan(MAX_NEIGHBOUR_LIMIT);
  });
});
