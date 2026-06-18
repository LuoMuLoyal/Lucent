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
    getLatestConversation: jest.fn(),
    clearLatestConversation: jest.fn(),
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

    const aiChatPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: false,
        enabledContextSources: ['health_profile', 'sleep_records'],
        contextPermittedToolNames: [
          'health_context_snapshot',
          'recent_sleep_summary',
        ],
        executableToolNames: [],
        toolCapabilities: [
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
    ]);
  });

  it('streams a chat reply with executable tools only', async () => {
    const planConversation = jest.fn().mockResolvedValue({
      allowedTools: ['health_context_snapshot', 'recent_daily_records'],
      selectedTools: ['health_context_snapshot'],
      route: 'respond',
    });
    const generateStream = jest.fn().mockResolvedValue({
      content: 'Hello there',
      usedToolNames: ['health_context_snapshot'],
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
      }),
      planConversation,
      generateStream,
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

    const aiChatPolicyService = {
      evaluate: jest.fn().mockReturnValue({
        interactiveChatReady: true,
        enabledContextSources: ['health_profile', 'sleep_records'],
        contextPermittedToolNames: [
          'health_context_snapshot',
          'recent_sleep_summary',
        ],
        executableToolNames: ['health_context_snapshot'],
        toolCapabilities: [],
      }),
    } as unknown as AiChatPolicyService;
    const aiChatToolExecutor = {
      executeMany: jest.fn().mockResolvedValue([
        {
          name: 'health_context_snapshot',
          data: { summary: { activeAllergyCount: 1 } },
        },
      ]),
    } as unknown as AiChatToolExecutor;
    const aiChatToolContextService = {
      buildToolContextBlock: jest
        .fn()
        .mockReturnValue(
          'Server-approved user context tool results:\n- health_context_snapshot: {"summary":{"activeAllergyCount":1}}',
        ),
    } as unknown as AiChatToolContextService;
    const aiChatConversationService = {
      getLatestConversation: jest.fn(),
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
    expect(result.usedTools).toEqual(['health_context_snapshot']);
    expect(planConversation).toHaveBeenCalledWith({
      userId: 'user-1',
      userMessage: 'What should I do next?',
      locale: 'en',
      enabledContextSources: ['health_profile', 'sleep_records'],
    });
    expect(aiChatToolExecutor.executeMany).toHaveBeenCalledWith(
      'user-1',
      'en',
      ['health_context_snapshot'],
    );
    expect(generateStream).toHaveBeenCalledWith(
      {
        locale: 'en',
        messages: [
          {
            role: 'user',
            content:
              'Server-approved user context tool results:\n- health_context_snapshot: {"summary":{"activeAllergyCount":1}}',
          },
          { role: 'assistant', content: 'Earlier summary' },
          { role: 'user', content: 'What should I do next?' },
        ],
        allowedTools: ['health_context_snapshot'],
        toolResults: [
          {
            name: 'health_context_snapshot',
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
        usedTools: ['health_context_snapshot'],
      },
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
    await expect(service.clearLatestConversation('user-1')).resolves.toEqual({
      cleared: true,
      archivedConversationId: 'conversation-1',
    });
  });
});
