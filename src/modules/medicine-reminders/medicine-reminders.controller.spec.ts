import { Test, type TestingModule } from '@nestjs/testing';
import {
  okAsync,
  errAsync,
  createDomainFailure,
} from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';
import { MedicineRemindersController } from './medicine-reminders.controller.js';
import { MedicineRemindersService } from './services/reminders.service.js';
import { createMedicineReminderSchema } from './dto/create.dto.js';
import { updateMedicineReminderSchema } from './dto/update.dto.js';
import { upsertMedicineReminderGroupSchema } from './dto/upsert-group.dto.js';

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
      service.create.mockReturnValue(okAsync({ id: 'rem-1' } as any));

      const result = await controller.create(mockUser, dto as any);

      expect(service.create).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({ id: 'rem-1' });
    });

    it('folds a not-found failure into DomainFailureException', async () => {
      service.create.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        ),
      );

      await expect(
        controller.create(mockUser, {
          currentMedicineId: 'missing',
          scheduledHour: 8,
          scheduledMinute: 0,
        } as any),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('PATCH /user/medicine-reminders/:id', () => {
    it('should update a reminder', async () => {
      service.update.mockReturnValue(okAsync({ id: 'rem-1' } as any));

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
      service.delete.mockReturnValue(okAsync(undefined));

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
      service.upsertGroup.mockReturnValue(okAsync({ items: [] } as any));

      const result = await controller.upsertGroup(mockUser, dto as any);

      expect(service.upsertGroup).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({ items: [] });
    });
  });
});

describe('Medicine reminder HTTP DTO validation', () => {
  it('accepts YYYY-MM-DD and rejects ISO datetime strings for create startDate/endDate', () => {
    expect(
      createMedicineReminderSchema.safeParse({
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 0,
        startDate: '2026-09-03',
        endDate: '2026-09-10',
      }).success,
    ).toBe(true);
    expect(
      createMedicineReminderSchema.safeParse({
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 0,
        startDate: '2026-09-03T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      createMedicineReminderSchema.safeParse({
        currentMedicineId: 'med-1',
        scheduledHour: 8,
        scheduledMinute: 0,
        endDate: '2026-09-10T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('keeps nullish create startDate/endDate clearable', () => {
    expect(
      createMedicineReminderSchema.safeParse({
        scheduledHour: 8,
        scheduledMinute: 0,
        startDate: null,
        endDate: null,
      }).success,
    ).toBe(true);
  });

  it('accepts YYYY-MM-DD and rejects ISO datetime strings for update startDate/endDate', () => {
    expect(
      updateMedicineReminderSchema.safeParse({
        startDate: '2026-09-03',
        endDate: '2026-09-10',
      }).success,
    ).toBe(true);
    expect(
      updateMedicineReminderSchema.safeParse({
        startDate: '2026-09-03T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      updateMedicineReminderSchema.safeParse({
        endDate: '2026-09-10T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('accepts YYYY-MM-DD and rejects ISO datetime strings for group upsert startDate/endDate', () => {
    expect(
      upsertMedicineReminderGroupSchema.safeParse({
        currentMedicineId: 'med-1',
        slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
        startDate: '2026-09-03',
        endDate: '2026-09-10',
      }).success,
    ).toBe(true);
    expect(
      upsertMedicineReminderGroupSchema.safeParse({
        currentMedicineId: 'med-1',
        slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
        startDate: '2026-09-03T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});
