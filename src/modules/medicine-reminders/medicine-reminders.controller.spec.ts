/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unnecessary-type-assertion */

import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import type { UserPayload } from '../auth/services/auth-token.service';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersService } from './medicine-reminders.service';

const mockUser: UserPayload = { sub: 'user-uuid-1', email: 'test@example.com' };

describe('MedicineRemindersController', () => {
  let controller: MedicineRemindersController;
  let service: jest.Mocked<MedicineRemindersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicineRemindersController],
      providers: [
        {
          provide: MedicineRemindersService,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(MedicineRemindersController);
    service = module.get(MedicineRemindersService);
  });

  describe('GET /user/medicine-reminders', () => {
    it('should list reminders', async () => {
      service.list.mockResolvedValue({ items: [] } as any);

      const result = await controller.list(mockUser);

      expect(service.list).toHaveBeenCalledWith(mockUser.sub, false);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { items: [] },
      });
    });

    it('should pass activeOnly filter', async () => {
      service.list.mockResolvedValue({ items: [] } as any);

      await controller.list(mockUser, 'true');

      expect(service.list).toHaveBeenCalledWith(mockUser.sub, true);
    });
  });

  describe('POST /user/medicine-reminders', () => {
    it('should create a reminder', async () => {
      const dto = {
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 0,
        daysOfWeek: [1, 2, 3],
      };
      service.create.mockResolvedValue({ id: 'rem-1' } as any);

      const result = await controller.create(mockUser, dto as any);

      expect(service.create).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { id: 'rem-1' },
      });
    });
  });

  describe('PATCH /user/medicine-reminders/:id', () => {
    it('should update a reminder', async () => {
      service.update.mockResolvedValue({ id: 'rem-1' } as any);

      const result = await controller.update(mockUser, 'rem-1', {
        scheduledHour: 9,
        scheduledMinute: 0,
      } as any);

      expect(service.update).toHaveBeenCalledWith(mockUser.sub, 'rem-1', {
        scheduledHour: 9,
        scheduledMinute: 0,
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { id: 'rem-1' },
      });
    });
  });

  describe('DELETE /user/medicine-reminders/:id', () => {
    it('should soft-delete a reminder', async () => {
      service.delete.mockResolvedValue(undefined);

      const result = await controller.delete(mockUser, 'rem-1');

      expect(service.delete).toHaveBeenCalledWith(mockUser.sub, 'rem-1');
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });
  });
});
