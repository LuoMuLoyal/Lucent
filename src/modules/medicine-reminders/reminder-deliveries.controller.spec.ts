import { Test, type TestingModule } from '@nestjs/testing';
import {
  createDomainFailure,
  errAsync,
  okAsync,
} from '../../common/result/index.js';
import type { UserPayload } from '../auth/index.js';

import { ReminderDeliveriesController } from './reminder-deliveries.controller.js';
import { MedicineRemindersService } from './services/reminders.service.js';
import { DeliveryReceiptsService } from './services/delivery-receipts.service.js';
import { reminderDeliveryReceiptSchema } from './dto/reminder-delivery-receipt.dto.js';
import type { ReminderDeliveryReceiptDto } from './dto/reminder-delivery-receipt.dto.js';

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
    service.listDeliveries.mockReturnValue(okAsync({ items: [] } as any));

    const result = await controller.list(mockUser);

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      undefined,
      20,
    );
    expect(result).toEqual({ items: [] });
  });

  it('should pass date and limit query parameters', async () => {
    service.listDeliveries.mockReturnValue(okAsync({ items: [] } as any));

    await controller.list(mockUser, '2026-06-10', '50');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      '2026-06-10',
      50,
    );
  });

  it('should fall back to default limit when limit is not a number', async () => {
    service.listDeliveries.mockReturnValue(okAsync({ items: [] } as any));

    await controller.list(mockUser, undefined, 'abc');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      undefined,
      20,
    );
  });

  it('should fall back to default limit when limit is empty string', async () => {
    service.listDeliveries.mockReturnValue(okAsync({ items: [] } as any));

    await controller.list(mockUser, undefined, '');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      undefined,
      20,
    );
  });

  it('should pass only date when limit is omitted', async () => {
    service.listDeliveries.mockReturnValue(okAsync({ items: [] } as any));

    await controller.list(mockUser, '2026-06-15');

    expect(service.listDeliveries).toHaveBeenCalledWith(
      mockUser.sub,
      '2026-06-15',
      20,
    );
  });

  // ── Local delivery receipt ──────────────────────────────────────

  it('should record a local delivery receipt and return the item resource', async () => {
    const dto = {
      reminderId: 'reminder-1',
      scheduledDate: '2026-07-20',
      scheduledTime: '08:30',
    };
    receiptsService.recordLocalReceipt.mockReturnValue(
      okAsync({
        id: 'delivery-1',
        reminderId: 'reminder-1',
        deviceId: null,
        channel: 'local',
        status: 'delivered',
        scheduledFor: '2026-07-20T00:30:00.000Z',
        deliveredAt: '2026-07-20T00:30:05.000Z',
        errorMessage: null,
        createdAt: '2026-07-20T00:30:05.000Z',
      } as any),
    );

    const result = await controller.recordReceipt(mockUser, dto as any);

    expect(receiptsService.recordLocalReceipt).toHaveBeenCalledWith(
      mockUser.sub,
      dto,
    );
    expect(result).toEqual({
      item: expect.objectContaining({
        id: 'delivery-1',
        channel: 'local',
        status: 'delivered',
      }),
    });
  });

  it('folds a receipt ownership failure into DomainFailureException (403)', async () => {
    receiptsService.recordLocalReceipt.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'authorization',
          code: 'FORBIDDEN',
        }),
      ),
    );

    await expect(
      controller.recordReceipt(mockUser, {
        reminderId: 'reminder-1',
        scheduledDate: '2026-07-20',
        scheduledTime: '08:30',
      } as any),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'FORBIDDEN' },
    });
  });

  // ── Local capability report ─────────────────────────────────────

  it('should report local capability and return the state resource', async () => {
    receiptsService.reportLocalCapability.mockReturnValue(
      okAsync({ state: 'active' } as any),
    );

    const result = await controller.reportLocalCapability(mockUser, {
      state: 'active',
    } as any);

    expect(receiptsService.reportLocalCapability).toHaveBeenCalledWith(
      mockUser.sub,
      'active',
    );
    expect(result).toEqual({ state: 'active' });
  });

  it('folds a capability report failure into DomainFailureException', async () => {
    receiptsService.reportLocalCapability.mockReturnValue(
      errAsync(
        createDomainFailure({
          kind: 'not_found',
          code: 'RESOURCE_NOT_FOUND',
        }),
      ),
    );

    await expect(
      controller.reportLocalCapability(mockUser, { state: 'active' } as any),
    ).rejects.toMatchObject({
      name: 'DomainFailureException',
      failure: { code: 'RESOURCE_NOT_FOUND' },
    });
  });
});

describe('ReminderDeliveryReceiptDto validation', () => {
  it('rejects a full ISO timestamp as scheduledDate (only YYYY-MM-DD passes)', () => {
    const invalid: ReminderDeliveryReceiptDto = {
      reminderId: 'reminder-1',
      scheduledDate: '2026-07-20T08:30:00.000Z',
      scheduledTime: '08:30',
    };
    const wrongFormat: ReminderDeliveryReceiptDto = {
      reminderId: 'reminder-1',
      scheduledDate: '2026/07/20',
      scheduledTime: '08:30',
    };

    expect(reminderDeliveryReceiptSchema.safeParse(invalid).success).toBe(
      false,
    );
    expect(reminderDeliveryReceiptSchema.safeParse(wrongFormat).success).toBe(
      false,
    );
  });

  it('accepts a YYYY-MM-DD scheduledDate', () => {
    const valid: ReminderDeliveryReceiptDto = {
      reminderId: 'reminder-1',
      scheduledDate: '2026-07-20',
      scheduledTime: '08:30',
    };

    expect(reminderDeliveryReceiptSchema.safeParse(valid).success).toBe(true);
  });
});
