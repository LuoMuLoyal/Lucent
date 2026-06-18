import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { UserSettingsService } from '../user-settings/user-settings.service';
import type { AiChatAgentService } from './agent/ai-chat-agent.service';
import type { AiChatConversationService } from './ai-chat-conversation.service';
import type { AiChatPolicyService } from './ai-chat-policy.service';
import type { AiChatToolContextService } from './tools/ai-chat-tool-context.service';
import type { AiChatToolExecutor } from './tools/ai-chat-tool.executor';
import { AiChatService } from './ai-chat.service';

function conversationServiceDouble() {
  return {
    listRecentConversations: jest.fn(),
    getLatestConversation: jest.fn(),
    openConversation: jest.fn(),
    clearLatestConversation: jest.fn(),
    buildMemoryBlock: jest.fn().mockResolvedValue(''),
    persistAssistantTurn: jest.fn(),
  } as unknown as AiChatConversationService;
}

describe('AiChatService', () => {
  it('combines user permissions with system foundation status', async () => {
    const aiChatAgentService = {
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
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_current_medicines',
          'get_sleep_summary_by_range',
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
        aiChatMemoryEnabled: false,
        aiChatContext: {
          healthProfile: true,
          dailyRecords: false,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;

    const aiChatPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: false,
        enabledContextSources: ['health_profile', 'sleep_records'],
        contextPermittedToolNames: [
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
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = conversationServiceDouble();

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
    );
    const capabilities = await service.getCapabilities('user-1');

    expect(capabilities.phase).toBe('foundation');
    expect(capabilities.aiChatEnabled).toBe(true);
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
    const planConversation = jest.fn().mockResolvedValue({
      allowedTools: ['get_user_profile', 'get_sleep_summary_by_range'],
      selectedTools: ['get_user_profile'],
      route: 'respond',
    });
    const generateStream = jest.fn().mockResolvedValue({
      content: 'Hello there',
      usedToolNames: ['get_user_profile'],
    });

    const aiChatAgentService = {
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
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_current_medicines',
          'get_sleep_summary_by_range',
        ],
        implementedToolNames: ['get_user_profile'],
        contextSources: [
          'health_profile',
          'daily_records',
          'sleep_records',
          'current_medicines',
        ],
      }),
      planConversation,
      generateStream,
    } as unknown as AiChatAgentService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
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
      }),
    } as unknown as UserSettingsService;

    const aiChatPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: true,
        enabledContextSources: ['health_profile', 'sleep_records'],
        contextPermittedToolNames: [
          'get_recent_today_summaries',
          'get_recent_report_summaries',
          'get_user_profile',
          'get_user_settings',
          'get_sleep_summary_by_range',
        ],
        executableToolNames: ['get_user_profile'],
        toolCapabilities: [],
      }),
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn().mockResolvedValue([
        {
          name: 'get_user_profile',
          data: { summary: { activeAllergyCount: 1 } },
        },
      ]),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest
        .fn()
        .mockReturnValue(
          'Server-approved user context tool results:\n- get_user_profile: {"summary":{"activeAllergyCount":1}}',
        ),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = {
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
    } as unknown as AiChatConversationService;

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
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
    expect(planConversation).toHaveBeenCalledWith({
      userId: 'user-1',
      userMessage: 'What should I do next?',
      locale: 'en',
      enabledContextSources: ['health_profile', 'sleep_records'],
    });
    expect(aiChatToolExecutor.executeMany).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        locale: 'en',
        userMessage: 'What should I do next?',
        enabledContextSources: ['health_profile', 'sleep_records'],
        memoryEnabled: false,
      },
      ['get_user_profile'],
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
        allowedTools: ['get_user_profile'],
        toolResults: [
          {
            name: 'get_user_profile',
            data: { summary: { activeAllergyCount: 1 } },
          },
        ],
      },
      onChunk,
    );
    expect(aiChatConversationService.persistAssistantTurn).toHaveBeenCalledWith(
      {
        userId: 'user-1',
        messages: [
          { role: 'assistant', content: 'Earlier summary' },
          { role: 'user', content: 'What should I do next?' },
        ],
        assistantContent: 'Hello there',
        usedTools: ['get_user_profile'],
      },
    );
  });

  it('injects persisted memory only when memory is enabled for a new conversation', async () => {
    const generateStream = jest.fn().mockResolvedValue({
      content: 'Memory-aware reply',
      usedToolNames: [],
    });
    const aiChatAgentService = {
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
      planConversation: jest.fn().mockResolvedValue({
        allowedTools: [],
        selectedTools: [],
        route: 'respond',
      }),
      generateStream,
    } as unknown as AiChatAgentService;
    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        aiChatEnabled: true,
        aiChatMemoryEnabled: true,
        aiChatContext: {
          healthProfile: false,
          dailyRecords: false,
          sleepRecords: false,
          currentMedicines: false,
        },
        updatedAt: '2026-06-18T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;
    const aiChatPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: true,
        enabledContextSources: [],
        contextPermittedToolNames: [],
        executableToolNames: [],
        toolCapabilities: [],
      }),
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn().mockResolvedValue([]),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = conversationServiceDouble();
    aiChatConversationService.buildMemoryBlock = jest
      .fn()
      .mockResolvedValue(
        'Persisted cross-conversation memory is enabled for this user.',
      );
    aiChatConversationService.persistAssistantTurn = jest
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

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
    );

    await service.streamMessages(
      'user-1',
      {
        messages: [{ role: 'user', content: 'Need continuity' }],
      },
      'en-US',
      jest.fn(),
    );

    expect(aiChatConversationService.buildMemoryBlock).toHaveBeenCalledWith(
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
    const aiChatAgentService = {
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
    } as unknown as AiChatAgentService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        aiChatEnabled: false,
        aiChatMemoryEnabled: false,
        aiChatContext: {
          healthProfile: true,
          dailyRecords: true,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;

    const aiChatPolicyService = {
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
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = conversationServiceDouble();

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
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
    const aiChatAgentService = {
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
    } as unknown as AiChatAgentService;

    const userSettingsService = {
      getSettings: jest.fn().mockResolvedValue({
        aiSummariesEnabled: true,
        dataSharingConsent: false,
        aiChatEnabled: true,
        aiChatMemoryEnabled: false,
        aiChatContext: {
          healthProfile: true,
          dailyRecords: true,
          sleepRecords: true,
          currentMedicines: true,
        },
        updatedAt: '2026-06-17T12:00:00.000Z',
      }),
    } as unknown as UserSettingsService;

    const aiChatPolicyService = {
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
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = conversationServiceDouble();

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
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
    const aiChatAgentService = {
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
    } as unknown as AiChatAgentService;

    const userSettingsService = {
      getSettings: jest.fn(),
    } as unknown as UserSettingsService;

    const aiChatPolicyService = {
      evaluate: jest.fn(),
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = conversationServiceDouble();

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
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
    const aiChatAgentService = {
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
    } as unknown as AiChatAgentService;

    const userSettingsService = {
      getSettings: jest.fn(),
    } as unknown as UserSettingsService;

    const aiChatPolicyService = {
      evaluate: jest.fn(),
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn().mockReturnValue(''),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = conversationServiceDouble();

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
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
    const aiChatAgentService = {
      describeFoundation: jest.fn(),
    } as unknown as AiChatAgentService;
    const userSettingsService = {
      getSettings: jest.fn(),
    } as unknown as UserSettingsService;
    const aiChatPolicyService = {
      evaluate: jest.fn(),
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn(),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest.fn(),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = {
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
    } as unknown as AiChatConversationService;

    const service = new AiChatService(
      aiChatAgentService,
      userSettingsService,
      aiChatPolicyService,
      aiChatToolExecutor,
      aiChatToolContextService,
      aiChatConversationService,
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
