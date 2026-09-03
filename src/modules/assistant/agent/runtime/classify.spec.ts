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
  'search_medicine_leaflets',
  'search_medical_qa_corpus',
  'resolve_drugbank_entity',
  'get_drugbank_detail',
  'search_drugbank_passages',
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
      'search_medicine_leaflets',
    ]);
  });

  it('classifies read × knowledge messages as mixed', () => {
    const result = classifyIntent(
      '查一下我最近的记录，顺便查查这个药的说明书',
      ALLOWED,
    );
    expect(result.intent).toBe('mixed');
    expect(result.relevantTools).toContain('search_medicine_leaflets');
    expect(result.relevantTools).toContain('get_records_by_range');
  });

  it('falls back to write_proposal when a write intent matches but tools are unavailable', () => {
    const result = classifyIntent('把 assistant memory 关掉', [
      'get_user_profile',
    ]);
    expect(result.intent).toBe('write_proposal');
    expect(result.relevantTools).toEqual([]);
  });
});
