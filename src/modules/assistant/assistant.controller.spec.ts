const prepareSse = jest.fn();
const writeSseEvent = jest.fn();
const endSse = jest.fn();

jest.mock('../../common/sse', () => ({
  prepareSse: (...args: unknown[]): void => {
    prepareSse(...args);
  },
  writeSseEvent: (...args: unknown[]): void => {
    writeSseEvent(...args);
  },
  endSse: (...args: unknown[]): void => {
    endSse(...args);
  },
}));

import { Test, type TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ResultCode } from '../../common/api-envelope';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

describe('AssistantController', () => {
  let controller: AssistantController;
  let service: jest.Mocked<AssistantService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AssistantController],
      providers: [
        {
          provide: AssistantService,
          useValue: {
            getCapabilities: jest.fn(),
            listRecentConversations: jest.fn(),
            getLatestConversation: jest.fn(),
            openConversation: jest.fn(),
            clearLatestConversation: jest.fn(),
            getFoundationCapabilities: jest.fn(),
            streamMessages: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AssistantController);
    service = module.get(AssistantService);
  });

  it('returns the authenticated user assistant capability envelope', async () => {
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
      controller.getCapabilities({ sub: 'u1', email: 'a@b.c' }),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: {
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
      },
    });
    expect(service.getCapabilities).toHaveBeenCalledWith('u1');
  });

  it('returns the recent persisted conversation list envelope', async () => {
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
      controller.listRecentConversations({ sub: 'u1', email: 'a@b.c' }),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: [
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
      ],
    });
    expect(service.listRecentConversations).toHaveBeenCalledWith('u1');
  });

  it('streams chunk, result, and done SSE events', async () => {
    const response = {} as never;

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
      { sub: 'u1', email: 'a@b.c' },
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'en-US',
      response,
    );

    expect(prepareSse).toHaveBeenCalledWith(response);
    expect(writeSseEvent).toHaveBeenNthCalledWith(1, response, {
      event: 'chunk',
      data: { content: 'Hello' },
    });
    expect(writeSseEvent).toHaveBeenNthCalledWith(2, response, {
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
    expect(writeSseEvent).toHaveBeenNthCalledWith(3, response, {
      event: 'done',
      data: {},
    });
    expect(endSse).toHaveBeenCalledWith(response);
  });

  it('returns the latest persisted conversation envelope', async () => {
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
      controller.getLatestConversation({ sub: 'u1', email: 'a@b.c' }),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: {
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
      },
    });
    expect(service.getLatestConversation).toHaveBeenCalledWith('u1');
  });

  it('opens one persisted conversation envelope', async () => {
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
        { sub: 'u1', email: 'a@b.c' },
        'conversation-1',
      ),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: {
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
      },
    });
    expect(service.openConversation).toHaveBeenCalledWith(
      'u1',
      'conversation-1',
    );
  });

  it('clears the latest persisted conversation envelope', async () => {
    service.clearLatestConversation.mockResolvedValue({
      cleared: true,
      archivedConversationId: 'conversation-1',
    });

    await expect(
      controller.clearLatestConversation({ sub: 'u1', email: 'a@b.c' }),
    ).resolves.toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: {
        cleared: true,
        archivedConversationId: 'conversation-1',
      },
    });
    expect(service.clearLatestConversation).toHaveBeenCalledWith('u1');
  });

  it('streams an error SSE event when service throws', async () => {
    const response = {} as never;
    service.streamMessages.mockRejectedValue(
      new ForbiddenException({
        code: ResultCode.FORBIDDEN,
        message: 'forbidden',
      }),
    );

    await controller.streamMessages(
      { sub: 'u1', email: 'a@b.c' },
      {
        messages: [{ role: 'user', content: 'Hi' }],
      },
      'en-US',
      response,
    );

    expect(writeSseEvent).toHaveBeenCalledWith(response, {
      event: 'error',
      data: {
        message: 'forbidden',
        code: ResultCode.FORBIDDEN,
        statusCode: 403,
      },
    });
    expect(endSse).toHaveBeenCalledWith(response);
  });
});
