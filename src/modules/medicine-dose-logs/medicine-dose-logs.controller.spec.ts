import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api-envelope';
import type { UserPayload } from '../auth/services/auth-token.service';
import { MedicineDoseLogsController } from './medicine-dose-logs.controller';
import { MedicineDoseLogsService } from './services/medicine-dose-logs.service';

const mockUser: UserPayload = { sub: 'user-uuid-1', email: 'test@example.com' };

describe('MedicineDoseLogsController', () => {
  let controller: MedicineDoseLogsController;
  let service: jest.Mocked<MedicineDoseLogsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MedicineDoseLogsController],
      providers: [
        {
          provide: MedicineDoseLogsService,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(MedicineDoseLogsController);
    service = module.get(MedicineDoseLogsService);
  });

  describe('GET /user/medicine-dose-logs', () => {
    it('should list dose logs for a date', async () => {
      service.list.mockResolvedValue({ items: [] } as any);

      const result = await controller.list(mockUser, '2026-06-10');

      expect(service.list).toHaveBeenCalledWith(mockUser.sub, '2026-06-10');
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { items: [] },
      });
    });
  });

  describe('POST /user/medicine-dose-logs', () => {
    it('should create a dose log', async () => {
      const dto = {
        currentMedicineId: 'med-1',
        scheduledFor: '2026-06-10T08:00:00Z',
      };
      service.create.mockResolvedValue({ id: 'log-1' } as any);

      const result = await controller.create(mockUser, dto as any);

      expect(service.create).toHaveBeenCalledWith(mockUser.sub, dto);
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { id: 'log-1' },
      });
    });
  });

  describe('PATCH /user/medicine-dose-logs/:id', () => {
    it('should update a dose log', async () => {
      service.update.mockResolvedValue({ id: 'log-1' } as any);

      const result = await controller.update(mockUser, 'log-1', {
        status: 'taken',
      } as any);

      expect(service.update).toHaveBeenCalledWith(mockUser.sub, 'log-1', {
        status: 'taken',
      });
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: { id: 'log-1' },
      });
    });
  });

  describe('DELETE /user/medicine-dose-logs/:id', () => {
    it('should delete a dose log', async () => {
      service.delete.mockResolvedValue(undefined);

      const result = await controller.delete(mockUser, 'log-1');

      expect(service.delete).toHaveBeenCalledWith(mockUser.sub, 'log-1');
      expect(result).toEqual({
        code: ResultCode.SUCCESS,
        message: '',
        data: null,
      });
    });
  });
});
