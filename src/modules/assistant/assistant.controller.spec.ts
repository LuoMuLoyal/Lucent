const prepareSse = vi.fn();
const writeSseEvent = vi.fn();
const endSse = vi.fn();

vi.mock('../../common', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prepareSse: (...args: unknown[]): void => {
      prepareSse(...args);
    },
    writeSseEvent: (...args: unknown[]): void => {
      writeSseEvent(...args);
    },
    endSse: (...args: unknown[]): void => {
      endSse(...args);
    },
  };
});

import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ResultCode, SseConnectionRegistry } from '../../common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './services/core.service';
import { AuditLogService } from '../audit-log';

describe('AssistantController', () => {
  let controller: AssistantController;
  let service: vi.Mocked<AssistantService>;
  let auditLogService: vi.Mocked<AuditLogService>;
  let sseRegistry: SseConnectionRegistry;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssistantController],
      providers: [
        {
          provide: AssistantService,
          useValue: {
            getCapabilities: vi.fn(),
            listRecentConversations: vi.fn(),
            getLatestConversation: vi.fn(),
            openConversation: vi.fn(),
            clearLatestConversation: vi.fn(),
            confirmProposal: vi.fn(),
            renameConversation: vi.fn(),
            deleteConversation: vi.fn(),
            clearAssistantMemory: vi.fn(),
            getFoundationCapabilities: vi.fn(),
            streamMessages: vi.fn(),
            regenerateConversation: vi.fn(),
          },
        },
        {
          provide: SseConnectionRegistry,
          useValue: {
            register: vi.fn(),
            unregister: vi.fn(),
            closeAll: vi.fn(),
          },
        },
        {
          provide: AuditLogService,
          useValue: { logFireAndForget: vi.fn() },
        },
      ],
    }).compile();

    controller = module.get(AssistantController);
    service = module.get(AssistantService);
    auditLogService = module.get(AuditLogService);
    sseRegistry = module.get(SseConnectionRegistry);
  });

  it('returns the authenticated user assistant capability resource', async () => {
    service.getCapabilities.mockResolvedValue({
      phase: 'foundation',
      assistantEnabled: true,
      assistantMemoryEnabled: false,
      assistantContext: {
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: false,
        currentMedicines: true,
      },
      chatModelConfigured: true,
      interactiveChatReady: false,
      langGraphReady: true,
      streamingSupported: true,
      streamingTransport: 'sse',
      markdownRenderingRecommended: true,
      ragEnabled: false,
      tools: [],
      updatedAt: '2026-06-17T12:00:00.000Z',
    });

    await expect(
      controller.getCapabilities({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).resolves.toEqual({
      phase: 'foundation',
      assistantEnabled: true,
      assistantMemoryEnabled: false,
      assistantContext: {
        healthProfile: true,
        dailyRecords: true,
        sleepRecords: false,
        currentMedicines: true,
      },
      chatModelConfigured: true,
      interactiveChatReady: false,
      langGraphReady: true,
      streamingSupported: true,
      streamingTransport: 'sse',
      markdownRenderingRecommended: true,
      ragEnabled: false,
      tools: [],
      updatedAt: '2026-06-17T12:00:00.000Z',
    });
    expect(service.getCapabilities).toHaveBeenCalledWith('u1');
  });

  it('returns the recent persisted conversation list resource', async () => {
    service.listRecentConversations.mockResolvedValue([
      {
        id: 'conversation-2',
        title: '最近睡眠怎样？',
        status: 'active',
        lastMessageAt: '2026-06-18T10:00:00.000Z',
        createdAt: '2026-06-18T09:55:00.000Z',
        updatedAt: '2026-06-18T10:00:00.000Z',
      },
      {
        id: 'conversation-1',
        title: '昨天头痛是为什么？',
        status: 'archived',
        lastMessageAt: '2026-06-17T10:00:00.000Z',
        createdAt: '2026-06-17T09:55:00.000Z',
        updatedAt: '2026-06-17T10:00:00.000Z',
      },
    ]);

    await expect(
      controller.listRecentConversations({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).resolves.toEqual([
      {
        id: 'conversation-2',
        title: '最近睡眠怎样？',
        status: 'active',
        lastMessageAt: '2026-06-18T10:00:00.000Z',
        createdAt: '2026-06-18T09:55:00.000Z',
        updatedAt: '2026-06-18T10:00:00.000Z',
      },
      {
        id: 'conversation-1',
        title: '昨天头痛是为什么？',
        status: 'archived',
        lastMessageAt: '2026-06-17T10:00:00.000Z',
        createdAt: '2026-06-17T09:55:00.000Z',
        updatedAt: '2026-06-17T10:00:00.000Z',
      },
    ]);
    expect(service.listRecentConversations).toHaveBeenCalledWith('u1');
  });

  it('streams chunk, result, and done SSE events', async () => {
    const response = { raw: {} } as unknown as FastifyReply;

    service.streamMessages.mockImplementation(
      async (_userId, _dto, _language, onChunk) => {
        await onChunk({ content: 'Hello' });
        return {
          conversationId: 'conversation-1',
          role: 'assistant',
          content: 'Hello there',
          usedTools: [],
          generatedAt: '2026-06-17T12:00:00.000Z',
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
        };
      },
    );

    await controller.streamMessages(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'en-US',
      response,
    );

    expect(prepareSse).toHaveBeenCalledWith(response.raw, sseRegistry);
    expect(writeSseEvent).toHaveBeenNthCalledWith(1, response.raw, {
      event: 'chunk',
      data: { content: 'Hello' },
    });
    expect(writeSseEvent).toHaveBeenNthCalledWith(2, response.raw, {
      event: 'result',
      data: {
        conversationId: 'conversation-1',
        role: 'assistant',
        content: 'Hello there',
        usedTools: [],
        generatedAt: '2026-06-17T12:00:00.000Z',
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
        ],
      },
    });
    expect(writeSseEvent).toHaveBeenNthCalledWith(3, response.raw, {
      event: 'done',
      data: {},
    });
    expect(endSse).toHaveBeenCalledWith(response.raw, sseRegistry);
  });

  it('returns the latest persisted conversation resource', async () => {
    service.getLatestConversation.mockResolvedValue({
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
      controller.getLatestConversation({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).resolves.toEqual({
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
    expect(service.getLatestConversation).toHaveBeenCalledWith('u1');
  });

  it('opens one persisted conversation resource', async () => {
    service.openConversation.mockResolvedValue({
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
      updatedAt: '2026-06-18T10:05:00.000Z',
    });

    await expect(
      controller.openConversation(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'conversation-1',
      ),
    ).resolves.toEqual({
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
      updatedAt: '2026-06-18T10:05:00.000Z',
    });
    expect(service.openConversation).toHaveBeenCalledWith(
      'u1',
      'conversation-1',
    );
  });

  it('clears the latest persisted conversation resource', async () => {
    service.clearLatestConversation.mockResolvedValue({
      cleared: true,
      archivedConversationId: 'conversation-1',
    });

    await expect(
      controller.clearLatestConversation({
        sub: 'u1',
        email: 'a@b.c',
        status: 'active',
      }),
    ).resolves.toEqual({
      cleared: true,
      archivedConversationId: 'conversation-1',
    });
    expect(service.clearLatestConversation).toHaveBeenCalledWith('u1');
  });

  it('confirms pending proposals and returns the decision resource', async () => {
    service.confirmProposal.mockResolvedValue({
      conversationId: 'conversation-1',
      decision: 'approved',
      status: 'approved',
      finalContent: '已确认。',
    });

    await expect(
      controller.confirmProposal(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'conversation-1',
        { proposalIds: ['proposal-1'], decision: 'approved' },
      ),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      decision: 'approved',
      status: 'approved',
      finalContent: '已确认。',
    });
    expect(service.confirmProposal).toHaveBeenCalledWith(
      'u1',
      'conversation-1',
      { proposalIds: ['proposal-1'], decision: 'approved' },
    );
  });

  it('renames one persisted conversation resource', async () => {
    service.renameConversation.mockResolvedValue({
      id: 'conversation-1',
      title: '新标题',
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
      updatedAt: '2026-06-18T10:05:00.000Z',
    });

    await expect(
      controller.renameConversation(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'conversation-1',
        { title: '新标题' },
      ),
    ).resolves.toEqual({
      id: 'conversation-1',
      title: '新标题',
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
      updatedAt: '2026-06-18T10:05:00.000Z',
    });
    expect(service.renameConversation).toHaveBeenCalledWith(
      'u1',
      'conversation-1',
      '新标题',
    );
  });

  it('deletes one persisted conversation resource', async () => {
    service.deleteConversation.mockResolvedValue({
      id: 'conversation-1',
      title: '最近睡眠怎样？',
      status: 'deleted',
      messages: [],
      lastMessageAt: '2026-06-18T10:00:00.000Z',
      createdAt: '2026-06-18T10:00:00.000Z',
      updatedAt: '2026-06-18T10:05:00.000Z',
    });

    await expect(
      controller.deleteConversation(
        { sub: 'u1', email: 'a@b.c', status: 'active' },
        'conversation-1',
      ),
    ).resolves.toEqual({
      id: 'conversation-1',
      title: '最近睡眠怎样？',
      status: 'deleted',
      messages: [],
      lastMessageAt: '2026-06-18T10:00:00.000Z',
      createdAt: '2026-06-18T10:00:00.000Z',
      updatedAt: '2026-06-18T10:05:00.000Z',
    });
    expect(service.deleteConversation).toHaveBeenCalledWith(
      'u1',
      'conversation-1',
    );
  });

  it('erases assistant memories and returns the cleared count resource', async () => {
    service.clearAssistantMemory.mockResolvedValue({ cleared: 3 });

    await expect(
      controller.clearMemory({ sub: 'u1', email: 'a@b.c', status: 'active' }),
    ).resolves.toEqual({ cleared: 3 });
    expect(service.clearAssistantMemory).toHaveBeenCalledWith('u1');
    expect(auditLogService.logFireAndForget).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'assistant.memory.clear',
      metadata: { deletedCount: 3 },
    });
  });

  it('streams an error SSE event when service throws', async () => {
    const response = { raw: {} } as unknown as FastifyReply;
    service.streamMessages.mockRejectedValue(
      new ForbiddenException({
        code: ResultCode.FORBIDDEN,
        message: 'forbidden',
      }),
    );

    await controller.streamMessages(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'en-US',
      response,
    );

    expect(writeSseEvent).toHaveBeenCalledWith(response.raw, {
      event: 'error',
      data: {
        message: 'forbidden',
      },
    });
    expect(endSse).toHaveBeenCalledWith(response.raw, sseRegistry);
  });

  it('streams chunk, result, and done SSE events for regeneration', async () => {
    const response = { raw: {} } as unknown as FastifyReply;
    service.regenerateConversation.mockImplementation(
      async (_userId, _conversationId, onChunk) => {
        await onChunk({ content: '新的' });
        return {
          conversationId: 'conversation-1',
          role: 'assistant',
          content: '新的回答',
          usedTools: [],
          generatedAt: '2026-08-17T12:00:00.000Z',
        };
      },
    );

    await controller.regenerateLastMessage(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      'conversation-1',
      response,
    );

    expect(service.regenerateConversation).toHaveBeenCalledWith(
      'u1',
      'conversation-1',
      expect.any(Function),
    );
    expect(prepareSse).toHaveBeenCalledWith(response.raw, sseRegistry);
    expect(writeSseEvent).toHaveBeenNthCalledWith(1, response.raw, {
      event: 'chunk',
      data: { content: '新的' },
    });
    expect(writeSseEvent).toHaveBeenNthCalledWith(2, response.raw, {
      event: 'result',
      data: {
        conversationId: 'conversation-1',
        role: 'assistant',
        content: '新的回答',
        usedTools: [],
        generatedAt: '2026-08-17T12:00:00.000Z',
      },
    });
    expect(writeSseEvent).toHaveBeenNthCalledWith(3, response.raw, {
      event: 'done',
      data: {},
    });
    expect(endSse).toHaveBeenCalledWith(response.raw, sseRegistry);
  });

  it('streams an error SSE event when regeneration fails', async () => {
    const response = { raw: {} } as unknown as FastifyReply;
    service.regenerateConversation.mockRejectedValue(
      new ForbiddenException({
        code: ResultCode.FORBIDDEN,
        message: 'regenerate-forbidden',
      }),
    );

    await controller.regenerateLastMessage(
      { sub: 'u1', email: 'a@b.c', status: 'active' },
      'conversation-1',
      response,
    );

    expect(writeSseEvent).toHaveBeenCalledWith(response.raw, {
      event: 'error',
      data: { message: 'regenerate-forbidden' },
    });
    expect(endSse).toHaveBeenCalledWith(response.raw, sseRegistry);
  });
});
