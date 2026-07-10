import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { UserSettingsService } from '../user-settings/services/user-settings.service';
import type { AssistantRuntimeService } from './agent/runtime.service';
import type { ToolExecutorFn } from './agent/runtime';
import type { AssistantConversationService } from './services/conversation.service';
import type { AssistantPolicyService } from './services/policy.service';
import type { AssistantContextService } from './tools/context.service';
import type { AssistantToolService } from './tools/tool.service';
import { AssistantService } from './services/core.service';

function conversationServiceDouble() {
  return {
    listRecentConversations: jest.fn(),
    getLatestConversation: jest.fn(),
    openConversation: jest.fn(),
    clearLatestConversation: jest.fn(),
    buildMemoryBlock: jest.fn().mockResolvedValue(''),
    persistAssistantTurn: jest.fn(),
  } as unknown as AssistantConversationService;
}

describe('AssistantService', () => {
  it('combines user permissions with system foundation status', async () => {
    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
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
          'get_today_summary_by_date',
          'get_report_summary_by_range',
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_current_medicines',
          'get_sleep_summary_by_range',
          'search_medicine_leaflets',
          'search_medical_qa_corpus',
          'resolve_drugbank_entity',
          'search_drugbank_passages',
          'propose_create_daily_record',
          'propose_update_daily_record',
          'propose_delete_daily_record',
          'propose_update_user_settings',
        ],
        implementedToolNames: [],
        contextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
      }),
    } as unknown as AssistantRuntimeService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
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
      }),
    } as unknown as UserSettingsService;

    const assistantPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: false,
        enabledContextSources: ['health_profile', 'sleep_records'],
        contextPermittedToolNames: [
          'get_today_summary_by_date',
          'get_report_summary_by_range',
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_sleep_summary_by_range',
        ],
        executableToolNames: [],
        toolCapabilities: [
          {
            name: 'get_user_profile',
            requiredContextSources: ['health_profile'],
            permittedByUser: true,
            implemented: false,
            enabled: false,
            disabledReason: 'not_implemented',
          },
          {
            name: 'get_today_records',
            requiredContextSources: ['daily_records'],
            permittedByUser: false,
            implemented: false,
            enabled: false,
            disabledReason: 'context_disabled',
          },
        ],
      }),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AssistantContextService;
    const assistantConversationService = conversationServiceDouble();

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );
    const capabilities = await service.getCapabilities('user-1');

    expect(capabilities.phase).toBe('foundation');
    expect(capabilities.assistantEnabled).toBe(true);
    expect(capabilities.interactiveChatReady).toBe(false);
    expect(capabilities.tools).toEqual([
      {
        name: 'get_user_profile',
        requiredContextSources: ['health_profile'],
        permittedByUser: true,
        implemented: false,
        enabled: false,
        disabledReason: 'not_implemented',
      },
      {
        name: 'get_today_records',
        requiredContextSources: ['daily_records'],
        permittedByUser: false,
        implemented: false,
        enabled: false,
        disabledReason: 'context_disabled',
      },
    ]);
  });

  it('streams a chat reply with executable tools only', async () => {
    const runConversation = jest
      .fn()
      .mockImplementation(async (_input, executeTools: ToolExecutorFn) => {
        const toolResults = await executeTools([
          'get_user_profile',
          'propose_create_daily_record',
        ] as const);
        return {
          finalContent: null,
          toolResults,
          selectedTools: ['get_user_profile', 'propose_create_daily_record'],
          stopReason: 'answered',
        };
      });
    const generateStream = jest.fn().mockResolvedValue({
      content: 'Hello there',
      usedToolNames: ['get_user_profile'],
    });

    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
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
          'get_today_summary_by_date',
          'get_report_summary_by_range',
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_current_medicines',
          'get_sleep_summary_by_range',
          'search_medicine_leaflets',
          'search_medical_qa_corpus',
          'resolve_drugbank_entity',
          'search_drugbank_passages',
          'propose_create_daily_record',
          'propose_update_daily_record',
          'propose_delete_daily_record',
          'propose_update_user_settings',
        ],
        implementedToolNames: [
          'get_user_profile',
          'propose_create_daily_record',
        ],
        contextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
      }),
      runConversation,
      generateStream,
    } as unknown as AssistantRuntimeService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
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
      }),
    } as unknown as UserSettingsService;

    const assistantPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: true,
        enabledContextSources: ['health_profile', 'sleep_records'],
        contextPermittedToolNames: [
          'get_today_summary_by_date',
          'get_report_summary_by_range',
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_sleep_summary_by_range',
          'propose_create_daily_record',
          'propose_update_user_settings',
        ],
        executableToolNames: [
          'get_user_profile',
          'propose_create_daily_record',
        ],
        toolCapabilities: [],
      }),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn().mockResolvedValue([
        {
          name: 'get_user_profile',
          data: { summary: { activeAllergyCount: 1 } },
        },
        {
          name: 'propose_create_daily_record',
          data: {
            confirmationHint: 'Review before saving.',
          },
          proposedActions: [
            {
              id: 'proposal-create-1',
              type: 'create_daily_record',
              status: 'proposed',
              confirmationRequired: true,
              title: 'Save this record',
              summary: 'Ready to save one water record.',
              reason: 'Detected water intake.',
              previewFields: [
                {
                  label: 'Kind',
                  value: 'water',
                },
              ],
              target: {
                kind: 'daily_record_draft',
                label: '2026-06-18 water 300 ml',
                matchedBy: ['relative_today'],
                snapshot: {
                  kind: 'water',
                  occurredAt: '2026-06-18',
                  title: null,
                  value: '300',
                  unit: 'ml',
                  note: null,
                  payload: null,
                },
              },
              constraints: [
                'Must be confirmed by you before any write happens.',
              ],
              expiresAt: '2026-06-18T10:15:00.000Z',
              payloadVersion: 1,
              payload: {
                type: 'create_daily_record',
                draft: {
                  kind: 'water',
                  occurredAt: '2026-06-18',
                  title: null,
                  value: '300',
                  unit: 'ml',
                  note: null,
                  payload: null,
                },
              },
            },
          ],
        },
      ]),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest
        .fn()
        .mockReturnValue(
          'Server-approved user context tool results:\n- get_user_profile: {"summary":{"activeAllergyCount":1}}',
        ),
    } as unknown as AssistantContextService;
    const assistantConversationService = {
      listRecentConversations: jest.fn(),
      getLatestConversation: jest.fn(),
      openConversation: jest.fn(),
      clearLatestConversation: jest.fn(),
      persistAssistantTurn: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        title: 'What should I do next?',
        status: 'active',
        messages: [],
        lastMessageAt: '2026-06-18T10:00:00.000Z',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T10:00:00.000Z',
      }),
    } as unknown as AssistantConversationService;

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );
    const onChunk = jest.fn();

    const result = await service.streamMessages(
      'user-1',
      {
        messages: [
          { role: 'assistant', content: 'Earlier summary' },
          { role: 'user', content: 'What should I do next?' },
        ],
      },
      'en-US',
      onChunk,
    );

    expect(result.role).toBe('assistant');
    expect(result.conversationId).toBe('conversation-1');
    expect(result.content).toBe('Hello there');
    expect(result.usedTools).toEqual(['get_user_profile']);
    expect(result.proposedActions).toEqual([
      {
        id: 'proposal-create-1',
        type: 'create_daily_record',
        status: 'proposed',
        confirmationRequired: true,
        title: 'Save this record',
        summary: 'Ready to save one water record.',
        reason: 'Detected water intake.',
        previewFields: [
          {
            label: 'Kind',
            value: 'water',
          },
        ],
        target: {
          kind: 'daily_record_draft',
          label: '2026-06-18 water 300 ml',
          matchedBy: ['relative_today'],
          snapshot: {
            kind: 'water',
            occurredAt: '2026-06-18',
            title: null,
            value: '300',
            unit: 'ml',
            note: null,
            payload: null,
          },
        },
        constraints: ['Must be confirmed by you before any write happens.'],
        expiresAt: '2026-06-18T10:15:00.000Z',
        payloadVersion: 1,
        payload: {
          type: 'create_daily_record',
          draft: {
            kind: 'water',
            occurredAt: '2026-06-18',
            title: null,
            value: '300',
            unit: 'ml',
            note: null,
            payload: null,
          },
        },
      },
    ]);
    expect(runConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        userMessage: 'What should I do next?',
        locale: 'en',
        enabledContextSources: ['health_profile', 'sleep_records'],
      }),
      expect.any(Function),
    );
    expect(assistantToolExecutor.executeMany).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        locale: 'en',
        userMessage: 'What should I do next?',
        enabledContextSources: ['health_profile', 'sleep_records'],
        memoryEnabled: false,
      },
      ['get_user_profile', 'propose_create_daily_record'],
    );
    expect(generateStream).toHaveBeenCalledWith(
      {
        locale: 'en',
        messages: [
          {
            role: 'user',
            content:
              'Server-approved user context tool results:\n- get_user_profile: {"summary":{"activeAllergyCount":1}}',
          },
          { role: 'assistant', content: 'Earlier summary' },
          { role: 'user', content: 'What should I do next?' },
        ],
        allowedTools: ['get_user_profile', 'propose_create_daily_record'],
        toolResults: [
          {
            name: 'get_user_profile',
            data: { summary: { activeAllergyCount: 1 } },
          },
          {
            name: 'propose_create_daily_record',
            data: {
              confirmationHint: 'Review before saving.',
            },
            proposedActions: [
              {
                id: 'proposal-create-1',
                type: 'create_daily_record',
                status: 'proposed',
                confirmationRequired: true,
                title: 'Save this record',
                summary: 'Ready to save one water record.',
                reason: 'Detected water intake.',
                previewFields: [
                  {
                    label: 'Kind',
                    value: 'water',
                  },
                ],
                target: {
                  kind: 'daily_record_draft',
                  label: '2026-06-18 water 300 ml',
                  matchedBy: ['relative_today'],
                  snapshot: {
                    kind: 'water',
                    occurredAt: '2026-06-18',
                    title: null,
                    value: '300',
                    unit: 'ml',
                    note: null,
                    payload: null,
                  },
                },
                constraints: [
                  'Must be confirmed by you before any write happens.',
                ],
                expiresAt: '2026-06-18T10:15:00.000Z',
                payloadVersion: 1,
                payload: {
                  type: 'create_daily_record',
                  draft: {
                    kind: 'water',
                    occurredAt: '2026-06-18',
                    title: null,
                    value: '300',
                    unit: 'ml',
                    note: null,
                    payload: null,
                  },
                },
              },
            ],
          },
        ],
      },
      onChunk,
    );
    expect(
      assistantConversationService.persistAssistantTurn,
    ).toHaveBeenCalledWith({
      userId: 'user-1',
      messages: [
        { role: 'assistant', content: 'Earlier summary' },
        { role: 'user', content: 'What should I do next?' },
      ],
      assistantContent: 'Hello there',
      usedTools: ['get_user_profile'],
    });
  });

  it('injects persisted memory only when memory is enabled for a new conversation', async () => {
    const generateStream = jest.fn().mockResolvedValue({
      content: 'Memory-aware reply',
      usedToolNames: [],
    });
    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
        phase: 'foundation',
        chatModelConfigured: true,
        interactiveChatReady: true,
        langGraphReady: true,
        ragEnabled: false,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [],
        implementedToolNames: [],
        contextSources: [],
      }),
      runConversation: jest
        .fn()
        .mockImplementation(async (_input, executeTools: ToolExecutorFn) => {
          const toolResults = await executeTools([] as const);
          return {
            finalContent: null,
            toolResults,
            selectedTools: [],
            stopReason: 'no_match',
          };
        }),
      generateStream,
    } as unknown as AssistantRuntimeService;
    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        assistantEnabled: true,
        assistantMemoryEnabled: true,
        assistantContext: {
          healthProfile: false,
          dailyRecords: false,
          sleepRecords: false,
          currentMedicines: false,
        },
        updatedAt: '2026-06-18T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;
    const assistantPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: true,
        enabledContextSources: [],
        contextPermittedToolNames: [],
        executableToolNames: [],
        toolCapabilities: [],
      }),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn().mockResolvedValue([]),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AssistantContextService;
    const assistantConversationService = conversationServiceDouble();
    assistantConversationService.buildMemoryBlock = jest
      .fn()
      .mockResolvedValue(
        'Persisted cross-conversation memory is enabled for this user.',
      );
    assistantConversationService.persistAssistantTurn = jest
      .fn()
      .mockResolvedValue({
        id: 'conversation-memory',
        title: 'Need continuity',
        status: 'active',
        messages: [],
        lastMessageAt: '2026-06-18T12:01:00.000Z',
        createdAt: '2026-06-18T12:01:00.000Z',
        updatedAt: '2026-06-18T12:01:00.000Z',
      });

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );

    await service.streamMessages(
      'user-1',
      {
        messages: [{ role: 'user', content: 'Need continuity' }],
      },
      'en-US',
      jest.fn(),
    );

    expect(assistantConversationService.buildMemoryBlock).toHaveBeenCalledWith(
      'user-1',
    );
    expect(generateStream).toHaveBeenCalledWith(
      {
        locale: 'en',
        messages: [
          {
            role: 'user',
            content:
              'Persisted cross-conversation memory is enabled for this user.',
          },
          { role: 'user', content: 'Need continuity' },
        ],
        allowedTools: [],
        toolResults: [],
      },
      expect.any(Function),
    );
  });

  it('rejects when chat is disabled by user settings', async () => {
    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
        phase: 'foundation',
        chatModelConfigured: true,
        interactiveChatReady: true,
        langGraphReady: true,
        ragEnabled: false,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [],
        implementedToolNames: [],
        contextSources: [],
      }),
    } as unknown as AssistantRuntimeService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        assistantEnabled: false,
        assistantMemoryEnabled: false,
        assistantContext: {
          healthProfile: true,
          dailyRecords: true,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;

    const assistantPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: false,
        enabledContextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
        contextPermittedToolNames: [],
        executableToolNames: [],
        toolCapabilities: [],
      }),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AssistantContextService;
    const assistantConversationService = conversationServiceDouble();

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );

    await expect(
      service.streamMessages(
        'user-1',
        {
          messages: [{ role: 'user', content: 'Hi' }],
        },
        'zh-CN',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when chat model is not configured', async () => {
    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
        phase: 'foundation',
        chatModelConfigured: false,
        interactiveChatReady: false,
        langGraphReady: true,
        ragEnabled: false,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [],
        implementedToolNames: [],
        contextSources: [],
      }),
    } as unknown as AssistantRuntimeService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        assistantEnabled: true,
        assistantMemoryEnabled: false,
        assistantContext: {
          healthProfile: true,
          dailyRecords: true,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;

    const assistantPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: false,
        enabledContextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
        contextPermittedToolNames: [],
        executableToolNames: [],
        toolCapabilities: [],
      }),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AssistantContextService;
    const assistantConversationService = conversationServiceDouble();

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );

    await expect(
      service.streamMessages(
        'user-1',
        {
          messages: [{ role: 'user', content: 'Hi' }],
        },
        'en-US',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects when the last message is not a user message', async () => {
    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
        phase: 'foundation',
        chatModelConfigured: true,
        interactiveChatReady: true,
        langGraphReady: true,
        ragEnabled: false,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [],
        implementedToolNames: [],
        contextSources: [],
      }),
    } as unknown as AssistantRuntimeService;

    const userSettingsService = {
      getSettings: jest.fn(),
    } as unknown as UserSettingsService;

    const assistantPolicyService = {
      evaluate: jest.fn(),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AssistantContextService;
    const assistantConversationService = conversationServiceDouble();

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );

    await expect(
      service.streamMessages(
        'user-1',
        {
          messages: [{ role: 'assistant', content: 'Hi' }],
        },
        'zh-CN',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects when the last user message is blank after trimming', async () => {
    const assistantAgentService = {
      describeFoundation: jest.fn().mockReturnValue({
        phase: 'foundation',
        chatModelConfigured: true,
        interactiveChatReady: true,
        langGraphReady: true,
        ragEnabled: false,
        graphNodeNames: ['prepare_context', 'respond'],
        toolNames: [],
        implementedToolNames: [],
        contextSources: [],
      }),
    } as unknown as AssistantRuntimeService;

    const userSettingsService = {
      getSettings: jest.fn(),
    } as unknown as UserSettingsService;

    const assistantPolicyService = {
      evaluate: jest.fn(),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AssistantContextService;
    const assistantConversationService = conversationServiceDouble();

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );

    await expect(
      service.streamMessages(
        'user-1',
        {
          messages: [{ role: 'user', content: '   ' }],
        },
        'en-US',
        jest.fn(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns and clears the latest persisted conversation', async () => {
    const assistantAgentService = {
      describeFoundation: jest.fn(),
    } as unknown as AssistantRuntimeService;
    const userSettingsService = {
      getSettings: jest.fn(),
    } as unknown as UserSettingsService;
    const assistantPolicyService = {
      evaluate: jest.fn(),
    } as unknown as AssistantPolicyService;
    const assistantToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AssistantToolService;
    const assistantToolContextService = {
      buildToolContextBlock: jest.fn(),
    } as unknown as AssistantContextService;
    const assistantConversationService = {
      listRecentConversations: jest.fn().mockResolvedValue([
        {
          id: 'conversation-2',
          title: '今天头痛正常吗？',
          status: 'active',
          lastMessageAt: '2026-06-18T11:00:00.000Z',
          createdAt: '2026-06-18T10:55:00.000Z',
          updatedAt: '2026-06-18T11:00:00.000Z',
        },
      ]),
      getLatestConversation: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        title: '最近睡眠怎样？',
        status: 'active',
        messages: [
          {
            role: 'user',
            content: '最近睡眠怎样？',
            usedTools: [],
            createdAt: '2026-06-18T10:00:00.000Z',
          },
        ],
        lastMessageAt: '2026-06-18T10:00:00.000Z',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T10:00:00.000Z',
      }),
      openConversation: jest.fn().mockResolvedValue({
        id: 'conversation-2',
        title: '今天头痛正常吗？',
        status: 'active',
        messages: [
          {
            role: 'user',
            content: '今天头痛正常吗？',
            usedTools: [],
            createdAt: '2026-06-18T11:00:00.000Z',
          },
        ],
        lastMessageAt: '2026-06-18T11:00:00.000Z',
        createdAt: '2026-06-18T10:55:00.000Z',
        updatedAt: '2026-06-18T11:05:00.000Z',
      }),
      clearLatestConversation: jest.fn().mockResolvedValue({
        id: 'conversation-1',
        title: '最近睡眠怎样？',
        status: 'archived',
        messages: [],
        lastMessageAt: '2026-06-18T10:00:00.000Z',
        createdAt: '2026-06-18T10:00:00.000Z',
        updatedAt: '2026-06-18T10:05:00.000Z',
      }),
      persistAssistantTurn: jest.fn(),
    } as unknown as AssistantConversationService;

    const service = new AssistantService(
      assistantAgentService,
      userSettingsService,
      assistantPolicyService,
      assistantToolExecutor,
      assistantToolContextService,
      assistantConversationService,
    );

    await expect(service.listRecentConversations('user-1')).resolves.toEqual([
      {
        id: 'conversation-2',
        title: '今天头痛正常吗？',
        status: 'active',
        lastMessageAt: '2026-06-18T11:00:00.000Z',
        createdAt: '2026-06-18T10:55:00.000Z',
        updatedAt: '2026-06-18T11:00:00.000Z',
      },
    ]);
    await expect(service.getLatestConversation('user-1')).resolves.toEqual({
      id: 'conversation-1',
      title: '最近睡眠怎样？',
      status: 'active',
      messages: [
        {
          role: 'user',
          content: '最近睡眠怎样？',
          usedTools: [],
          createdAt: '2026-06-18T10:00:00.000Z',
        },
      ],
      lastMessageAt: '2026-06-18T10:00:00.000Z',
      createdAt: '2026-06-18T10:00:00.000Z',
      updatedAt: '2026-06-18T10:00:00.000Z',
    });
    await expect(
      service.openConversation('user-1', 'conversation-2'),
    ).resolves.toEqual({
      id: 'conversation-2',
      title: '今天头痛正常吗？',
      status: 'active',
      messages: [
        {
          role: 'user',
          content: '今天头痛正常吗？',
          usedTools: [],
          createdAt: '2026-06-18T11:00:00.000Z',
        },
      ],
      lastMessageAt: '2026-06-18T11:00:00.000Z',
      createdAt: '2026-06-18T10:55:00.000Z',
      updatedAt: '2026-06-18T11:05:00.000Z',
    });
    await expect(service.clearLatestConversation('user-1')).resolves.toEqual({
      cleared: true,
      archivedConversationId: 'conversation-1',
    });
  });
});
