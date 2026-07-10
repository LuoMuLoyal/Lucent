import type { I18nService } from 'nestjs-i18n';
import type {
  AssistantConversationRepositoryPort,
  ConversationWithMessages,
  ConversationSummary,
} from '../repositories/conversation.repository';
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
  let repo: jest.Mocked<AssistantConversationRepositoryPort>;
  let i18n: jest.Mocked<I18nService>;

  beforeEach(() => {
    repo = {
      findLatestActiveWithMessages: jest.fn(),
      listRecentSummaries: jest.fn(),
      findWithMessages: jest.fn(),
      findWithMessagesById: jest.fn(),
      create: jest.fn(),
      archiveConversation: jest.fn(),
      activateConversation: jest.fn().mockResolvedValue(undefined),
      persistTurn: jest.fn(),
      findForMemory: jest.fn(),
    };
    i18n = {
      t: jest.fn().mockReturnValue('Conversation not found'),
    } as unknown as jest.Mocked<I18nService>;

    service = new AssistantConversationService(repo, i18n);
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
  });

  describe('clearLatestConversation', () => {
    it('archives and returns snapshot when conversation exists', async () => {
      const conv = buildConversation();
      const archived = buildConversation({ status: 'archived' as never });
      repo.findLatestActiveWithMessages.mockResolvedValue(conv);
      repo.archiveConversation.mockResolvedValue(archived);

      const result = await service.clearLatestConversation('user-1');

      expect(repo.archiveConversation).toHaveBeenCalledWith('conv-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('archived');
    });

    it('returns null when no active conversation', async () => {
      repo.findLatestActiveWithMessages.mockResolvedValue(null);

      const result = await service.clearLatestConversation('user-1');

      expect(result).toBeNull();
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

  describe('buildMemoryBlock', () => {
    it('returns empty string when no conversations', async () => {
      repo.findForMemory.mockResolvedValue([]);

      const result = await service.buildMemoryBlock('user-1');

      expect(result).toBe('');
    });

    it('builds memory text from conversations', async () => {
      repo.findForMemory.mockResolvedValue([
        buildConversation({
          id: 'conv-1',
          title: 'Sleep discussion',
          messages: [
            {
              id: 'msg-1',
              role: 'assistant',
              content: 'Your sleep was good.',
              usedTools: [],
              createdAt: new Date('2026-07-10T08:00:00.000Z'),
              conversationId: 'conv-1',
              userId: 'user-1',
              updatedAt: new Date(),
            },
            {
              id: 'msg-2',
              role: 'user',
              content: 'How was my sleep?',
              usedTools: [],
              createdAt: new Date('2026-07-10T07:00:00.000Z'),
              conversationId: 'conv-1',
              userId: 'user-1',
              updatedAt: new Date(),
            },
          ],
        }),
      ]);

      const result = await service.buildMemoryBlock('user-1');

      expect(result).toContain('Sleep discussion');
      expect(result).toContain('Persisted cross-conversation memory');
      expect(result).toContain('user: How was my sleep?');
    });

    it('uses conversation id when title is empty', async () => {
      repo.findForMemory.mockResolvedValue([
        buildConversation({
          id: 'conv-no-title',
          title: null,
          messages: [],
        }),
      ]);

      const result = await service.buildMemoryBlock('user-1');

      expect(result).toContain('conv-no-title');
    });
  });
});
