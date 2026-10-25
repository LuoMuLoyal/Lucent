import { DoseLogStatus } from '#generated/prisma/client.js';

import {
  contradictsReminderMedicine,
  hasResolvableTarget,
  resolveMedicineId,
  resolveScheduledTime,
  slotIdentityOf,
  takenAtFor,
} from './dose-log.js';

describe('dose-log slot rules', () => {
  describe('slotIdentityOf', () => {
    it('identifies a reminder slot by reminder, date and time', () => {
      const date = new Date('2026-07-08T00:00:00.000Z');
      expect(
        slotIdentityOf({
          currentMedicineId: 'medicine-1',
          reminderId: 'reminder-1',
          scheduledFor: date,
          scheduledTime: '08:30',
        }),
      ).toEqual({
        reminderId: 'reminder-1',
        scheduledFor: date,
        scheduledTime: '08:30',
      });
    });

    it('gives a temporary log no identity, so it is never merged', () => {
      // Merging temporary logs by medicine+date would silently collapse two
      // separate doses of the same medicine taken on the same day.
      expect(
        slotIdentityOf({
          currentMedicineId: 'medicine-1',
          reminderId: null,
          scheduledFor: new Date('2026-07-08T00:00:00.000Z'),
          scheduledTime: null,
        }),
      ).toBeNull();
    });

    it('treats the same reminder at a different time as another slot', () => {
      const date = new Date('2026-07-08T00:00:00.000Z');
      const morning = slotIdentityOf({
        currentMedicineId: null,
        reminderId: 'reminder-1',
        scheduledFor: date,
        scheduledTime: '08:30',
      });
      const evening = slotIdentityOf({
        currentMedicineId: null,
        reminderId: 'reminder-1',
        scheduledFor: date,
        scheduledTime: '20:30',
      });
      expect(morning).not.toEqual(evening);
    });
  });

  describe('hasResolvableTarget', () => {
    it('accepts a reminder, a medicine, or both', () => {
      expect(hasResolvableTarget('r1', null)).toBe(true);
      expect(hasResolvableTarget(null, 'm1')).toBe(true);
      expect(hasResolvableTarget('r1', 'm1')).toBe(true);
    });

    it('rejects a payload that names nothing', () => {
      expect(hasResolvableTarget(null, null)).toBe(false);
    });
  });

  describe('contradictsReminderMedicine', () => {
    it('accepts a matching or absent pair', () => {
      expect(contradictsReminderMedicine('m1', 'm1')).toBe(false);
      expect(contradictsReminderMedicine(null, 'm1')).toBe(false);
      expect(contradictsReminderMedicine('m1', null)).toBe(false);
    });

    it('rejects a medicine the reminder does not describe', () => {
      expect(contradictsReminderMedicine('m2', 'm1')).toBe(true);
    });
  });

  describe('resolveMedicineId', () => {
    it('prefers the caller and falls back to the reminder', () => {
      expect(resolveMedicineId('m1', 'm2')).toBe('m1');
      expect(resolveMedicineId(null, 'm2')).toBe('m2');
      expect(resolveMedicineId(null, null)).toBeNull();
    });
  });

  describe('resolveScheduledTime', () => {
    it('prefers an explicit time', () => {
      expect(resolveScheduledTime('09:15', { hour: 8, minute: 30 })).toBe(
        '09:15',
      );
    });

    it('falls back to the reminder schedule, zero-padded', () => {
      expect(resolveScheduledTime(null, { hour: 8, minute: 5 })).toBe('08:05');
      expect(resolveScheduledTime(null, { hour: 20, minute: 30 })).toBe(
        '20:30',
      );
    });

    it('leaves a temporary log without a time', () => {
      expect(resolveScheduledTime(null, null)).toBeNull();
    });
  });

  describe('takenAtFor', () => {
    const at = new Date('2026-07-08T02:00:00.000Z');

    it('stamps the instant for a taken dose', () => {
      expect(takenAtFor('taken', at)).toBe(at);
    });

    it('clears it for a skipped dose', () => {
      // A stale timestamp on a skipped row would make reports count a refused dose.
      expect(takenAtFor('skipped', at)).toBeNull();
    });
  });

  it('only reasons about the two statuses a user can assert', () => {
    // `planned` rows can only arrive from another writer; the aggregate never
    // creates one. Guard against someone widening the union by accident.
    const outcomes: Array<'taken' | 'skipped'> = [
      DoseLogStatus.taken,
      DoseLogStatus.skipped,
    ];
    expect(outcomes).toEqual(['taken', 'skipped']);
  });
});
