import { Test, type TestingModule } from '@nestjs/testing';
import type { UserPayload } from '../auth';
import { MedicineRemindersController } from './medicine-reminders.controller';
import { MedicineRemindersService } from './services/reminders.service';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
};

describe('MedicineRemindersController', () => {
  let controller: MedicineRemindersController;
  let service: vi.Mocked<MedicineRemindersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicineRemindersController],
      providers: [
        {
          provide: MedicineRemindersService,
          useValue: {
            list: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            upsertGroup: vi.fn(),
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
      expect(result).toEqual({ items: [] });
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
      expect(result).toEqual({ id: 'rem-1' });
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
      expect(result).toEqual({ id: 'rem-1' });
    });
  });

  describe('DELETE /user/medicine-reminders/:id', () => {
    it('should soft-delete a reminder', async () => {
      service.delete.mockResolvedValue(undefined);

      await expect(
        controller.delete(mockUser, 'rem-1'),
      ).resolves.toBeUndefined();

      expect(service.delete).toHaveBeenCalledWith(mockUser.sub, 'rem-1');
    });
  });

  describe('PUT /user/medicine-reminders/group', () => {
    it('should upsert a whole reminder group', async () => {
      const dto = {
        currentMedicineId: 'med-1',
        slots: [
          { scheduledHour: 8, scheduledMinute: 0 },
          { scheduledHour: 20, scheduledMinute: 30 },
        ],
      };
      service.upsertGroup.mockResolvedValue({ items: [] } as any);

      const result = await controller.upsertGroup(mockUser, dto as any);

      expect(service.upsertGroup).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({ items: [] });
    });
  });
});
