import { Test, type TestingModule } from '@nestjs/testing';
import { createDomainFailure, errAsync, okAsync } from '../../common/result';
import type { UserPayload } from '../auth';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/dose-logs.service';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
};

describe('MedicineDoseLogsController', () => {
  let controller: MedicineDoseLogsController;
  let service: vi.Mocked<MedicineDoseLogsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicineDoseLogsController],
      providers: [
        {
          provide: MedicineDoseLogsService,
          useValue: {
            list: vi.fn(),
            create: vi.fn(),
            mark: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(MedicineDoseLogsController);
    service = module.get(MedicineDoseLogsService);
  });

  describe('GET /user/medicine-dose-logs', () => {
    it('should list dose logs for a date', async () => {
      service.list.mockResolvedValue({ items: [], total: 0 } as any);

      const result = await controller.list(mockUser, '2026-06-10');

      expect(service.list).toHaveBeenCalledWith(
        mockUser.sub,
        '2026-06-10',
        1,
        50,
      );
      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('POST /user/medicine-dose-logs', () => {
    it('should create a dose log', async () => {
      const dto = {
        currentMedicineId: 'med-1',
        scheduledFor: '2026-06-10T08:00:00Z',
      };
      service.create.mockReturnValue(okAsync({ id: 'log-1' } as any));

      const result = await controller.create(mockUser, dto as any);

      expect(service.create).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({ id: 'log-1' });
    });

    it('folds a P2002 race on create into DomainFailureException (409)', async () => {
      service.create.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'conflict',
            code: 'RESOURCE_CONFLICT',
          }),
        ),
      );

      await expect(
        controller.create(mockUser, {
          currentMedicineId: 'med-1',
          scheduledFor: '2026-06-10T08:00:00Z',
        } as any),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'RESOURCE_CONFLICT' },
      });
    });
  });

  describe('POST /user/medicine-dose-logs/mark', () => {
    it('should mark a reminder slot dose log idempotently', async () => {
      const dto = {
        currentMedicineId: 'med-1',
        reminderId: 'reminder-1',
        status: 'taken',
        scheduledFor: '2026-07-08',
        scheduledTime: '08:30',
      };
      service.mark.mockReturnValue(
        okAsync({
          id: 'log-1',
          reminderId: 'reminder-1',
        } as any),
      );

      const result = await controller.mark(mockUser, dto as any);

      expect(service.mark).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({ id: 'log-1', reminderId: 'reminder-1' });
    });

    it('folds a mark validation failure into DomainFailureException (400)', async () => {
      service.mark.mockReturnValue(
        errAsync(
          createDomainFailure({
            kind: 'validation',
            code: 'VALIDATION_FAILED',
          }),
        ),
      );

      await expect(
        controller.mark(mockUser, {
          currentMedicineId: 'med-1',
          status: 'taken',
          scheduledFor: '2026-07-08',
        } as any),
      ).rejects.toMatchObject({
        name: 'DomainFailureException',
        failure: { code: 'VALIDATION_FAILED' },
      });
    });
  });

  describe('PATCH /user/medicine-dose-logs/:id', () => {
    it('should update a dose log', async () => {
      service.update.mockReturnValue(okAsync({ id: 'log-1' } as any));

      const result = await controller.update(mockUser, 'log-1', {
        status: 'taken',
      } as any);

      expect(service.update).toHaveBeenCalledWith(mockUser.sub, 'log-1', {
        status: 'taken',
      });
      expect(result).toEqual({ id: 'log-1' });
    });
  });

  describe('DELETE /user/medicine-dose-logs/:id', () => {
    it('should delete a dose log', async () => {
      service.delete.mockReturnValue(okAsync(undefined));

      await expect(
        controller.delete(mockUser, 'log-1'),
      ).resolves.toBeUndefined();

      expect(service.delete).toHaveBeenCalledWith(mockUser.sub, 'log-1');
    });
  });
});
