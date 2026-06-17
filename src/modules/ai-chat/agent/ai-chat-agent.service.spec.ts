import { AIMessageChunk } from '@langchain/core/messages';
import type { LlmRuntimeService } from '../../llm-runtime/llm-runtime.service';
import { AiChatAgentService } from './ai-chat-agent.service';

describe('AiChatAgentService', () => {
  it('describes the phase-1 backend foundation', () => {
    const llmRuntimeService = {
      hasRoleConfig: jest
        .fn()
        .mockImplementation((role: string) => role === 'chat'),
    } as unknown as LlmRuntimeService;

    const service = new AiChatAgentService(llmRuntimeService);

    expect(service.hasChatModel()).toBe(true);
    expect(service.describeFoundation()).toEqual({
      phase: 'foundation',
      chatModelConfigured: true,
      interactiveChatReady: true,
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: ['prepare_context', 'respond'],
      toolNames: [
        'health_context_snapshot',
        'recent_daily_records',
        'recent_sleep_summary',
        'current_medicines',
      ],
      implementedToolNames: [
        'health_context_snapshot',
        'recent_daily_records',
        'recent_sleep_summary',
        'current_medicines',
      ],
      contextSources: [
        'health_profile',
        'daily_records',
        'sleep_records',
        'current_medicines',
      ],
    });
  });

  it('streams assistant chunks into one final message', async () => {
    async function* buildStream() {
      await Promise.resolve();
      yield new AIMessageChunk({ content: 'Hello' });
      yield new AIMessageChunk({ content: ' world' });
    }

    const llmRuntimeService = {
      hasRoleConfig: jest.fn().mockReturnValue(true),
      createChatModel: jest.fn().mockReturnValue({
        stream: jest.fn().mockResolvedValue(buildStream()),
      }),
    } as unknown as LlmRuntimeService;

    const service = new AiChatAgentService(llmRuntimeService);
    const onChunk = jest.fn();

    const result = await service.generateStream(
      {
        locale: 'en',
        messages: [{ role: 'user', content: 'Hi' }],
        allowedTools: [],
        toolResults: [],
      },
      onChunk,
    );

    expect(result).toEqual({
      content: 'Hello world',
      usedToolNames: [],
    });
    expect(onChunk).toHaveBeenNthCalledWith(1, { content: 'Hello' });
    expect(onChunk).toHaveBeenNthCalledWith(2, { content: ' world' });
  });
});
