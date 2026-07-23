import { Test, type TestingModule } from '@nestjs/testing';
import { ResultCode } from '../../common/api';
import type { UserPayload } from '../auth/services';

import { ReminderDeliveriesController } from './reminder-deliveries.controller';
import { MedicineRemindersService } from './services';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
};

describe('ReminderDeliveriesController', () => {
  let controller: ReminderDeliveriesController;
  let service: vi.Mocked<MedicineRemindersService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReminderDeliveriesController],
      providers: [
        {
          provide: MedicineRemindersService,
          useValue: {
            listDeliveries: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ReminderDeliveriesController);
    service = module.get(MedicineRemindersService);
  });

  it('should list deliveries with default limit', async () => {
    service.listDeliveries.mockResolvedValue({ items: [] } as any);

    const result = await controller.list(mockUser);

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      undefined,
      20,
    );
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { items: [] },
    });
  });

  it('should pass date and limit query parameters', async () => {
    service.listDeliveries.mockResolvedValue({ items: [] } as any);

    await controller.list(mockUser, '2026-06-10', '50');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      '2026-06-10',
      50,
    );
  });

  it('should fall back to default limit when limit is not a number', async () => {
    service.listDeliveries.mockResolvedValue({ items: [] } as any);

    await controller.list(mockUser, undefined, 'abc');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      undefined,
      20,
    );
  });

  it('should fall back to default limit when limit is empty string', async () => {
    service.listDeliveries.mockResolvedValue({ items: [] } as any);

    await controller.list(mockUser, undefined, '');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      undefined,
      20,
    );
  });

  it('should pass only date when limit is omitted', async () => {
    service.listDeliveries.mockResolvedValue({ items: [] } as any);

    await controller.list(mockUser, '2026-06-15');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      '2026-06-15',
      20,
    );
  });
});
