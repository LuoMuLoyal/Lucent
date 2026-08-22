import type { AIMessage } from '@langchain/core/messages';
import { AI_MODEL_TIMEOUT_MS } from '../../../config/constants';
import type { LlmRuntimeService } from '../../../llm-runtime';
import type { AssistantConversationRepositoryPort } from '../repositories/conversation.repository';
import type {
  AssistantMemoryRepositoryPort,
  AssistantMemoryRow,
} from '../repositories/memory.repository';
import { AssistantMemoryService } from './memory.service';
import { MEMORY_EXTRACTION_TIMEOUT_MS } from './memory.service';

function buildConversation(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
) {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: 'Test conversation',
    status: 'archived' as never,
    lastMessageAt: new Date('2026-07-10T08:00:00.000Z'),
    createdAt: new Date('2026-07-09T10:00:00.000Z'),
    updatedAt: new Date('2026-07-10T08:00:00.000Z'),
    messages: messages.map((message, index) => ({
      id: `msg-${index}`,
      conversationId: 'conv-1',
      userId: 'user-1',
      role: message.role,
      content: message.content,
      usedTools: [],
      createdAt: new Date(`2026-07-10T0${index}:00:00.000Z`),
      updatedAt: new Date(),
    })),
  };
}

function buildMemory(
  overrides: Partial<AssistantMemoryRow> = {},
): AssistantMemoryRow {
  return {
    id: 'mem-1',
    content: 'User prefers morning exercise.',
    sourceConversationId: 'conv-abc12345',
    createdAt: new Date('2026-07-10T08:00:00.000Z'),
    ...overrides,
  };
}

describe('AssistantMemoryService', () => {
  let memoryRepository: vi.Mocked<AssistantMemoryRepositoryPort>;
  let conversationRepository: vi.Mocked<AssistantConversationRepositoryPort>;
  let llmRuntimeService: {
    createChatModel: ReturnType<typeof vi.fn>;
  };
  let invoke: ReturnType<typeof vi.fn>;
  let service: AssistantMemoryService;

  beforeEach(() => {
    invoke = vi.fn();
    llmRuntimeService = {
      createChatModel: vi.fn().mockReturnValue({ invoke }),
    };
    memoryRepository = {
      createMany: vi.fn().mockResolvedValue(1),
      findRecent: vi.fn().mockResolvedValue([]),
      deleteAllForUser: vi.fn().mockResolvedValue(0),
    };
    conversationRepository = {
      findWithMessages: vi.fn().mockResolvedValue(null),
    } as unknown as vi.Mocked<AssistantConversationRepositoryPort>;

    service = new AssistantMemoryService(
      memoryRepository as unknown as AssistantMemoryRepositoryPort,
      llmRuntimeService as unknown as LlmRuntimeService,
      conversationRepository,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('extractAndStore', () => {
    it('times out a stuck extraction after the model timeout and logs a warning', async () => {
      vi.useFakeTimers();
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([{ role: 'user', content: 'Hello' }]),
      );
      invoke.mockReturnValue(new Promise(() => undefined));
      const logger = (
        service as unknown as { logger: { warn: (...args: unknown[]) => void } }
      ).logger;
      const warnSpy = vi.spyOn(logger, 'warn');

      const pending = service.extractAndStore('user-1', 'conv-1');
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(MEMORY_EXTRACTION_TIMEOUT_MS);

      await expect(pending).resolves.toBeUndefined();
      expect(MEMORY_EXTRACTION_TIMEOUT_MS).toBeGreaterThan(AI_MODEL_TIMEOUT_MS);
      expect(memoryRepository.createMany).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('persists extracted items with the source conversation id', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([
          { role: 'user', content: '我习惯每天早上跑步。' },
          { role: 'assistant', content: '好的，早上跑步是个好习惯。' },
        ]),
      );
      invoke.mockResolvedValue({
        content: JSON.stringify(['用户习惯每天早上跑步。']),
      } as AIMessage);

      await service.extractAndStore('user-1', 'conv-1');

      expect(llmRuntimeService.createChatModel).toHaveBeenCalledWith(
        'chat',
        expect.objectContaining({ maxRetries: 0 }),
      );
      expect(memoryRepository.createMany).toHaveBeenCalledWith('user-1', [
        { sourceConversationId: 'conv-1', content: '用户习惯每天早上跑步。' },
      ]);
    });

    it('parses a JSON array wrapped in a code fence', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([{ role: 'user', content: 'I prefer tea.' }]),
      );
      invoke.mockResolvedValue({
        content: '```json\n["User prefers tea."]\n```',
      } as AIMessage);

      await service.extractAndStore('user-1', 'conv-1');

      expect(memoryRepository.createMany).toHaveBeenCalledWith('user-1', [
        { sourceConversationId: 'conv-1', content: 'User prefers tea.' },
      ]);
    });

    it('degrades silently when the LLM call fails', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([{ role: 'user', content: 'Hello' }]),
      );
      invoke.mockRejectedValue(new Error('LLM unavailable'));

      await expect(
        service.extractAndStore('user-1', 'conv-1'),
      ).resolves.toBeUndefined();
      expect(memoryRepository.createMany).not.toHaveBeenCalled();
    });

    it('degrades silently when the LLM output cannot be parsed', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([{ role: 'user', content: 'Hello' }]),
      );
      invoke.mockResolvedValue({ content: 'not json at all' } as AIMessage);

      await expect(
        service.extractAndStore('user-1', 'conv-1'),
      ).resolves.toBeUndefined();
      expect(memoryRepository.createMany).not.toHaveBeenCalled();
    });

    it('skips the LLM when the conversation has no messages', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([]),
      );

      await service.extractAndStore('user-1', 'conv-1');

      expect(llmRuntimeService.createChatModel).not.toHaveBeenCalled();
      expect(memoryRepository.createMany).not.toHaveBeenCalled();
    });

    it('skips extraction when the conversation is not found', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(null);

      await service.extractAndStore('user-1', 'missing');

      expect(llmRuntimeService.createChatModel).not.toHaveBeenCalled();
      expect(memoryRepository.createMany).not.toHaveBeenCalled();
    });

    it('skips persistence when extraction yields an empty array', async () => {
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([{ role: 'user', content: 'Hello' }]),
      );
      invoke.mockResolvedValue({ content: '[]' } as AIMessage);

      await service.extractAndStore('user-1', 'conv-1');

      expect(memoryRepository.createMany).not.toHaveBeenCalled();
    });

    it('feeds only the last 10 messages to the model', async () => {
      const messages = Array.from({ length: 15 }, (_, index) => ({
        role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `message ${index}`,
      }));
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation(messages),
      );
      invoke.mockResolvedValue({ content: '[]' } as AIMessage);

      await service.extractAndStore('user-1', 'conv-1');

      const modelMessages = invoke.mock.calls[0]![0] as Array<{
        content: string;
      }>;
      const system = modelMessages[0]!;
      const transcript = modelMessages[1]!;
      expect(system.content).toContain('memory summarizer');
      expect(transcript.content).toContain('message 14');
      expect(transcript.content).not.toContain('message 0');
      expect(transcript.content).toContain('message 5');
    });
  });

  describe('buildMemoryBlock', () => {
    it('returns empty string when no memories exist', async () => {
      memoryRepository.findRecent.mockResolvedValue([]);

      const result = await service.buildMemoryBlock('user-1');

      expect(result).toBe('');
      expect(memoryRepository.findRecent).toHaveBeenCalledWith('user-1', 5);
    });

    it('builds the block from persisted memories with source prefixes', async () => {
      memoryRepository.findRecent.mockResolvedValue([
        buildMemory({ content: 'User prefers morning exercise.' }),
        buildMemory({
          content: 'User is vegetarian.',
          sourceConversationId: 'conv-xyz98765',
        }),
      ]);

      const result = await service.buildMemoryBlock('user-1');

      expect(result).toContain(
        'Persisted cross-conversation memory is enabled',
      );
      expect(result).toContain('Structured memories (max 5, newest first)');
      expect(result).toContain(
        '- User prefers morning exercise. (source conversation: conv-abc)',
      );
      expect(result).toContain(
        '- User is vegetarian. (source conversation: conv-xyz)',
      );
      expect(result).toContain(
        'If the new conversation conflicts with this memory',
      );
    });

    it('requests at most 5 memories and renders what the repository returns', async () => {
      memoryRepository.findRecent.mockResolvedValue(
        Array.from({ length: 5 }, (_, index) =>
          buildMemory({ id: `mem-${index}`, content: `memory ${index}` }),
        ),
      );

      const result = await service.buildMemoryBlock('user-1');

      expect(memoryRepository.findRecent).toHaveBeenCalledWith('user-1', 5);
      expect(result).toContain('memory 0');
      expect(result).toContain('memory 4');
      expect(result).not.toContain('memory 5');
    });
  });

  describe('scheduleExtraction', () => {
    it('merges same-user schedules into one debounced run', async () => {
      vi.useFakeTimers();
      conversationRepository.findWithMessages.mockResolvedValue(
        buildConversation([{ role: 'user', content: 'Hello' }]),
      );
      invoke.mockResolvedValue({ content: '[]' } as AIMessage);

      await service.scheduleExtraction('user-1', 'conv-1');
      await service.scheduleExtraction('user-1', 'conv-2');

      expect(conversationRepository.findWithMessages).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30_000);

      expect(conversationRepository.findWithMessages).toHaveBeenCalledTimes(2);
      expect(conversationRepository.findWithMessages).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(conversationRepository.findWithMessages).toHaveBeenCalledWith(
        'user-1',
        'conv-2',
      );
    });

    it('runs separate debounced jobs per user', async () => {
      vi.useFakeTimers();
      conversationRepository.findWithMessages.mockResolvedValue(null);

      await service.scheduleExtraction('user-1', 'conv-1');
      await service.scheduleExtraction('user-2', 'conv-9');

      await vi.advanceTimersByTimeAsync(30_000);

      expect(conversationRepository.findWithMessages).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
      expect(conversationRepository.findWithMessages).toHaveBeenCalledWith(
        'user-2',
        'conv-9',
      );
    });

    it('flushes pending work only after the debounce window', async () => {
      vi.useFakeTimers();
      conversationRepository.findWithMessages.mockResolvedValue(null);

      await service.scheduleExtraction('user-1', 'conv-1');
      await vi.advanceTimersByTimeAsync(20_000);

      expect(conversationRepository.findWithMessages).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10_000);

      expect(conversationRepository.findWithMessages).toHaveBeenCalledWith(
        'user-1',
        'conv-1',
      );
    });

    it('keeps extraction failures silent inside the flush loop', async () => {
      vi.useFakeTimers();
      conversationRepository.findWithMessages.mockRejectedValue(
        new Error('db down'),
      );

      await service.scheduleExtraction('user-1', 'conv-1');

      await vi.advanceTimersByTimeAsync(30_000);

      expect(memoryRepository.createMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteAllForUser', () => {
    it('delegates to the repository', async () => {
      await service.deleteAllForUser('user-1');

      expect(memoryRepository.deleteAllForUser).toHaveBeenCalledWith('user-1');
    });
  });
});
