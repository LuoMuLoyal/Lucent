import {
  buildAiChatFoundationGraph,
  selectAllowedToolsForContextSources,
  selectRelevantToolsForMessage,
} from './ai-chat-agent.graph';

describe('AiChatFoundationGraph', () => {
  it('selects relevant tools from the user message', () => {
    expect(
      selectRelevantToolsForMessage('最近睡眠怎么样', [
        'health_context_snapshot',
        'recent_sleep_summary',
        'current_medicines',
      ]),
    ).toEqual(['recent_sleep_summary']);
  });

  it('derives allowed tools from enabled context sources', async () => {
    expect(
      selectAllowedToolsForContextSources(['health_profile', 'sleep_records']),
    ).toEqual(['health_context_snapshot', 'recent_sleep_summary']);

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
      'health_context_snapshot',
      'recent_sleep_summary',
      'current_medicines',
    ]);
    expect(result.selectedTools).toEqual(['recent_sleep_summary']);
    expect(result.route).toBe('respond');
  });
});
