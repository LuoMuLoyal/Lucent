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
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';

describe('AiChatController', () => {
  let controller: AiChatController;
  let service: jest.Mocked<AiChatService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiChatController],
      providers: [
        {
          provide: AiChatService,
          useValue: {
            getCapabilities: jest.fn(),
            getFoundationCapabilities: jest.fn(),
            streamMessages: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AiChatController);
    service = module.get(AiChatService);
  });

  it('returns the authenticated user ai-chat capability envelope', async () => {
    service.getCapabilities.mockResolvedValue({
      phase: 'foundation',
      aiChatEnabled: true,
      aiChatContext: {
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
        aiChatEnabled: true,
        aiChatContext: {
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

  it('streams chunk, result, and done SSE events', async () => {
    const response = {} as never;

    service.streamMessages.mockImplementation(
      async (_userId, _dto, _language, onChunk) => {
        await onChunk({ content: 'Hello' });
        return {
          role: 'assistant',
          content: 'Hello there',
          usedTools: [],
          generatedAt: '2026-06-17T12:00:00.000Z',
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
        role: 'assistant',
        content: 'Hello there',
        usedTools: [],
        generatedAt: '2026-06-17T12:00:00.000Z',
      },
    });
    expect(writeSseEvent).toHaveBeenNthCalledWith(3, response, {
      event: 'done',
      data: {},
    });
    expect(endSse).toHaveBeenCalledWith(response);
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
