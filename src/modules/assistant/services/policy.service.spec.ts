import { AssistantPolicyService } from './policy.service';
import type { AssistantRuntimeCapabilities } from '../types/assistant.types';

describe('AssistantPolicyService', () => {
  const service = new AssistantPolicyService();

  it('derives executable tools from foundation and user settings', () => {
    const policy = service.evaluate(
      {
        phase: 'foundation',
        chatModelConfigured: true,
        interactiveChatReady: true,
        langGraphReady: true,
        ragEnabled: true,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [
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
          'search_medical_qa_corpus',
          'resolve_drugbank_entity',
          'get_drugbank_detail',
          'search_drugbank_passages',
          'propose_create_daily_record',
          'propose_update_daily_record',
          'propose_delete_daily_record',
          'propose_update_user_settings',
        ],
        implementedToolNames: [
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
          'search_medical_qa_corpus',
          'resolve_drugbank_entity',
          'get_drugbank_detail',
          'search_drugbank_passages',
          'propose_create_daily_record',
          'propose_update_daily_record',
          'propose_delete_daily_record',
          'propose_update_user_settings',
        ],
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
        assistantEnabled: true,
        assistantMemoryEnabled: false,
        assistantContext: {
          healthProfile: true,
          dailyRecords: false,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
        passwordReauthenticationRequired: true,
      },
    );

    expect(policy.interactiveChatReady).toBe(true);
    expect(policy.enabledContextSources).toEqual([
      'health_profile',
      'sleep_records',
      'current_medicines',
    ]);
    expect(policy.contextPermittedToolNames).toEqual([
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
    expect(policy.executableToolNames).toEqual([
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
    expect(policy.toolCapabilities).toEqual([
      {
        name: 'get_today_records',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: true,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'get_records_by_date',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: true,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'get_records_by_range',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: true,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'get_today_summary_by_date',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_report_summary_by_range',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_recent_today_summaries',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_recent_report_summaries',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
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
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_sleep_summary_by_range',
        requiredContextSources: ['sleep_records'],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'search_cn_medicine_products',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_cn_medicine_detail',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'search_medicine_leaflets',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'search_medical_qa_corpus',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'resolve_drugbank_entity',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'get_drugbank_detail',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'search_drugbank_passages',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'propose_create_daily_record',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
      {
        name: 'propose_update_daily_record',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: true,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'propose_delete_daily_record',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: true,
        enabled: false,
        disabledReason: 'context_disabled',
      },
      {
        name: 'propose_update_user_settings',
        requiredContextSources: [],
        permittedByUser: true,
        implemented: true,
        enabled: true,
        disabledReason: null,
      },
    ]);
  });

  // ── Edge cases ────────────────────────────────────────────────────────

  const ALL_TOOLS = [
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
    'search_medical_qa_corpus',
    'resolve_drugbank_entity',
    'get_drugbank_detail',
    'search_drugbank_passages',
    'propose_create_daily_record',
    'propose_update_daily_record',
    'propose_delete_daily_record',
    'propose_update_user_settings',
  ] as const;

  function buildFoundation(
    overrides: Partial<Omit<AssistantRuntimeCapabilities, 'phase'>> = {},
  ): AssistantRuntimeCapabilities {
    return {
      phase: 'foundation',
      chatModelConfigured: true,
      interactiveChatReady: true,
      langGraphReady: true,
      ragEnabled: true,
      graphNodeNames: ['prepare_context', 'respond'],
      toolNames: [...ALL_TOOLS],
      implementedToolNames: [...ALL_TOOLS],
      contextSources: [
        'health_profile',
        'daily_records',
        'sleep_records',
        'current_medicines',
      ],
      ...overrides,
    };
  }

  function buildSettings(
    overrides: Partial<{
      aiSummariesEnabled: boolean;
      dataSharingConsent: boolean;
      assistantEnabled: boolean;
      assistantMemoryEnabled: boolean;
      healthProfile: boolean;
      dailyRecords: boolean;
      sleepRecords: boolean;
      currentMedicines: boolean;
    }> = {},
  ) {
    const {
      healthProfile,
      dailyRecords,
      sleepRecords,
      currentMedicines,
      ...rest
    } = overrides;
    return {
      aiSummariesEnabled: true,
      dataSharingConsent: false,
      assistantEnabled: true,
      assistantMemoryEnabled: false,
      assistantContext: {
        healthProfile: healthProfile ?? true,
        dailyRecords: dailyRecords ?? true,
        sleepRecords: sleepRecords ?? true,
        currentMedicines: currentMedicines ?? true,
      },
      updatedAt: '2026-06-17T12:00:00.000Z',
      passwordReauthenticationRequired: true,
      ...rest,
    };
  }

  it('disables all tools and sets interactiveChatReady=false when assistantEnabled is false', () => {
    const policy = service.evaluate(
      buildFoundation(),
      buildSettings({ assistantEnabled: false }),
    );

    expect(policy.interactiveChatReady).toBe(false);
    expect(policy.contextPermittedToolNames).toEqual([]);
    expect(policy.executableToolNames).toEqual([]);
    expect(policy.toolCapabilities.every((tc) => !tc.enabled)).toBe(true);
    expect(
      policy.toolCapabilities.every(
        (tc) => tc.disabledReason === 'chat_disabled',
      ),
    ).toBe(true);
  });

  it('returns empty enabledContextSources when all context toggles are off', () => {
    const policy = service.evaluate(
      buildFoundation(),
      buildSettings({
        healthProfile: false,
        dailyRecords: false,
        sleepRecords: false,
        currentMedicines: false,
      }),
    );

    expect(policy.enabledContextSources).toEqual([]);
    // Tools that require no context source (e.g. get_user_settings) are still permitted
    expect(policy.contextPermittedToolNames).toContain('get_user_settings');
    // Tools that require a context source are not permitted
    expect(policy.contextPermittedToolNames).not.toContain('get_today_records');
    expect(policy.contextPermittedToolNames).not.toContain('get_user_profile');
  });

  it('marks tools as not_implemented when not in implementedToolNames', () => {
    const policy = service.evaluate(
      buildFoundation({
        implementedToolNames: ['get_user_settings', 'get_user_profile'],
      }),
      buildSettings(),
    );

    const settingsCap = policy.toolCapabilities.find(
      (tc) => tc.name === 'get_user_settings',
    );
    const recordsCap = policy.toolCapabilities.find(
      (tc) => tc.name === 'get_today_records',
    );

    expect(settingsCap?.enabled).toBe(true);
    expect(settingsCap?.disabledReason).toBeNull();
    expect(recordsCap?.implemented).toBe(false);
    expect(recordsCap?.enabled).toBe(false);
    expect(recordsCap?.disabledReason).toBe('not_implemented');
  });

  it('marks tools as model_not_configured when chatModelConfigured is false', () => {
    const policy = service.evaluate(
      buildFoundation({ chatModelConfigured: false }),
      buildSettings(),
    );

    expect(policy.toolCapabilities.every((tc) => !tc.enabled)).toBe(true);
    // When chatModelConfigured is false but assistantEnabled and context is on,
    // disabledReason should be model_not_configured
    const settingsCap = policy.toolCapabilities.find(
      (tc) => tc.name === 'get_user_settings',
    );
    expect(settingsCap?.disabledReason).toBe('model_not_configured');
  });

  it('filters executableToolNames to only implemented and permitted tools', () => {
    const policy = service.evaluate(
      buildFoundation({
        implementedToolNames: [
          'get_user_settings',
          'get_today_records',
          'search_cn_medicine_products',
        ],
      }),
      buildSettings({
        dailyRecords: false, // disables get_today_records
      }),
    );

    // get_today_records requires daily_records context, which is disabled
    expect(policy.executableToolNames).not.toContain('get_today_records');
    // get_user_settings and search_cn_medicine_products require no context
    expect(policy.executableToolNames).toContain('get_user_settings');
    expect(policy.executableToolNames).toContain('search_cn_medicine_products');
  });

  it('sets interactiveChatReady=false when foundation.interactiveChatReady is false', () => {
    const policy = service.evaluate(
      buildFoundation({ interactiveChatReady: false }),
      buildSettings(),
    );

    expect(policy.interactiveChatReady).toBe(false);
  });

  it('handles only sleep_records enabled', () => {
    const policy = service.evaluate(
      buildFoundation(),
      buildSettings({
        healthProfile: false,
        dailyRecords: false,
        sleepRecords: true,
        currentMedicines: false,
      }),
    );

    expect(policy.enabledContextSources).toEqual(['sleep_records']);
    expect(policy.contextPermittedToolNames).toContain(
      'get_sleep_summary_by_range',
    );
    expect(policy.contextPermittedToolNames).not.toContain('get_user_profile');
    expect(policy.contextPermittedToolNames).not.toContain(
      'get_current_medicines',
    );
  });
});
