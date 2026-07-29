import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AssistantRuntimeService } from '../agent/runtime.service';
import type { UserSettingsService } from '../../user-settings';
import type { AssistantPolicyService } from './policy.service';
import type { AssistantContextService } from '../tools/shared/context.service';
import type { AssistantToolService } from '../tools/tool.service';
import type { AssistantConversationService } from './conversation.service';
import type {
  AssistantRuntimeCapabilities,
  AssistantPolicySnapshot,
  AssistantConversationSnapshot,
} from '../types/assistant.types';
import { AssistantService } from './core.service';

const mockFoundation: AssistantRuntimeCapabilities = {
  phase: 'foundation',
  chatModelConfigured: true,
  interactiveChatReady: true,
  langGraphReady: true,
  ragEnabled: false,
  graphNodeNames: ['prepare_context', 'agent', 'tools', 'respond'],
  toolNames: ['get_today_records'],
  implementedToolNames: ['get_today_records'],
  contextSources: ['health_profile', 'daily_records'],
};

const mockPolicy: AssistantPolicySnapshot = {
  interactiveChatReady: true,
  enabledContextSources: ['health_profile', 'daily_records'],
  contextPermittedToolNames: ['get_today_records'],
  executableToolNames: ['get_today_records'],
  toolCapabilities: [],
};

const mockSettings = {
  assistantEnabled: true,
  assistantMemoryEnabled: false,
  assistantContext: {
    healthProfile: true,
    dailyRecords: true,
    sleepRecords: false,
    currentMedicines: false,
  },
  updatedAt: '2026-07-10T00:00:00.000Z',
};

const mockConversation: AssistantConversationSnapshot = {
  id: 'conv-1',
  title: 'Test',
  status: 'active',
  messages: [],
  lastMessageAt: null,
  createdAt: '2026-07-09T10:00:00.000Z',
  updatedAt: '2026-07-10T08:00:00.000Z',
};

describe('AssistantService', () => {
  let service: AssistantService;
  let runtime: vi.Mocked<AssistantRuntimeService>;
  let userSettings: vi.Mocked<UserSettingsService>;
  let policy: vi.Mocked<AssistantPolicyService>;
  let toolExecutor: vi.Mocked<AssistantToolService>;
  let toolContext: vi.Mocked<AssistantContextService>;
  let conversation: vi.Mocked<AssistantConversationService>;

  beforeEach(() => {
    runtime = {
      describeFoundation: vi.fn().mockResolvedValue(mockFoundation),
      runConversation: vi.fn(),
      streamPreGeneratedContent: vi.fn(),
      generateStream: vi.fn(),
    } as unknown as vi.Mocked<AssistantRuntimeService>;

    userSettings = {
      getSettings: vi.fn().mockResolvedValue(mockSettings),
    } as unknown as vi.Mocked<UserSettingsService>;

    policy = {
      evaluate: vi.fn().mockReturnValue(mockPolicy),
    } as unknown as vi.Mocked<AssistantPolicyService>;

    toolExecutor = {
      executeMany: vi.fn().mockResolvedValue([]),
    } as unknown as vi.Mocked<AssistantToolService>;

    toolContext = {
      buildToolContextBlock: vi.fn().mockReturnValue(''),
    } as unknown as vi.Mocked<AssistantContextService>;

    conversation = {
      getLatestConversation: vi.fn(),
      listRecentConversations: vi.fn(),
      openConversation: vi.fn(),
      clearLatestConversation: vi.fn(),
      persistAssistantTurn: vi.fn(),
      buildMemoryBlock: vi.fn().mockResolvedValue(''),
    } as unknown as vi.Mocked<AssistantConversationService>;

    service = new AssistantService(
      runtime,
      userSettings,
      policy,
      toolExecutor,
      toolContext,
      conversation,
    );
  });

  describe('getFoundationCapabilities', () => {
    it('delegates to runtime.describeFoundation', async () => {
      const result = await service.getFoundationCapabilities();

      expect(result).toBe(mockFoundation);
    });
  });

  describe('getCapabilities', () => {
    it('returns merged capabilities from foundation, settings, and policy', async () => {
      const result = await service.getCapabilities('user-1');

      expect(userSettings.getSettings).toHaveBeenCalledWith('user-1');
      expect(policy.evaluate).toHaveBeenCalledWith(
        mockFoundation,
        mockSettings,
      );
      expect(result).toMatchObject({
        phase: 'foundation',
        assistantEnabled: true,
        chatModelConfigured: true,
        interactiveChatReady: true,
        streamingSupported: true,
        streamingTransport: 'sse',
        markdownRenderingRecommended: true,
      });
    });
  });

  describe('getLatestConversation', () => {
    it('returns snapshot when conversation exists', async () => {
      conversation.getLatestConversation.mockResolvedValue(mockConversation);

      const result = await service.getLatestConversation('user-1');

      expect(result).toEqual(mockConversation);
    });

    it('returns null when no conversation', async () => {
      conversation.getLatestConversation.mockResolvedValue(null);

      const result = await service.getLatestConversation('user-1');

      expect(result).toBeNull();
    });
  });

  describe('listRecentConversations', () => {
    it('delegates to conversation service', async () => {
      conversation.listRecentConversations.mockResolvedValue([
        mockConversation,
      ]);

      const result = await service.listRecentConversations('user-1');

      expect(result).toEqual([mockConversation]);
    });
  });

  describe('openConversation', () => {
    it('delegates to conversation service', async () => {
      conversation.openConversation.mockResolvedValue(mockConversation);

      const result = await service.openConversation('user-1', 'conv-1');

      expect(conversation.openConversation).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(result).toEqual(mockConversation);
    });
  });

  describe('clearLatestConversation', () => {
    it('returns cleared=true with archivedConversationId', async () => {
      conversation.clearLatestConversation.mockResolvedValue(mockConversation);

      const result = await service.clearLatestConversation('user-1');

      expect(result).toEqual({
        cleared: true,
        archivedConversationId: 'conv-1',
      });
    });

    it('returns cleared=false when no conversation to clear', async () => {
      conversation.clearLatestConversation.mockResolvedValue(null);

      const result = await service.clearLatestConversation('user-1');

      expect(result).toEqual({
        cleared: false,
        archivedConversationId: null,
      });
    });
  });

  describe('streamMessages', () => {
    const dto = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
    };

    const mockRunConversationResult = {
      finalContent: 'AI response',
      toolResults: [],
      selectedTools: [],
    } as never;

    const mockStreamResult = {
      content: 'AI response',
      usedToolNames: [],
    };

    const onChunk = vi.fn();

    it('throws ForbiddenException when assistant is disabled', async () => {
      userSettings.getSettings.mockResolvedValue({
        ...mockSettings,
        assistantEnabled: false,
      } as never);

      await expect(
        service.streamMessages('user-1', dto, 'zh-CN', onChunk),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ServiceUnavailableException when chat model is not configured', async () => {
      runtime.describeFoundation.mockResolvedValue({
        ...mockFoundation,
        chatModelConfigured: false,
      });

      await expect(
        service.streamMessages('user-1', dto, 'zh-CN', onChunk),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('streams pre-generated content when finalContent is present', async () => {
      runtime.runConversation.mockResolvedValue(mockRunConversationResult);
      runtime.streamPreGeneratedContent.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(runtime.streamPreGeneratedContent).toHaveBeenCalledWith(
        'AI response',
        [],
        onChunk,
      );
      expect(result.role).toBe('assistant');
      expect(result.content).toBe('AI response');
    });

    it('generates stream when finalContent is null', async () => {
      runtime.runConversation.mockResolvedValue({
        ...(mockRunConversationResult as object),
        finalContent: null,
      } as never);
      runtime.generateStream.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages('user-1', dto, 'en', onChunk);

      expect(runtime.generateStream).toHaveBeenCalled();
      expect(result.content).toBe('AI response');
    });

    it('persists assistant turn and returns conversation id', async () => {
      runtime.runConversation.mockResolvedValue(mockRunConversationResult);
      runtime.streamPreGeneratedContent.mockResolvedValue(mockStreamResult);
      conversation.persistAssistantTurn.mockResolvedValue(mockConversation);

      const result = await service.streamMessages(
        'user-1',
        dto,
        'zh-CN',
        onChunk,
      );

      expect(conversation.persistAssistantTurn).toHaveBeenCalledWith({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'AI response',
        usedTools: [],
      });
      expect(result.conversationId).toBe('conv-1');
    });
  });
});
