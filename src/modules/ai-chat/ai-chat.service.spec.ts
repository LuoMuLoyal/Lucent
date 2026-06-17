import type { UserSettingsService } from '../user-settings/user-settings.service';
import type { AiChatAgentService } from './agent/ai-chat-agent.service';
import { AiChatService } from './ai-chat.service';

describe('AiChatService', () => {
  it('combines user permissions with system foundation status', async () => {
    const aiChatAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
        phase: 'foundation',
        chatModelConfigured: true,
        interactiveChatReady: false,
        langGraphReady: true,
        ragEnabled: false,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [
          'health_context_snapshot',
          'recent_daily_records',
          'recent_sleep_summary',
          'current_medicines',
        ],
        implementedToolNames: [],
        contextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
      }),
    } as unknown as AiChatAgentService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        aiChatEnabled: true,
        aiChatContext: {
          healthProfile: true,
          dailyRecords: false,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;

    const service = new AiChatService(aiChatAgentService, userSettingsService);
    const capabilities = await service.getCapabilities('user-1');

    expect(capabilities.phase).toBe('foundation');
    expect(capabilities.aiChatEnabled).toBe(true);
    expect(capabilities.tools).toEqual([
      {
        name: 'health_context_snapshot',
        requiredContextSources: ['health_profile'],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
      {
        name: 'recent_daily_records',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: false,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'recent_sleep_summary',
        requiredContextSources: ['sleep_records'],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
      {
        name: 'current_medicines',
        requiredContextSources: ['current_medicines'],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
    ]);
  });
});
