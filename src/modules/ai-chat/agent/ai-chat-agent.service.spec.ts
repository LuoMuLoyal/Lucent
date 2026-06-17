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
      chatModelConfigured: true,
      langGraphReady: true,
      ragEnabled: false,
      graphNodeNames: ['prepare_context', 'respond'],
      toolNames: [
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
});
