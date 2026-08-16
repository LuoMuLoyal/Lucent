import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { ResultCode } from '../../common';
import type { UserPayload } from '../auth';

import { ReminderDeliveriesController } from './reminder-deliveries.controller';
import { MedicineRemindersService } from './services/reminders.service';
import { DeliveryReceiptsService } from './services/delivery-receipts.service';
import { ReminderDeliveryReceiptDto } from './dto/reminder-delivery-receipt.dto';

const mockUser: UserPayload = {
  sub: 'user-uuid-1',
  email: 'test@example.com',
  status: 'active',
};

describe('ReminderDeliveriesController', () => {
  let controller: ReminderDeliveriesController;
  let service: vi.Mocked<MedicineRemindersService>;
  let receiptsService: vi.Mocked<DeliveryReceiptsService>;

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
        {
          provide: DeliveryReceiptsService,
          useValue: {
            recordLocalReceipt: vi.fn(),
            reportLocalCapability: vi.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ReminderDeliveriesController);
    service = module.get(MedicineRemindersService);
    receiptsService = module.get(DeliveryReceiptsService);
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

  // ── Local delivery receipt ──────────────────────────────────────

  it('should record a local delivery receipt and return the item envelope', async () => {
    const dto = {
      reminderId: 'reminder-1',
      scheduledDate: '2026-07-20',
      scheduledTime: '08:30',
    };
    receiptsService.recordLocalReceipt.mockResolvedValue({
      id: 'delivery-1',
      reminderId: 'reminder-1',
      deviceId: null,
      channel: 'local',
      status: 'delivered',
      scheduledFor: '2026-07-20T00:30:00.000Z',
      deliveredAt: '2026-07-20T00:30:05.000Z',
      errorMessage: null,
      createdAt: '2026-07-20T00:30:05.000Z',
    } as any);

    const result = await controller.recordReceipt(mockUser, dto as any);

    expect(receiptsService.recordLocalReceipt).toHaveBeenCalledWith(
      mockUser.sub,
      dto,
    );
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: {
        item: expect.objectContaining({
          id: 'delivery-1',
          channel: 'local',
          status: 'delivered',
        }),
      },
    });
  });

  // ── Local capability report ─────────────────────────────────────

  it('should report local capability and return the state envelope', async () => {
    receiptsService.reportLocalCapability.mockResolvedValue({
      state: 'active',
    });

    const result = await controller.reportLocalCapability(mockUser, {
      state: 'active',
    } as any);

    expect(receiptsService.reportLocalCapability).toHaveBeenCalledWith(
      mockUser.sub,
      'active',
    );
    expect(result).toEqual({
      code: ResultCode.SUCCESS,
      message: '',
      data: { state: 'active' },
    });
  });
});

describe('ReminderDeliveryReceiptDto validation', () => {
  it('rejects a full ISO timestamp as scheduledDate (only YYYY-MM-DD passes)', async () => {
    const invalid = Object.assign(new ReminderDeliveryReceiptDto(), {
      reminderId: 'reminder-1',
      scheduledDate: '2026-07-20T08:30:00.000Z',
      scheduledTime: '08:30',
    });
    const wrongFormat = Object.assign(new ReminderDeliveryReceiptDto(), {
      reminderId: 'reminder-1',
      scheduledDate: '2026/07/20',
      scheduledTime: '08:30',
    });

    expect(await validate(invalid)).not.toHaveLength(0);
    expect(await validate(wrongFormat)).not.toHaveLength(0);
  });

  it('accepts a YYYY-MM-DD scheduledDate', async () => {
    const valid = Object.assign(new ReminderDeliveryReceiptDto(), {
      reminderId: 'reminder-1',
      scheduledDate: '2026-07-20',
      scheduledTime: '08:30',
    });

    expect(await validate(valid)).toHaveLength(0);
  });
});
