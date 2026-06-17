import { AiChatPolicyService } from './ai-chat-policy.service';

describe('AiChatPolicyService', () => {
  const service = new AiChatPolicyService();

  it('derives executable tools from foundation and user settings', () => {
    const policy = service.evaluate(
      {
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
        implementedToolNames: ['health_context_snapshot'],
        contextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
      },
      {
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
      },
    );

    expect(policy.interactiveChatReady).toBe(true);
    expect(policy.enabledContextSources).toEqual([
      'health_profile',
      'sleep_records',
      'current_medicines',
    ]);
    expect(policy.contextPermittedToolNames).toEqual([
      'health_context_snapshot',
      'recent_sleep_summary',
      'current_medicines',
    ]);
    expect(policy.executableToolNames).toEqual(['health_context_snapshot']);
    expect(policy.toolCapabilities).toEqual([
      {
        name: 'health_context_snapshot',
        requiredContextSources: ['health_profile'],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
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
