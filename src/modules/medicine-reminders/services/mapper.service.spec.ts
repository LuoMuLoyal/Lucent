import { BadRequestException } from '@nestjs/common';
import type { I18nService } from 'nestjs-i18n';
import { Prisma } from '#generated/prisma/client.js';

import { MedicineRemindersMapperService } from './mapper.service.js';

const now = new Date('2026-06-08T12:00:00.000Z');

function reminderRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reminder-1',
    userId: 'user-1',
    currentMedicineId: 'medicine-1' as string | null,
    label: 'Morning dose' as string | null,
    scheduledHour: 8,
    scheduledMinute: 30,
    daysOfWeek: [1, 3, 5],
    startDate: null as Date | null,
    endDate: null as Date | null,
    isActive: true,
    note: 'After breakfast' as string | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function deliveryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-1',
    reminderId: 'reminder-1',
    deviceId: 'device-1',
    channel: 'local',
    status: 'delivered',
    scheduledFor: new Date('2026-06-10T08:00:00.000Z'),
    deliveredAt: new Date('2026-06-10T08:00:10.000Z'),
    errorMessage: null,
    createdAt: now,
    ...overrides,
  };
}

describe('MedicineRemindersMapperService', () => {
  let service: MedicineRemindersMapperService;

  beforeEach(() => {
    service = new MedicineRemindersMapperService({
      t: vi.fn().mockImplementation((key: string) => key),
    } as unknown as I18nService);
  });

  // ── toCreateData ───────────────────────────────────────────────────────

  describe('toCreateData', () => {
    it('maps a full DTO to Prisma create input with normalized text', () => {
      const data = service.toCreateData('user-1', {
        currentMedicineId: 'medicine-1',
        label: ' Morning dose ',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [5, 1, 3, 1],
        startDate: '2026-06-10',
        endDate: '2026-06-20',
        isActive: true,
        note: ' After breakfast ',
      });

      expect(data).toEqual({
        userId: 'user-1',
        currentMedicineId: 'medicine-1',
        label: 'Morning dose',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1, 3, 5],
        startDate: new Date('2026-06-10T00:00:00.000Z'),
        endDate: new Date('2026-06-20T00:00:00.000Z'),
        isActive: true,
        note: 'After breakfast',
      });
    });

    it('defaults isActive to true when not provided', () => {
      const data = service.toCreateData('user-1', {
        scheduledHour: 9,
        scheduledMinute: 0,
      });

      expect(data.isActive).toBe(true);
    });

    it('normalizes null daysOfWeek to Prisma.JsonNull', () => {
      const data = service.toCreateData('user-1', {
        scheduledHour: 9,
        scheduledMinute: 0,
        daysOfWeek: null,
      });

      expect(data.daysOfWeek).toBe(Prisma.JsonNull);
    });

    it('throws BadRequestException for empty daysOfWeek', () => {
      expect(() =>
        service.toCreateData('user-1', {
          scheduledHour: 8,
          scheduledMinute: 0,
          daysOfWeek: [],
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when endDate is before startDate', () => {
      expect(() =>
        service.toCreateData('user-1', {
          scheduledHour: 8,
          scheduledMinute: 0,
          startDate: '2026-06-20',
          endDate: '2026-06-10',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for an invalid date string', () => {
      expect(() =>
        service.toCreateData('user-1', {
          scheduledHour: 8,
          scheduledMinute: 0,
          startDate: 'not-a-date',
        }),
      ).toThrow(BadRequestException);
    });

    it('allows null startDate and endDate', () => {
      const data = service.toCreateData('user-1', {
        scheduledHour: 8,
        scheduledMinute: 0,
        startDate: null,
        endDate: null,
      });

      expect(data.startDate).toBeNull();
      expect(data.endDate).toBeNull();
    });
  });

  // ── toGroupUpsertData / toGroupUpdateData ─────────────────────────────

  describe('toGroupUpsertData', () => {
    it('maps shared group fields onto each slot', () => {
      const data = service.toGroupUpsertData('user-1', {
        currentMedicineId: 'medicine-1',
        label: ' Morning dose ',
        daysOfWeek: [5, 1, 3, 1],
        startDate: '2026-06-10',
        endDate: '2026-06-20',
        isActive: true,
        note: ' After breakfast ',
        slots: [
          { scheduledHour: 8, scheduledMinute: 30 },
          { scheduledHour: 20, scheduledMinute: 5 },
        ],
      });

      expect(data).toEqual([
        {
          userId: 'user-1',
          currentMedicineId: 'medicine-1',
          label: 'Morning dose',
          daysOfWeek: [1, 3, 5],
          startDate: new Date('2026-06-10T00:00:00.000Z'),
          endDate: new Date('2026-06-20T00:00:00.000Z'),
          isActive: true,
          note: 'After breakfast',
          scheduledHour: 8,
          scheduledMinute: 30,
        },
        {
          userId: 'user-1',
          currentMedicineId: 'medicine-1',
          label: 'Morning dose',
          daysOfWeek: [1, 3, 5],
          startDate: new Date('2026-06-10T00:00:00.000Z'),
          endDate: new Date('2026-06-20T00:00:00.000Z'),
          isActive: true,
          note: 'After breakfast',
          scheduledHour: 20,
          scheduledMinute: 5,
        },
      ]);
    });

    it('defaults isActive to true and normalizes null weekdays', () => {
      const data = service.toGroupUpsertData('user-1', {
        currentMedicineId: 'medicine-1',
        daysOfWeek: null,
        slots: [{ scheduledHour: 9, scheduledMinute: 0 }],
      });

      expect(data[0]).toMatchObject({
        currentMedicineId: 'medicine-1',
        daysOfWeek: Prisma.JsonNull,
        isActive: true,
        scheduledHour: 9,
        scheduledMinute: 0,
      });
    });
  });

  describe('toGroupUpdateData', () => {
    it('returns shared group fields without userId or schedule fields', () => {
      const data = service.toGroupUpdateData({
        currentMedicineId: 'medicine-1',
        label: ' Evening ',
        daysOfWeek: [2, 2, 4],
        startDate: '2026-06-10',
        endDate: null,
        isActive: false,
        note: ' Before bed ',
        slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
      });

      expect(data).toEqual({
        currentMedicineId: 'medicine-1',
        label: 'Evening',
        daysOfWeek: [2, 4],
        startDate: new Date('2026-06-10T00:00:00.000Z'),
        endDate: null,
        isActive: false,
        note: 'Before bed',
      });
    });

    it('throws BadRequestException when endDate is before startDate', () => {
      expect(() =>
        service.toGroupUpdateData({
          currentMedicineId: 'medicine-1',
          startDate: '2026-06-20',
          endDate: '2026-06-10',
          slots: [{ scheduledHour: 8, scheduledMinute: 0 }],
        }),
      ).toThrow(BadRequestException);
    });
  });

  // ── toUpdateData ───────────────────────────────────────────────────────

  describe('toUpdateData', () => {
    const existing = { userId: 'user-1', startDate: null, endDate: null };

    it('returns empty object when no fields are provided', () => {
      const data = service.toUpdateData({}, existing);

      expect(data).toEqual({});
    });

    it('disconnects currentMedicine when null is sent', () => {
      const data = service.toUpdateData({ currentMedicineId: null }, existing);

      expect(data.currentMedicine).toEqual({ disconnect: true });
    });

    it('connects currentMedicine when an id is sent', () => {
      const data = service.toUpdateData(
        { currentMedicineId: 'med-2' },
        existing,
      );

      expect(data.currentMedicine).toEqual({ connect: { id: 'med-2' } });
    });

    it('normalizes label text', () => {
      const data = service.toUpdateData({ label: ' Label ' }, existing);

      expect(data.label).toBe('Label');
    });

    it('normalizes null label to null', () => {
      const data = service.toUpdateData({ label: null }, existing);

      expect(data.label).toBeNull();
    });

    it('updates scheduledHour and scheduledMinute', () => {
      const data = service.toUpdateData(
        { scheduledHour: 21, scheduledMinute: 5 },
        existing,
      );

      expect(data.scheduledHour).toBe(21);
      expect(data.scheduledMinute).toBe(5);
    });

    it('updates daysOfWeek and deduplicates', () => {
      const data = service.toUpdateData({ daysOfWeek: [3, 1, 3, 5] }, existing);

      expect(data.daysOfWeek).toEqual([1, 3, 5]);
    });

    it('clears daysOfWeek to JsonNull when null is sent', () => {
      const data = service.toUpdateData({ daysOfWeek: null }, existing);

      expect(data.daysOfWeek).toBe(Prisma.JsonNull);
    });

    it('updates startDate and endDate', () => {
      const data = service.toUpdateData(
        { startDate: '2026-06-09', endDate: '2026-06-18' },
        existing,
      );

      expect(data.startDate).toEqual(new Date('2026-06-09T00:00:00.000Z'));
      expect(data.endDate).toEqual(new Date('2026-06-18T00:00:00.000Z'));
    });

    it('clears startDate to null', () => {
      const data = service.toUpdateData({ startDate: null }, existing);

      expect(data.startDate).toBeNull();
    });

    it('preserves existing startDate when not in DTO', () => {
      const data = service.toUpdateData(
        {},
        {
          userId: 'user-1',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: null,
        },
      );

      expect(data.startDate).toBeUndefined();
    });

    it('throws when updating endDate before existing startDate', () => {
      expect(() =>
        service.toUpdateData(
          { endDate: '2026-05-01' },
          {
            userId: 'user-1',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
          },
        ),
      ).toThrow(BadRequestException);
    });

    it('updates isActive and note', () => {
      const data = service.toUpdateData(
        { isActive: false, note: ' note ' },
        existing,
      );

      expect(data.isActive).toBe(false);
      expect(data.note).toBe('note');
    });

    it('clears note to null', () => {
      const data = service.toUpdateData({ note: null }, existing);

      expect(data.note).toBeNull();
    });
  });

  // ── toDeliveryWhere ────────────────────────────────────────────────────

  describe('toDeliveryWhere', () => {
    it('returns userId-only filter when no date is provided', () => {
      const where = service.toDeliveryWhere('user-1');

      expect(where).toEqual({ userId: 'user-1' });
    });

    it('returns userId-only filter when date is empty string', () => {
      const where = service.toDeliveryWhere('user-1', '');

      expect(where).toEqual({ userId: 'user-1' });
    });

    it('returns userId-only filter when date is whitespace', () => {
      const where = service.toDeliveryWhere('user-1', '  ');

      expect(where).toEqual({ userId: 'user-1' });
    });

    it('builds a date range filter for a valid date', () => {
      const where = service.toDeliveryWhere('user-1', '2026-06-10');

      expect(where).toEqual({
        userId: 'user-1',
        scheduledFor: {
          gte: new Date('2026-06-10T00:00:00.000Z'),
          lt: new Date('2026-06-11T00:00:00.000Z'),
        },
      });
    });

    it('throws BadRequestException for an invalid date', () => {
      expect(() => service.toDeliveryWhere('user-1', 'invalid')).toThrow(
        BadRequestException,
      );
    });
  });

  // ── capDeliveryLimit ───────────────────────────────────────────────────

  describe('capDeliveryLimit', () => {
    it('returns the limit when within range', () => {
      expect(service.capDeliveryLimit(20)).toBe(20);
    });

    it('clamps to minimum 1', () => {
      expect(service.capDeliveryLimit(0)).toBe(1);
      expect(service.capDeliveryLimit(-5)).toBe(1);
    });

    it('clamps to maximum 100', () => {
      expect(service.capDeliveryLimit(200)).toBe(100);
    });

    it('returns 1 when limit is exactly 1', () => {
      expect(service.capDeliveryLimit(1)).toBe(1);
    });

    it('returns 100 when limit is exactly 100', () => {
      expect(service.capDeliveryLimit(100)).toBe(100);
    });
  });

  // ── toItem ─────────────────────────────────────────────────────────────

  describe('toItem', () => {
    it('maps a full record to a response DTO', () => {
      const item = service.toItem(
        reminderRecord({
          startDate: new Date('2026-06-10T00:00:00.000Z'),
          endDate: new Date('2026-06-20T00:00:00.000Z'),
        }),
      );

      expect(item).toEqual({
        id: 'reminder-1',
        currentMedicineId: 'medicine-1',
        label: 'Morning dose',
        scheduledHour: 8,
        scheduledMinute: 30,
        daysOfWeek: [1, 3, 5],
        startDate: '2026-06-10',
        endDate: '2026-06-20',
        isActive: true,
        note: 'After breakfast',
        createdAt: '2026-06-08T12:00:00.000Z',
        updatedAt: '2026-06-08T12:00:00.000Z',
      });
    });

    it('returns null daysOfWeek when the stored value is not an array', () => {
      const item = service.toItem(reminderRecord({ daysOfWeek: null }));

      expect(item.daysOfWeek).toBeNull();
    });

    it('filters non-number entries from daysOfWeek', () => {
      const item = service.toItem(
        reminderRecord({ daysOfWeek: [1, 'bad', 3, null, 5] }),
      );

      expect(item.daysOfWeek).toEqual([1, 3, 5]);
    });

    it('returns null startDate/endDate when the record has none', () => {
      const item = service.toItem(reminderRecord());

      expect(item.startDate).toBeNull();
      expect(item.endDate).toBeNull();
    });
  });

  // ── toDeliveryItem ─────────────────────────────────────────────────────

  describe('toDeliveryItem', () => {
    it('maps a full delivery record to a response DTO', () => {
      const item = service.toDeliveryItem(deliveryRecord());

      expect(item).toEqual({
        id: 'delivery-1',
        reminderId: 'reminder-1',
        deviceId: 'device-1',
        channel: 'local',
        status: 'delivered',
        scheduledFor: '2026-06-10T08:00:00.000Z',
        deliveredAt: '2026-06-10T08:00:10.000Z',
        errorMessage: null,
        createdAt: '2026-06-08T12:00:00.000Z',
      });
    });

    it('returns null deliveredAt when not yet delivered', () => {
      const item = service.toDeliveryItem(
        deliveryRecord({ deliveredAt: null }),
      );

      expect(item.deliveredAt).toBeNull();
    });

    it('preserves an error message when present', () => {
      const item = service.toDeliveryItem(
        deliveryRecord({ errorMessage: 'network timeout' }),
      );

      expect(item.errorMessage).toBe('network timeout');
    });
  });
});
