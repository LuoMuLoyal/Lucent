import { Test, type TestingModule } from '@nestjs/testing';
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
});
