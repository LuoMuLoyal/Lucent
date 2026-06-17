import {
  buildAiChatFoundationGraph,
  selectAllowedToolsForContextSources,
} from './ai-chat-agent.graph';

describe('AiChatFoundationGraph', () => {
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
    expect(result.route).toBe('respond');
  });
});
