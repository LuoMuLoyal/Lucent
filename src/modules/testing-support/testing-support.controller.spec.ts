import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import { TestingSupportController } from './testing-support.controller';
import { TestingSupportService } from './services/testing-support.service';
import type { PrepareFullstackRecordLaneDto } from './dto/prepare-fullstack-record-lane.dto';

describe('TestingSupportController', () => {
  let controller: TestingSupportController;
  let service: vi.Mocked<TestingSupportService>;

  beforeEach(async () => {
    service = {
      prepareFullstackRecordLane: vi.fn(),
    } as unknown as vi.Mocked<TestingSupportService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TestingSupportController],
      providers: [{ provide: TestingSupportService, useValue: service }],
    }).compile();

    controller = module.get(TestingSupportController);
  });

  it('delegates to service and wraps result in success envelope', async () => {
    const dto: PrepareFullstackRecordLaneDto = {
      email: 'test@example.com',
      password: 'StrongPass123!',
      date: '2026-07-10',
      nickname: 'TestUser',
    };

    const mockResult = {
      createdUser: true,
      userId: 'user-1',
      email: 'test@example.com',
      nickname: 'TestUser',
      date: '2026-07-10',
      clearedRecordCount: 0,
    };

    service.prepareFullstackRecordLane.mockResolvedValue(mockResult);

    const result = await controller.prepareFullstackRecordLane(dto);

    expect(service.prepareFullstackRecordLane).toHaveBeenCalledWith(dto);
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: mockResult,
    });
  });

  it('works without optional nickname', async () => {
    const dto: PrepareFullstackRecordLaneDto = {
      email: 'test2@example.com',
      password: 'StrongPass123!',
      date: '2026-07-11',
    };

    const mockResult = {
      createdUser: true,
      userId: 'user-2',
      email: 'test2@example.com',
      nickname: 'E2E Record Lane',
      date: '2026-07-11',
      clearedRecordCount: 3,
    };

    service.prepareFullstackRecordLane.mockResolvedValue(mockResult);

    const result = await controller.prepareFullstackRecordLane(dto);

    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: mockResult,
    });
  });
});
