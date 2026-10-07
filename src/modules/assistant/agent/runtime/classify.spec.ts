import { describe, expect, it } from 'vitest';
import { deriveIntent } from './classify.js';

/**
 * `deriveIntent` 是纯函数：把**模型选出的工具集**投影成 intent。
 *
 * 这里钉的是"工具集 → 意图"这层映射的既有语义（旧 `classify.spec.ts` 里凡是不依赖
 * 关键词匹配的意图期望都搬到了这里）。"哪条消息该选哪些工具"已经归模型，不再是
 * 单测能确定的东西 —— 那一层由 `test/fixtures/assistant-intent-eval.ts` 的评测集承接。
 */
describe('deriveIntent', () => {
  it('treats an empty tool set as simple_chat', () => {
    expect(deriveIntent([])).toBe('simple_chat');
  });

  it('classifies personal-data reads as read_data', () => {
    expect(deriveIntent(['get_sleep_summary_by_range'])).toBe('read_data');
    expect(deriveIntent(['get_today_records'])).toBe('read_data');
  });

  it('classifies knowledge tools as knowledge', () => {
    expect(deriveIntent(['search_cn_medicine_knowledge'])).toBe('knowledge');
    expect(deriveIntent(['search_cn_medicine_products'])).toBe('knowledge');
    expect(deriveIntent(['resolve_drugbank_entity'])).toBe('knowledge');
    // 本体/规则推理同属知识检索：漏掉它们会把药理问题判成"读个人数据"，
    // 于是模型只拿到个人记录工具（历史故障：模型自称"只能查用药记录"）。
    expect(deriveIntent(['reason_over_ontology'])).toBe('knowledge');
    expect(deriveIntent(['reason_over_rules'])).toBe('knowledge');
  });

  it('classifies write tools as write_proposal, even with their auxiliary read', () => {
    // 创建草稿会附带 `get_today_records` 当上下文，那不是真正的混合意图。
    expect(
      deriveIntent(['propose_create_daily_record', 'get_today_records']),
    ).toBe('write_proposal');
    expect(deriveIntent(['propose_update_user_settings'])).toBe(
      'write_proposal',
    );
  });

  it('classifies read × knowledge as mixed', () => {
    expect(
      deriveIntent(['search_cn_medicine_knowledge', 'get_records_by_range']),
    ).toBe('mixed');
  });

  it('classifies write × knowledge as mixed', () => {
    expect(
      deriveIntent(['propose_update_daily_record', 'get_drugbank_detail']),
    ).toBe('mixed');
  });

  it('keeps write tools winning over the read bucket regardless of order', () => {
    expect(
      deriveIntent(['get_user_profile', 'propose_update_user_settings']),
    ).toBe('write_proposal');
  });

  it('classifies an all-tools candidate set as mixed (the degradation shape)', () => {
    // 降级时图会把整个候选集绑上；这条只验证该形状**能被派生**（图另外强制 mixed）。
    expect(
      deriveIntent([
        'get_today_records',
        'search_cn_medicine_knowledge',
        'propose_create_daily_record',
      ]),
    ).toBe('mixed');
  });
});
