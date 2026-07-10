/* eslint-disable @typescript-eslint/no-unsafe-call */
import { AssistantConversationStatus } from '#generated/prisma/client';
import { AssistantConversationRepository } from './conversation.repository';
import type { PrismaService } from '../../../prisma/prisma.service';

describe('AssistantConversationRepository', () => {
  let repository: AssistantConversationRepository;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      assistantConversation: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      assistantMessage: {
        createMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    } as unknown as jest.Mocked<PrismaService>;

    repository = new AssistantConversationRepository(prisma);
  });

  describe('findLatestActiveWithMessages', () => {
    it('queries active conversations with messages', async () => {
      const conv = { id: 'conv-1', messages: [] };
      prisma.assistantConversation.findFirst.mockResolvedValue(conv as never);

      const result = await repository.findLatestActiveWithMessages('user-1');

      expect(result).toBe(conv);
      const call = prisma.assistantConversation.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toMatchObject({
        userId: 'user-1',
        status: AssistantConversationStatus.active,
      });
    });

    it('returns null when not found', async () => {
      prisma.assistantConversation.findFirst.mockResolvedValue(null);
      expect(
        await repository.findLatestActiveWithMessages('user-1'),
      ).toBeNull();
    });
  });

  describe('listRecentSummaries', () => {
    it('queries with limit and userId', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([] as never);

      await repository.listRecentSummaries('user-1', 10);

      const call = prisma.assistantConversation.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ userId: 'user-1' });
      expect(call?.take).toBe(10);
    });
  });

  describe('findWithMessages', () => {
    it('queries by conversationId and userId', async () => {
      prisma.assistantConversation.findFirst.mockResolvedValue(null);

      await repository.findWithMessages('user-1', 'conv-1');

      const call = prisma.assistantConversation.findFirst.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ id: 'conv-1', userId: 'user-1' });
    });
  });

  describe('findWithMessagesById', () => {
    it('queries by conversationId only', async () => {
      const conv = { id: 'conv-1', messages: [] };
      prisma.assistantConversation.findUniqueOrThrow.mockResolvedValue(
        conv as never,
      );

      const result = await repository.findWithMessagesById('conv-1');

      expect(result).toBe(conv);
      expect(
        prisma.assistantConversation.findUniqueOrThrow,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conv-1' } }),
      );
    });
  });

  describe('create', () => {
    it('creates conversation with userId and title', async () => {
      const conv = { id: 'conv-1', messages: [] };
      prisma.assistantConversation.create.mockResolvedValue(conv as never);

      const result = await repository.create('user-1', 'New Chat');

      expect(result).toBe(conv);
      expect(prisma.assistantConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { userId: 'user-1', title: 'New Chat' },
        }),
      );
    });

    it('creates conversation with null title', async () => {
      prisma.assistantConversation.create.mockResolvedValue({} as never);

      await repository.create('user-1', null);

      expect(prisma.assistantConversation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { userId: 'user-1', title: null },
        }),
      );
    });
  });

  describe('archiveConversation', () => {
    it('updates status to archived', async () => {
      prisma.assistantConversation.update.mockResolvedValue({} as never);

      await repository.archiveConversation('conv-1');

      expect(prisma.assistantConversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: { status: AssistantConversationStatus.archived },
        }),
      );
    });
  });

  describe('activateConversation', () => {
    it('archives other active conversations and activates target within transaction', async () => {
      prisma.assistantConversation.updateMany.mockResolvedValue({
        count: 2,
      } as never);
      prisma.assistantConversation.update.mockResolvedValue({} as never);

      await repository.activateConversation('user-1', 'conv-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.assistantConversation.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: AssistantConversationStatus.active,
          id: { not: 'conv-1' },
        },
        data: { status: AssistantConversationStatus.archived },
      });
      expect(prisma.assistantConversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { status: AssistantConversationStatus.active },
      });
    });
  });

  describe('persistTurn', () => {
    it('appends messages and updates conversation', async () => {
      prisma.assistantMessage.createMany.mockResolvedValue({
        count: 1,
      } as never);
      prisma.assistantMessage.create.mockResolvedValue({} as never);
      prisma.assistantConversation.update.mockResolvedValue({} as never);
      prisma.assistantConversation.findUniqueOrThrow.mockResolvedValue({
        id: 'conv-1',
        messages: [],
      } as never);

      const result = await repository.persistTurn({
        conversationId: 'conv-1',
        userId: 'user-1',
        title: 'Title',
        messagesToAppend: [{ role: 'user', content: 'hello' }],
        assistantContent: 'response',
        usedTools: ['search'],
        assistantTimestamp: new Date('2026-07-10T12:00:00.000Z'),
      });

      expect(result).toMatchObject({ id: 'conv-1' });
      expect(prisma.assistantMessage.createMany).toHaveBeenCalled();
      expect(prisma.assistantMessage.create).toHaveBeenCalled();
      expect(prisma.assistantConversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'conv-1' },
          data: {
            title: 'Title',
            lastMessageAt: new Date('2026-07-10T12:00:00.000Z'),
          },
        }),
      );
    });

    it('skips createMany when no messages to append', async () => {
      prisma.assistantMessage.create.mockResolvedValue({} as never);
      prisma.assistantConversation.update.mockResolvedValue({} as never);
      prisma.assistantConversation.findUniqueOrThrow.mockResolvedValue({
        id: 'conv-1',
      } as never);

      await repository.persistTurn({
        conversationId: 'conv-1',
        userId: 'user-1',
        title: null,
        messagesToAppend: [],
        assistantContent: 'response',
        usedTools: [],
        assistantTimestamp: new Date(),
      });

      expect(prisma.assistantMessage.createMany).not.toHaveBeenCalled();
    });
  });

  describe('findForMemory', () => {
    it('queries with conversation and message limits', async () => {
      prisma.assistantConversation.findMany.mockResolvedValue([] as never);

      await repository.findForMemory('user-1', 5, 20);

      const call = prisma.assistantConversation.findMany.mock.calls[0]?.[0];
      expect(call?.where).toEqual({ userId: 'user-1' });
      expect(call?.take).toBe(5);
      expect(call?.include.messages.take).toBe(20);
    });
  });
});
