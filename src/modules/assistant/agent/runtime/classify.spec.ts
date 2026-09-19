import { describe, expect, it } from 'vitest';
import { classifyIntent } from './classify.js';

const ALLOWED = [
  'get_today_records',
  'get_records_by_date',
  'get_records_by_range',
  'get_sleep_summary_by_range',
  'get_user_profile',
  'get_user_settings',
  'get_current_medicines',
  'search_cn_medicine_products',
  'get_cn_medicine_detail',
  'search_cn_medicine_knowledge',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
  'reason_over_ontology',
  'propose_create_daily_record',
  'propose_update_daily_record',
  'propose_delete_daily_record',
  'propose_update_user_settings',
] as const;

describe('classifyIntent', () => {
  it('classifies greeting / chit-chat as simple_chat', () => {
    expect(classifyIntent('你好', ALLOWED)).toEqual({
      intent: 'simple_chat',
      relevantTools: [],
    });
    expect(classifyIntent('how are you', ALLOWED)).toEqual({
      intent: 'simple_chat',
      relevantTools: [],
    });
    expect(classifyIntent('', ALLOWED)).toEqual({
      intent: 'simple_chat',
      relevantTools: [],
    });
  });

  it('classifies user-data reads as read_data', () => {
    const result = classifyIntent('最近睡眠怎么样', ALLOWED);
    expect(result.intent).toBe('read_data');
    expect(result.relevantTools).toContain('get_sleep_summary_by_range');
  });

  it('classifies write intents as write_proposal (aux reads merge in)', () => {
    const result = classifyIntent('帮我记一下今天喝了 300ml 水', ALLOWED);
    expect(result.intent).toBe('write_proposal');
    expect(result.relevantTools).toContain('propose_create_daily_record');
    expect(result.relevantTools).toContain('get_today_records');
  });

  it('classifies medicine knowledge questions as knowledge', () => {
    const result = classifyIntent(
      '查一下国药准字H10900089这个药的成分和厂家',
      ALLOWED,
    );
    expect(result.intent).toBe('knowledge');
    expect(result.relevantTools).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_cn_medicine_knowledge',
    ]);
  });

  it('classifies read × knowledge messages as mixed', () => {
    const result = classifyIntent(
      '查一下我最近的记录，顺便查查这个药的说明书',
      ALLOWED,
    );
    expect(result.intent).toBe('mixed');
    expect(result.relevantTools).toContain('search_cn_medicine_knowledge');
    expect(result.relevantTools).toContain('get_records_by_range');
  });

  // 回归：本体推理工具漏出知识集合时，命中它的消息会被判成"读个人数据"，
  // 路由到 read 子图后模型只拿到个人记录工具（实测会自称"只能查用药记录"）。
  //
  // 断言只钉"工具必须被提供"：英文问题里出现 drug/medicine 会同时命中
  // `get_current_medicines` 的 `/drug/i`，于是 intent 是 knowledge 还是 mixed
  // 取决于这条预存在的路由特性（mixed 走通用 agent 节点，工具照样绑上）。
  it('offers ontology reasoning for pharmacology questions', () => {
    for (const message of [
      'Which drugs interact with warfarin?',
      'Which drugs share a target with clopidogrel?',
      'Which drugs inhibit the enzyme that metabolizes warfarin?',
    ]) {
      const result = classifyIntent(message, ALLOWED);
      expect(result.relevantTools, message).toContain('reason_over_ontology');
      expect(['knowledge', 'mixed'], message).toContain(result.intent);
    }
  });

  it('falls back to write_proposal when a write intent matches but tools are unavailable', () => {
    const result = classifyIntent('把 assistant memory 关掉', [
      'get_user_profile',
    ]);
    expect(result.intent).toBe('write_proposal');
    expect(result.relevantTools).toEqual([]);
  });
});
