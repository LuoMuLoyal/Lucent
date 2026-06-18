import {
  buildAiChatFoundationGraph,
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './ai-chat-agent.graph';

describe('AiChatFoundationGraph', () => {
  it('selects relevant tools from the user message', () => {
    expect(
      selectRelevantToolsForMessage('最近睡眠怎么样', [
        'get_user_profile',
        'get_sleep_summary_by_range',
        'get_current_medicines',
      ]),
    ).toEqual(['get_sleep_summary_by_range']);
  });

  it('derives allowed tools from enabled context sources', async () => {
    expect(
      selectAllowedToolsForContextSources(['health_profile', 'sleep_records']),
    ).toEqual([
      'get_recent_today_summaries',
      'get_recent_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_sleep_summary_by_range',
    ]);

    const graph = buildAiChatFoundationGraph();
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
      'get_recent_today_summaries',
      'get_recent_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_current_medicines',
      'get_sleep_summary_by_range',
    ]);
    expect(result.selectedTools).toEqual(['get_sleep_summary_by_range']);
    expect(result.route).toBe('respond');
  });
});
