import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { MedicinesController } from './medicines.controller';
import { MedicinesService } from './services/medicines.service';

describe('MedicinesController', () => {
  let controller: MedicinesController;
  let service: jest.Mocked<MedicinesService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicinesController],
      providers: [
        {
          provide: MedicinesService,
          useValue: {
            searchWithCache: jest.fn(),
            getDetailWithCache: jest.fn(),
            getRandomSafetyTips: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(MedicinesController);
    service = module.get(MedicinesService);
  });

  describe('getSafetyTips', () => {
    it('returns safety tips from the service', async () => {
      const expectedTips = [
        { id: 'tip-1', text: '提示 1', category: 'alcohol' },
        { id: 'tip-2', text: '提示 2', category: 'caffeine' },
        { id: 'tip-3', text: '提示 3', category: 'timing' },
        { id: 'tip-4', text: '提示 4', category: 'storage' },
      ];
      service.getRandomSafetyTips.mockResolvedValue(expectedTips);

      const result = await controller.getSafetyTips(undefined, 'zh-CN');

      expect(result).toEqual({
        code: 0,
        message: '',
        data: expectedTips,
      });
      expect(service.getRandomSafetyTips).toHaveBeenCalledWith([], 'zh-CN');
    });

    it('normalizes a single exclude value to an array', async () => {
      service.getRandomSafetyTips.mockResolvedValue([]);

      await controller.getSafetyTips('tip-1', 'en');

      expect(service.getRandomSafetyTips).toHaveBeenCalledWith(['tip-1'], 'en');
    });

    it('passes array exclude values as-is', async () => {
      service.getRandomSafetyTips.mockResolvedValue([]);

      await controller.getSafetyTips(['tip-1', 'tip-2'], 'en');

      expect(service.getRandomSafetyTips).toHaveBeenCalledWith(
        ['tip-1', 'tip-2'],
        'en',
      );
    });
  });
});
