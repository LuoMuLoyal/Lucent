import { describe, expect, it } from 'vitest';
import { ASSISTANT_TOOL_NAMES } from '../../tools/shared/tool-types.js';
import {
  ASSISTANT_INTENT_EVAL_CANDIDATES,
  ASSISTANT_INTENT_EVAL_CASES,
} from './intent-eval.fixture.js';

/**
 * 评测集的**形状**校验。
 *
 * 调模型需要凭据，所以 CI 只能保证这份数据本身是可用的：
 * 工具名真实存在、`mustInclude`/`mustExclude` 不自相矛盾、id 唯一、
 * 以及三条事故样本在场的回归底线。
 */
describe('assistant intent eval fixture', () => {
  const knownTools = new Set<string>(ASSISTANT_TOOL_NAMES);

  it('only references tools that exist', () => {
    for (const evalCase of ASSISTANT_INTENT_EVAL_CASES) {
      for (const tool of [
        ...(evalCase.mustInclude ?? []),
        ...(evalCase.mustExclude ?? []),
        ...(evalCase.legacyKeywordTools ?? []),
      ]) {
        expect(knownTools.has(tool), `${evalCase.id} → ${tool}`).toBe(true);
      }
    }
    for (const tool of ASSISTANT_INTENT_EVAL_CANDIDATES) {
      expect(knownTools.has(tool), `candidate → ${tool}`).toBe(true);
    }
  });

  it('uses unique ids', () => {
    const ids = ASSISTANT_INTENT_EVAL_CASES.map((evalCase) => evalCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never requires and forbids the same tool', () => {
    for (const evalCase of ASSISTANT_INTENT_EVAL_CASES) {
      const forbidden = new Set(evalCase.mustExclude ?? []);
      for (const tool of evalCase.mustInclude ?? []) {
        expect(forbidden.has(tool), `${evalCase.id} → ${tool}`).toBe(false);
      }
    }
  });

  it('keeps every expectation inside the evaluation candidate set', () => {
    const candidates = new Set<string>(ASSISTANT_INTENT_EVAL_CANDIDATES);
    for (const evalCase of ASSISTANT_INTENT_EVAL_CASES) {
      for (const tool of evalCase.mustInclude ?? []) {
        expect(candidates.has(tool), `${evalCase.id} → ${tool}`).toBe(true);
      }
    }
    // 候选集就是全部工具：漏一个会让"全开"降级路径与评测口径不一致。
    expect([...ASSISTANT_INTENT_EVAL_CANDIDATES].sort()).toEqual(
      [...ASSISTANT_TOOL_NAMES].sort(),
    );
  });

  it('an exactly-empty case carries no positive expectation', () => {
    for (const evalCase of ASSISTANT_INTENT_EVAL_CASES) {
      if (evalCase.expectExactlyEmpty === true) {
        expect(evalCase.mustInclude ?? [], evalCase.id).toEqual([]);
      }
    }
  });

  it('pins the three 2026-10-07 production regressions', () => {
    const byId = new Map(
      ASSISTANT_INTENT_EVAL_CASES.map((evalCase) => [evalCase.id, evalCase]),
    );

    const capability = byId.get('incident-capability-question');
    expect(capability?.legacyKeywordTools).toEqual(['get_current_medicines']);

    const zh = byId.get('incident-interaction-zh');
    expect(zh?.mustInclude).toContain('search_cn_medicine_knowledge');
    expect(zh?.legacyKeywordTools).toContain('search_cn_medicine_knowledge');

    // 英文那条是"关键词规则漏召回"的直接证据：旧路由给不出中文散文检索工具。
    const en = byId.get('incident-interaction-en');
    expect(en?.mustExclude).toContain('search_cn_medicine_knowledge');
    expect(en?.legacyKeywordTools).not.toContain(
      'search_cn_medicine_knowledge',
    );
  });
});
