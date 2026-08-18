import type { I18nService } from 'nestjs-i18n';
import type { LlmRuntimeService } from '../../../llm-runtime';
import type {
  AssistantConversationRepositoryPort,
  ConversationWithMessages,
  ConversationSummary,
} from '../repositories/conversation.repository';
import type { AssistantMemoryService } from './memory.service';
import { AssistantConversationService } from './conversation.service';

function buildConversation(
  overrides: Partial<ConversationWithMessages> = {},
): ConversationWithMessages {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: 'Test conversation',
    status: 'active' as never,
    messages: [],
    lastMessageAt: new Date('2026-07-10T08:00:00.000Z'),
    createdAt: new Date('2026-07-09T10:00:00.000Z'),
    updatedAt: new Date('2026-07-10T08:00:00.000Z'),
    ...overrides,
  };
}

function buildSummary(
  overrides: Partial<ConversationSummary> = {},
): ConversationSummary {
  return {
    id: 'conv-1',
    title: 'Test',
    status: 'active' as never,
    lastMessageAt: new Date('2026-07-10T08:00:00.000Z'),
    createdAt: new Date('2026-07-09T10:00:00.000Z'),
    updatedAt: new Date('2026-07-10T08:00:00.000Z'),
    ...overrides,
  };
}

describe('AssistantConversationService', () => {
  let service: AssistantConversationService;
  let repo: vi.Mocked<AssistantConversationRepositoryPort>;
  let i18n: vi.Mocked<I18nService>;
  let memoryService: vi.Mocked<AssistantMemoryService>;
  let llmRuntimeService: {
    hasRoleConfig: ReturnType<typeof vi.fn>;
    createChatModel: ReturnType<typeof vi.fn>;
  };
  let invoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invoke = vi.fn();
    llmRuntimeService = {
      hasRoleConfig: vi.fn().mockReturnValue(true),
      createChatModel: vi.fn().mockReturnValue({ invoke }),
    };
    repo = {
      findLatestActiveWithMessages: vi.fn(),
      listRecentSummaries: vi.fn(),
      findWithMessages: vi.fn(),
      findWithMessagesById: vi.fn(),
      create: vi.fn(),
      archiveConversation: vi.fn(),
      softDelete: vi.fn(),
      updateTitle: vi.fn(),
      activateConversation: vi.fn().mockResolvedValue(undefined),
      persistTurn: vi.fn(),
      appendAssistantMessage: vi.fn(),
      findRecentRegeneration: vi.fn(),
      createRegeneration: vi.fn(),
    };
    i18n = {
      t: vi.fn().mockReturnValue('Conversation not found'),
    } as unknown as vi.Mocked<I18nService>;
    memoryService = {
      buildMemoryBlock: vi.fn().mockResolvedValue(''),
      scheduleExtraction: vi.fn().mockResolvedValue(undefined),
      extractAndStore: vi.fn().mockResolvedValue(undefined),
      deleteAllForUser: vi.fn().mockResolvedValue(undefined),
    } as unknown as vi.Mocked<AssistantMemoryService>;

    service = new AssistantConversationService(
      repo,
      i18n,
      memoryService,
      llmRuntimeService as unknown as LlmRuntimeService,
    );
  });

  describe('getLatestConversation', () => {
    it('returns snapshot when conversation exists', async () => {
      const conv = buildConversation({
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Hello',
            usedTools: [],
            createdAt: new Date('2026-07-10T08:00:00.000Z'),
            conversationId: 'conv-1',
            userId: 'user-1',
            updatedAt: new Date(),
          },
        ],
      });
      repo.findLatestActiveWithMessages.mockResolvedValue(conv);

      const result = await service.getLatestConversation('user-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('conv-1');
      expect(result!.messages).toHaveLength(1);
      expect(result!.messages[0]!.role).toBe('user');
      expect(result!.messages[0]!.usedTools).toEqual([]);
    });

    it('returns null when no active conversation', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);

      const result = await service.getLatestConversation('user-1');

      expect(result).toBeNull();
    });
  });

  describe('listRecentConversations', () => {
    it('returns mapped summaries', async () => {
      repo.listRecentSummaries.mockResolvedValue([
        buildSummary({ id: 'conv-1', title: 'First' }),
        buildSummary({ id: 'conv-2', title: 'Second' }),
      ]);

      const result = await service.listRecentConversations('user-1');

      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('conv-1');
      expect(result[1]!.id).toBe('conv-2');
    });

    it('returns empty array when no conversations', async () => {
      repo.listRecentSummaries.mockResolvedValue([]);

      const result = await service.listRecentConversations('user-1');

      expect(result).toEqual([]);
    });
  });

  describe('openConversation', () => {
    it('activates and returns conversation', async () => {
      const conv = buildConversation();
      repo.findWithMessages.mockResolvedValue(conv);
      repo.findWithMessagesById.mockResolvedValue(conv);

      const result = await service.openConversation('user-1', 'conv-1');

      expect(repo.activateConversation).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(result.id).toBe('conv-1');
    });

    it('throws when conversation not found', async () => {
      repo.findWithMessages.mockResolvedValue(null);

      await expect(
        service.openConversation('user-1', 'nonexistent'),
      ).rejects.toThrow();
    });

    it('throws when the conversation is deleted', async () => {
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ status: 'deleted' as never }),
      );

      await expect(
        service.openConversation('user-1', 'conv-1'),
      ).rejects.toThrow();
      expect(repo.activateConversation).not.toHaveBeenCalled();
    });
  });

  describe('renameConversation', () => {
    it('updates the title and returns the snapshot', async () => {
      const conv = buildConversation();
      const updated = buildConversation({ title: 'New title' });
      repo.findWithMessages.mockResolvedValue(conv);
      repo.updateTitle.mockResolvedValue(updated);

      const result = await service.renameConversation(
        'user-1',
        'conv-1',
        'New title',
      );

      expect(repo.updateTitle).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
        'New title',
      );
      expect(result.title).toBe('New title');
    });

    it('clears the title to null when requested', async () => {
      repo.findWithMessages.mockResolvedValue(buildConversation());
      repo.updateTitle.mockResolvedValue(buildConversation({ title: null }));

      const result = await service.renameConversation('user-1', 'conv-1', null);

      expect(repo.updateTitle).toHaveBeenCalledWith('user-1', 'conv-1', null);
      expect(result.title).toBeNull();
    });

    it('throws when conversation not found', async () => {
      repo.findWithMessages.mockResolvedValue(null);

      await expect(
        service.renameConversation('user-1', 'nonexistent', 'T'),
      ).rejects.toThrow();
      expect(repo.updateTitle).not.toHaveBeenCalled();
    });

    it('throws when the conversation is deleted', async () => {
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ status: 'deleted' as never }),
      );

      await expect(
        service.renameConversation('user-1', 'conv-1', 'T'),
      ).rejects.toThrow();
      expect(repo.updateTitle).not.toHaveBeenCalled();
    });
  });

  describe('deleteConversation', () => {
    it('soft-deletes and returns the deleted snapshot', async () => {
      const conv = buildConversation();
      const deleted = buildConversation({ status: 'deleted' as never });
      repo.findWithMessages.mockResolvedValue(conv);
      repo.softDelete.mockResolvedValue(deleted);

      const result = await service.deleteConversation('user-1', 'conv-1');

      expect(repo.softDelete).toHaveBeenCalledWith('user-1', 'conv-1');
      expect(result.status).toBe('deleted');
    });

    it('throws when conversation not found', async () => {
      repo.findWithMessages.mockResolvedValue(null);

      await expect(
        service.deleteConversation('user-1', 'nonexistent'),
      ).rejects.toThrow();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('throws when the conversation is already deleted', async () => {
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ status: 'deleted' as never }),
      );

      await expect(
        service.deleteConversation('user-1', 'conv-1'),
      ).rejects.toThrow();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('clearLatestConversation', () => {
    it('archives and returns snapshot when conversation exists', async () => {
      const conv = buildConversation();
      const archived = buildConversation({ status: 'archived' as never });
      repo.findLatestActiveWithMessages.mockResolvedValue(conv);
      repo.archiveConversation.mockResolvedValue(archived);

      const result = await service.clearLatestConversation('user-1');

      expect(repo.archiveConversation).toHaveBeenCalledWith('user-1', 'conv-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('archived');
    });

    it('schedules memory extraction for the archived conversation', async () => {
      const conv = buildConversation();
      repo.findLatestActiveWithMessages.mockResolvedValue(conv);
      repo.archiveConversation.mockResolvedValue(
        buildConversation({ status: 'archived' as never }),
      );

      await service.clearLatestConversation('user-1');

      expect(memoryService.scheduleExtraction).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
    });

    it('does not schedule extraction when no active conversation', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);

      const result = await service.clearLatestConversation('user-1');

      expect(result).toBeNull();
      expect(memoryService.scheduleExtraction).not.toHaveBeenCalled();
    });
  });

  describe('persistAssistantTurn', () => {
    it('creates new conversation when none exists', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);
      const created = buildConversation({ id: 'new-conv' });
      repo.create.mockResolvedValue(created);
      const saved = buildConversation({ id: 'new-conv' });
      repo.persistTurn.mockResolvedValue(saved);

      const result = await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'Hi there',
        usedTools: [],
      });

      expect(repo.create).toHaveBeenCalledWith('user-1', 'Hello');
      expect(repo.persistTurn).toHaveBeenCalled();
      expect(result.id).toBe('new-conv');
    });

    it('reuses existing conversation when one exists', async () => {
      const existing = buildConversation({ id: 'existing-conv' });
      repo.findLatestActiveWithMessages.mockResolvedValue(existing);
      const saved = buildConversation({ id: 'existing-conv' });
      repo.persistTurn.mockResolvedValue(saved);

      const result = await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'Hi there',
        usedTools: ['get_today_records'],
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(result.id).toBe('existing-conv');
    });

    it('filters out empty messages during normalization', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildConversation());
      repo.persistTurn.mockResolvedValue(buildConversation());

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [
          { role: 'user', content: '  ' },
          { role: 'user', content: 'Hello' },
        ],
        assistantContent: 'Hi',
        usedTools: [],
      });

      const persistInput = repo.persistTurn.mock.calls[0]![0];
      expect(persistInput.messagesToAppend).toHaveLength(1);
      expect(persistInput.messagesToAppend[0]!.content).toBe('Hello');
    });

    it('builds title from first user message', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildConversation());
      repo.persistTurn.mockResolvedValue(buildConversation());

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'What is my sleep quality?' }],
        assistantContent: 'Your sleep quality was good.',
        usedTools: [],
      });

      expect(repo.create).toHaveBeenCalledWith(
        'user-1',
        'What is my sleep quality?',
      );
    });

    it('builds null title when no user message', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);
      repo.create.mockResolvedValue(buildConversation());
      repo.persistTurn.mockResolvedValue(buildConversation());

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'assistant', content: 'Hi' }],
        assistantContent: 'Response',
        usedTools: [],
      });

      expect(repo.create).toHaveBeenCalledWith('user-1', null);
    });
  });

  describe('enrichTitleWithLlm (F-2 best-effort title refinement)', () => {
    function setupNewConversation() {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);
      repo.create.mockResolvedValue(
        buildConversation({ id: 'new-conv', title: 'Hello' }),
      );
      repo.persistTurn.mockResolvedValue(buildConversation({ id: 'new-conv' }));
    }

    it('replaces the initial truncated title with the LLM title for a new conversation', async () => {
      setupNewConversation();
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ id: 'new-conv', title: 'Hello' }),
      );
      invoke.mockResolvedValue({ content: '我今天的饮水情况' });
      repo.updateTitle.mockResolvedValue(
        buildConversation({ id: 'new-conv', title: '我今天的饮水情况' }),
      );

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'Hi there',
        usedTools: [],
      });

      await vi.waitFor(() => {
        expect(repo.updateTitle).toHaveBeenCalledWith(
          'user-1',
          'new-conv',
          '我今天的饮水情况',
        );
      });
      expect(llmRuntimeService.createChatModel).toHaveBeenCalled();
    });

    it('keeps the truncated title when the LLM call fails', async () => {
      setupNewConversation();
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ id: 'new-conv', title: 'Hello' }),
      );
      invoke.mockRejectedValue(new Error('LLM unavailable'));

      await expect(
        service.persistAssistantTurn({
          userId: 'user-1',
          messages: [{ role: 'user', content: 'Hello' }],
          assistantContent: 'Hi there',
          usedTools: [],
        }),
      ).resolves.toBeDefined();

      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalled();
      });
      expect(repo.updateTitle).not.toHaveBeenCalled();
    });

    it('does not overwrite a title the user already renamed', async () => {
      setupNewConversation();
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ id: 'new-conv', title: '用户手改标题' }),
      );

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'Hi there',
        usedTools: [],
      });

      await vi.waitFor(() => {
        expect(repo.findWithMessages).toHaveBeenCalled();
      });
      expect(invoke).not.toHaveBeenCalled();
      expect(repo.updateTitle).not.toHaveBeenCalled();
    });

    it('skips refinement when the chat model is not configured', async () => {
      setupNewConversation();
      repo.findWithMessages.mockResolvedValue(
        buildConversation({ id: 'new-conv', title: 'Hello' }),
      );
      llmRuntimeService.hasRoleConfig.mockReturnValue(false);

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'Hi there',
        usedTools: [],
      });

      await vi.waitFor(() => {
        expect(repo.findWithMessages).toHaveBeenCalled();
      });
      expect(llmRuntimeService.createChatModel).not.toHaveBeenCalled();
      expect(repo.updateTitle).not.toHaveBeenCalled();
    });

    it('does not refine an existing reused conversation', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(
        buildConversation({ id: 'existing-conv' }),
      );
      repo.persistTurn.mockResolvedValue(
        buildConversation({ id: 'existing-conv' }),
      );

      await service.persistAssistantTurn({
        userId: 'user-1',
        messages: [{ role: 'user', content: 'Hello' }],
        assistantContent: 'Hi there',
        usedTools: [],
      });

      expect(repo.create).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(repo.updateTitle).not.toHaveBeenCalled();
    });
  });

  describe('buildMemoryBlock', () => {
    it('delegates to the memory service', async () => {
      memoryService.buildMemoryBlock.mockResolvedValue(
        'Persisted cross-conversation memory is enabled for this user.',
      );

      const result = await service.buildMemoryBlock('user-1');

      expect(memoryService.buildMemoryBlock).toHaveBeenCalledWith('user-1');
      expect(result).toContain('Persisted cross-conversation memory');
    });

    it('returns empty string when the memory service has no memories', async () => {
      memoryService.buildMemoryBlock.mockResolvedValue('');

      const result = await service.buildMemoryBlock('user-1');

      expect(result).toBe('');
    });
  });
});
