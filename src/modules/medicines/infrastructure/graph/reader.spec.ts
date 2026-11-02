import { describe, expect, it, vi } from 'vitest';

import type { MedicineGraphExecutor } from './executor.js';
import { Neo4jGraphReader } from './reader.js';

/**
 * `Neo4jGraphReader` 的职责是**领域参数 → 受控查询**之间的那一段：
 * 去重、截断、短路的空答案、字段选择集。
 *
 * 这些逻辑不依赖 Neo4j，用假的 executor 就能测——真实图查询的行为由
 * `schema.spec.ts`（schema 可构建）与 e2e（契约与降级）分别覆盖。
 */
function fakeExecutor(result: unknown = []) {
  const run = vi.fn().mockResolvedValue({ ok: true, value: result });
  return {
    executor: {
      run,
      isConfigured: () => true,
    } as unknown as MedicineGraphExecutor,
    run,
  };
}

describe('Neo4jGraphReader', () => {
  it('两药查询会去重并保持顺序', async () => {
    const { executor, run } = fakeExecutor();
    const reader = new Neo4jGraphReader(executor);

    await reader.mechanismPaths(['DB00682', 'DB00682', 'DB00004']);

    expect(run).toHaveBeenCalledWith(
      'mechanismPaths',
      { drugbankIds: ['DB00682', 'DB00004'] },
      expect.any(String),
    );
  });

  it('超过 10 个药时截断而不是报错', async () => {
    // 上限保护在 Cypher 的 LIMIT 里；这里截断是为了少打几次组合，
    // 同时让绕过 HTTP 层的其它调用方也受同一约束。
    const { executor, run } = fakeExecutor();
    const reader = new Neo4jGraphReader(executor);
    const ids = Array.from(
      { length: 15 },
      (_, i) => `DB${String(i + 1).padStart(5, '0')}`,
    );

    await reader.sharedTargets(ids);

    const args = run.mock.calls.at(0)?.[1] as { drugbankIds: string[] };
    expect(args.drugbankIds).toHaveLength(10);
  });

  it('不足两个药时返回确定的空答案，不查图', async () => {
    // 「一个药之间没有两两通路」是**确定的答案**，不是「查不了」。
    // 返回 ok 让调用方能区分这两种情况。
    const { executor, run } = fakeExecutor();
    const reader = new Neo4jGraphReader(executor);

    await expect(reader.mechanismPaths(['DB00682'])).resolves.toEqual({
      ok: true,
      value: [],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('同一个药的最短路径不查图，直接给空', async () => {
    const { executor, run } = fakeExecutor();
    const reader = new Neo4jGraphReader(executor);

    await expect(reader.shortestRoute('DB00682', 'DB00682')).resolves.toEqual({
      ok: true,
      value: [],
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('空白 id 被过滤掉', async () => {
    const { executor, run } = fakeExecutor();
    const reader = new Neo4jGraphReader(executor);

    await reader.enzymeDuel(['DB00682', '  ', 'DB00004']);

    expect(run).toHaveBeenCalledWith(
      'enzymeDuel',
      { drugbankIds: ['DB00682', 'DB00004'] },
      expect.any(String),
    );
  });

  it('executor 的失败原样透传，不被改写成成功', async () => {
    // 最关键的一条：任何一层都不许把「查不了」变成「没有」。
    const run = vi.fn().mockResolvedValue({ ok: false, reason: 'timeout' });
    const reader = new Neo4jGraphReader({
      run,
      isConfigured: () => true,
    } as unknown as MedicineGraphExecutor);

    await expect(reader.drugActions('DB00682')).resolves.toEqual({
      ok: false,
      reason: 'timeout',
    });
  });

  it('isConfigured 委托给 executor', () => {
    const reader = new Neo4jGraphReader({
      isConfigured: () => false,
    } as unknown as MedicineGraphExecutor);

    expect(reader.isConfigured()).toBe(false);
  });
});
