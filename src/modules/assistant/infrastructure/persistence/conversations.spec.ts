/**
 * Prisma mapping tests for `PrismaConversations`.
 *
 * These cover the boundary the aggregate cannot: row -> domain mapping (message
 * ordering repair, `usedTools` normalisation, soft-delete predicate) and the
 * statement shape of the writes. The rules themselves are covered by
 * `domain/conversation/conversation.spec.ts`.
 */
import type { DeepMocked } from '../../../../common/types/deep-mocked.js';
import { AssistantConversationStatus } from '#generated/prisma/client.js';
import { PrismaConversations } from './conversations.js';
import type { PrismaService } from '../../../../prisma/index.js';

const T0 = new Date('2026-10-25T08:00:00.000Z');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    userId: 'user-1',
    title: 'hello',
    status: AssistantConversationStatus.active,
    lastMessageAt: T0,
    createdAt: T0,
    updatedAt: T0,
    messages: [],
    ...overrides,
  };
}

describe('PrismaConversations', () => {
  let repository: PrismaConversations;
  let prisma: DeepMocked<PrismaService>;

  beforeEach(() => {
    prisma = {
      assistantConversation: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      assistantMessage: {
        createMany: vi.fn(),
        create: vi.fn(),
      },
      assistantRegeneration: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
      ),
    } as unknown as DeepMocked<PrismaService>;

    repository = new PrismaConversations(prisma);
  });

  it('excludes deleted conversations from every load', async () => {
    prisma.assistantConversation.findFirst.mockResolvedValue(null);

    await repository.find('user-1', 'conv-1');

    expect(prisma.assistantConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { not: AssistantConversationStatus.deleted },
        }),
      }),
    );
  });

  it('orders messages by createdAt ascending', async () => {
    prisma.assistantConversation.findFirst.mockResolvedValue(row() as never);

    await repository.findActive('user-1');

    expect(prisma.assistantConversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      }),
    );
  });

  it('repairs rows whose messages share a millisecond', async () => {
    prisma.assistantConversation.findFirst.mockResolvedValue(
      row({
        messages: [
          { id: 'm1', role: 'user', content: 'q', usedTools: [], createdAt: T0 },
          { id: 'm2', role: 'assistant', content: 'a', usedTools: [], createdAt: T0 },
        ],
      }) as never,
    );

    const state = await repository.find('user-1', 'conv-1');

    expect(state?.messages[1]?.createdAt.getTime()).toBe(T0.getTime() + 1);
  });

  it('drops non-string entries from usedTools', async () => {
    prisma.assistantConversation.findFirst.mockResolvedValue(
      row({
        messages: [
          {
            id: 'm1',
            role: 'assistant',
            content: 'a',
            usedTools: ['get_user_profile', 42, { x: 1 }],
            createdAt: T0,
          },
        ],
      }) as never,
    );

    const state = await repository.find('user-1', 'conv-1');

    expect(state?.messages[0]?.usedTools).toEqual(['get_user_profile']);
  });

  it('archives the other active conversations and activates this one', async () => {
    prisma.$transaction.mockImplementation(
      async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma),
    );
    prisma.assistantConversation.updateMany.mockResolvedValue({ count: 1 } as never);
    prisma.assistantConversation.update.mockResolvedValue(row() as never);

    await repository.activate('user-1', 'conv-1');

    expect(prisma.assistantConversation.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: AssistantConversationStatus.active,
        id: { not: 'conv-1' },
      },
      data: { status: AssistantConversationStatus.archived },
    });
    expect(prisma.assistantConversation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conv-1', userId: 'user-1' },
        data: { status: AssistantConversationStatus.active },
      }),
    );
  });

  it('writes every turn message with the timestamp the aggregate assigned', async () => {
    prisma.$transaction.mockImplementation(
      async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(prisma),
    );
    prisma.assistantMessage.create.mockResolvedValue({} as never);
    prisma.assistantConversation.update.mockResolvedValue(row() as never);
    prisma.assistantConversation.findFirst.mockResolvedValue(row() as never);

    const userAt = new Date(T0.getTime() - 1);
    await repository.appendTurn({
      conversationId: 'conv-1',
      userId: 'user-1',
      title: 'hello',
      assistantAt: T0,
      messages: [
        { role: 'user', content: 'q', usedTools: [], createdAt: userAt },
        { role: 'assistant', content: 'a', usedTools: [], createdAt: T0 },
      ],
    });

    const calls = prisma.assistantMessage.create.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'user', createdAt: userAt }),
      }),
    );
    expect(calls[1]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'assistant', createdAt: T0 }),
      }),
    );
  });

  it('only reports a regeneration that is inside the idempotency window', async () => {
    prisma.assistantRegeneration.findFirst.mockResolvedValue(null);

    await repository.findRecentRegeneration('conv-1', 'm1');

    const where = prisma.assistantRegeneration.findFirst.mock.calls[0]?.[0]
      ?.where as { createdAt?: { gte?: Date } } | undefined;
    expect(where?.createdAt?.gte).toBeInstanceOf(Date);
  });
});
