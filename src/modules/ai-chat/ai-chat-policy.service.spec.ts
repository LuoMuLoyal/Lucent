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
          'get_today_records',
          'get_records_by_date',
          'get_records_by_range',
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_current_medicines',
          'get_sleep_summary_by_range',
        ],
        implementedToolNames: ['get_user_profile', 'get_user_settings'],
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
        aiChatMemoryEnabled: false,
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
      'get_recent_today_summaries',
      'get_recent_report_summaries',
      'get_user_profile',
      'get_user_settings',
      'get_current_medicines',
      'get_sleep_summary_by_range',
    ]);
    expect(policy.executableToolNames).toEqual([
      'get_user_profile',
      'get_user_settings',
    ]);
    expect(policy.toolCapabilities).toEqual([
      {
        name: 'get_today_records',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: false,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'get_records_by_date',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: false,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'get_records_by_range',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: false,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'get_recent_today_summaries',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
      {
        name: 'get_recent_report_summaries',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
      {
        name: 'get_user_profile',
        requiredContextSources: ['health_profile'],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_user_settings',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_current_medicines',
        requiredContextSources: ['current_medicines'],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
      {
        name: 'get_sleep_summary_by_range',
        requiredContextSources: ['sleep_records'],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
    ]);
  });
});
