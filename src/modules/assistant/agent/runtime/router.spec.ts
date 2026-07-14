import {
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './router';

describe('selectAllowedToolsForContextSources', () => {
  it('returns only tools with no required sources when no context sources are enabled', () => {
    const tools = selectAllowedToolsForContextSources([]);
    // Tools with empty required-sources array are always available
    expect(tools).toContain('get_today_summary_by_date');
    expect(tools).toContain('get_user_settings');
    // Tools requiring specific sources should not be included
    expect(tools).not.toContain('get_today_records');
    expect(tools).not.toContain('get_user_profile');
    expect(tools).not.toContain('get_current_medicines');
  });

  it('returns tools that require only the given sources', () => {
    const tools = selectAllowedToolsForContextSources(['health_profile']);
    expect(tools).toContain('get_user_profile');
    expect(tools).toContain('get_user_settings');
    // Tools requiring daily_records should not be included
    expect(tools).not.toContain('get_today_records');
    // propose_create_daily_record has empty required sources, so it IS included
    expect(tools).toContain('propose_create_daily_record');
  });

  it('includes record tools when daily_records is enabled', () => {
    const tools = selectAllowedToolsForContextSources([
      'health_profile',
      'daily_records',
    ]);
    expect(tools).toContain('get_today_records');
    expect(tools).toContain('propose_create_daily_record');
  });

  it('includes sleep tools when sleep_records is enabled', () => {
    const tools = selectAllowedToolsForContextSources(['sleep_records']);
    expect(tools).toContain('get_sleep_summary_by_range');
  });

  it('includes medicine tools when current_medicines is enabled', () => {
    const tools = selectAllowedToolsForContextSources(['current_medicines']);
    expect(tools).toContain('get_current_medicines');
  });

  it('includes knowledge tools regardless of context sources (always available)', () => {
    const tools = selectAllowedToolsForContextSources([]);
    expect(tools).toContain('search_cn_medicine_products');
    expect(tools).toContain('search_medicine_leaflets');
    expect(tools).toContain('search_medical_qa_corpus');
    expect(tools).toContain('resolve_drugbank_entity');
  });
});

describe('selectRelevantToolsForMessage', () => {
  const allReadTools = [
    'get_today_records',
    'get_records_by_date',
    'get_records_by_range',
    'get_today_summary_by_date',
    'get_report_summary_by_range',
    'get_recent_today_summaries',
    'get_recent_report_summaries',
    'get_user_profile',
    'get_user_settings',
    'get_current_medicines',
    'get_sleep_summary_by_range',
    'search_cn_medicine_products',
    'get_cn_medicine_detail',
    'search_medicine_leaflets',
    'resolve_drugbank_entity',
    'get_drugbank_detail',
    'search_drugbank_passages',
    'search_medical_qa_corpus',
  ] as const;

  const allWriteTools = [
    'propose_create_daily_record',
    'propose_update_daily_record',
    'propose_delete_daily_record',
    'propose_update_user_settings',
  ] as const;

  // ── Keyword matching ──────────────────────────────────────────

  it('matches today records query', () => {
    expect(
      selectRelevantToolsForMessage('今天的记录', [...allReadTools]),
    ).toEqual(expect.arrayContaining(['get_today_records']));
  });

  it('matches English "today" query', () => {
    expect(
      selectRelevantToolsForMessage('Show me today records', [...allReadTools]),
    ).toEqual(expect.arrayContaining(['get_today_records']));
  });

  it('matches date-specific records query', () => {
    expect(
      selectRelevantToolsForMessage('2026-07-14 的记录', [...allReadTools]),
    ).toEqual(expect.arrayContaining(['get_records_by_date']));
  });

  it('matches range records query', () => {
    expect(
      selectRelevantToolsForMessage('最近7天的记录', [...allReadTools]),
    ).toEqual(expect.arrayContaining(['get_records_by_range']));
  });

  it('matches sleep query', () => {
    const result = selectRelevantToolsForMessage('最近睡眠怎么样', [
      ...allReadTools,
    ]);
    // "最近" also matches get_records_by_range, so both are returned
    expect(result).toContain('get_sleep_summary_by_range');
    expect(result).toContain('get_records_by_range');
  });

  it('matches English sleep query', () => {
    expect(
      selectRelevantToolsForMessage('How is my sleep lately?', [
        ...allReadTools,
      ]),
    ).toEqual(['get_sleep_summary_by_range']);
  });

  it('matches profile/allergy query', () => {
    expect(
      selectRelevantToolsForMessage('我的过敏情况', [...allReadTools]),
    ).toEqual(expect.arrayContaining(['get_user_profile']));
  });

  it('matches medicine query', () => {
    expect(
      selectRelevantToolsForMessage('我吃的药有哪些', [...allReadTools]),
    ).toEqual(expect.arrayContaining(['get_current_medicines']));
  });

  // ── CN product explicit routing ───────────────────────────────

  it('routes to CN product tools for 国药准字 queries', () => {
    const result = selectRelevantToolsForMessage('查一下国药准字H10900089', [
      ...allReadTools,
    ]);
    expect(result).toContain('search_cn_medicine_products');
    expect(result).toContain('get_cn_medicine_detail');
  });

  it('includes leaflet tools when CN product query mentions 说明书', () => {
    const result = selectRelevantToolsForMessage('国药准字H10900089的说明书', [
      ...allReadTools,
    ]);
    expect(result).toContain('search_medicine_leaflets');
  });

  // ── Write intent ──────────────────────────────────────────────

  it('selects create record tool for save intent', () => {
    const result = selectRelevantToolsForMessage('帮我记一下今天喝了水', [
      'get_today_records',
      ...allWriteTools,
    ]);
    expect(result).toContain('propose_create_daily_record');
    expect(result).toContain('get_today_records');
  });

  it('selects update record tool for edit intent', () => {
    const result = selectRelevantToolsForMessage('修改记录', [
      'get_today_records',
      ...allWriteTools,
    ]);
    expect(result).toEqual(['propose_update_daily_record']);
  });

  it('selects delete record tool for delete intent', () => {
    const result = selectRelevantToolsForMessage('删除记录', [
      'get_today_records',
      ...allWriteTools,
    ]);
    expect(result).toEqual(['propose_delete_daily_record']);
  });

  it('selects settings tool for toggle intent', () => {
    const result = selectRelevantToolsForMessage('关闭AI记忆', [
      ...allWriteTools,
    ]);
    expect(result).toEqual(['propose_update_user_settings']);
  });

  // ── Summary routing ───────────────────────────────────────────

  it('routes to today summary by date for dated summary query', () => {
    const result = selectRelevantToolsForMessage(
      '看看 2026-06-17 的 today summary',
      ['get_recent_today_summaries', 'get_today_summary_by_date'],
    );
    expect(result).toEqual(['get_today_summary_by_date']);
  });

  it('routes to report summary for report query', () => {
    const result = selectRelevantToolsForMessage('帮我看上次月报总结', [
      'get_recent_report_summaries',
      'get_report_summary_by_range',
    ]);
    expect(result).toEqual(['get_report_summary_by_range']);
  });

  it('routes to recent today summaries for history query', () => {
    const result = selectRelevantToolsForMessage('给我看看历史 Today AI 总结', [
      'get_recent_today_summaries',
      'get_today_summary_by_date',
    ]);
    expect(result).toEqual(['get_recent_today_summaries']);
  });

  // ── Fallback behavior ─────────────────────────────────────────

  it('returns empty array when no tools match and no broad rules apply', () => {
    expect(selectRelevantToolsForMessage('你好', [...allReadTools])).toEqual(
      [],
    );
  });

  it('returns broad record tools for generic record queries', () => {
    const result = selectRelevantToolsForMessage('看看我的记录', [
      'get_today_records',
      ...allReadTools.filter((t) => t !== 'get_today_records'),
    ]);
    expect(result).toEqual(['get_today_records']);
  });

  it('returns sorted retrieval tools for broad personalized query', () => {
    const result = selectRelevantToolsForMessage('最近怎么样', [
      ...allReadTools,
    ]);
    // Should return sorted retrieval tools
    expect(result.length).toBeGreaterThan(0);
    // CN product tools should come before DrugBank tools
    const cnIdx = result.indexOf('search_cn_medicine_products');
    const dbIdx = result.indexOf('resolve_drugbank_entity');
    if (cnIdx !== -1 && dbIdx !== -1) {
      expect(cnIdx).toBeLessThan(dbIdx);
    }
  });

  it('returns empty array when allowedTools is empty', () => {
    expect(selectRelevantToolsForMessage('任何消息', [])).toEqual([]);
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('handles empty user message', () => {
    expect(selectRelevantToolsForMessage('', [...allReadTools])).toEqual([]);
  });

  it('only returns tools that are in allowedTools', () => {
    const result = selectRelevantToolsForMessage('今天的记录', [
      'get_user_profile',
    ]);
    // get_today_records is not in allowedTools, so it should not be returned
    expect(result).not.toContain('get_today_records');
  });

  it('falls back to sleep tools for broad sleep keyword', () => {
    const result = selectRelevantToolsForMessage('我失眠了', [
      'get_sleep_summary_by_range',
      'get_user_profile',
    ]);
    expect(result).toEqual(['get_sleep_summary_by_range']);
  });
});
