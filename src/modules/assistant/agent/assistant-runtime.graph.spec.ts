import {
  buildAssistantRuntimeGraph,
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './assistant-runtime.graph';

describe('AssistantFoundationGraph', () => {
  it('selects relevant tools from the user message', () => {
    expect(
      selectRelevantToolsForMessage('最近睡眠怎么样', [
        'get_user_profile',
        'get_sleep_summary_by_range',
        'get_current_medicines',
      ]),
    ).toEqual(['get_sleep_summary_by_range']);

    expect(
      selectRelevantToolsForMessage(
        '查一下国药准字H10900089这个药的成分和厂家',
        [
          'search_cn_medicine_products',
          'get_cn_medicine_detail',
          'search_medicine_leaflets',
        ],
      ),
    ).toEqual([
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
    ]);
  });

  it('selects point summary tools for dated history questions', () => {
    expect(
      selectRelevantToolsForMessage('看看 2026-06-17 的 today summary', [
        'get_recent_today_summaries',
        'get_today_summary_by_date',
      ]),
    ).toEqual(['get_today_summary_by_date']);

    expect(
      selectRelevantToolsForMessage('帮我看上次月报总结', [
        'get_recent_report_summaries',
        'get_report_summary_by_range',
      ]),
    ).toEqual(['get_report_summary_by_range']);

    expect(
      selectRelevantToolsForMessage('给我看看历史 Today AI 总结', [
        'get_recent_today_summaries',
        'get_today_summary_by_date',
      ]),
    ).toEqual(['get_recent_today_summaries']);

    expect(
      selectRelevantToolsForMessage('给我看看历史 Report AI 总结', [
        'get_recent_report_summaries',
        'get_report_summary_by_range',
      ]),
    ).toEqual(['get_recent_report_summaries']);
  });

  it('selects write-intent tools from save-style messages', () => {
    expect(
      selectRelevantToolsForMessage('帮我记一下今天喝了 300ml 水', [
        'get_today_records',
        'propose_create_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['get_today_records', 'propose_create_daily_record']);

    expect(
      selectRelevantToolsForMessage('把今天那条 300ml 饮水记录备注改一下', [
        'get_today_records',
        'propose_create_daily_record',
        'propose_update_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['propose_update_daily_record']);

    expect(
      selectRelevantToolsForMessage('把 assistant memory 关掉', [
        'propose_update_daily_record',
        'propose_update_user_settings',
      ]),
    ).toEqual(['propose_update_user_settings']);
  });

  it('derives allowed tools from enabled context sources', async () => {
    expect(
      selectAllowedToolsForContextSources(['health_profile', 'sleep_records']),
    ).toEqual([
      'get_today_summary_by_date',
      'get_report_summary_by_range',
      'get_recent_today_summaries',
      'get_recent_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_sleep_summary_by_range',
      'search_cn_medicine_products',
      'get_cn_medicine_detail',
      'search_medicine_leaflets',
      'search_medical_qa_corpus',
      'resolve_drugbank_entity',
      'get_drugbank_detail',
      'search_drugbank_passages',
      'propose_create_daily_record',
      'propose_update_user_settings',
    ]);

    const graph = buildAssistantRuntimeGraph();
    const result = await graph.invoke({
      userId: 'user-1',
      userMessage: '最近睡眠怎么样',
      locale: 'zh-CN',
      enabledContextSources: [
        'health_profile',
        'sleep_records',
        'current_medicines',
      ],
    });

    expect(result.allowedTools).toEqual([
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
      'search_medical_qa_corpus',
      'resolve_drugbank_entity',
      'get_drugbank_detail',
      'search_drugbank_passages',
      'propose_create_daily_record',
      'propose_update_user_settings',
    ]);
    expect(result.selectedTools).toEqual(['get_sleep_summary_by_range']);
    expect(result.loopCount).toBeLessThanOrEqual(3);
    expect(result.stopReason).toBe('answered');
    expect(result.route).toBe('respond');
  });
});
