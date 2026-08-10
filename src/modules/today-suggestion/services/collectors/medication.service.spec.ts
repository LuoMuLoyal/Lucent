import type { DeepMocked } from '../../../../common/types/deep-mocked';
import { DoseLogStatus } from '#generated/prisma/client';
import type { PrismaService } from '../../../../prisma';
import type { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs';
import { MedicationCollectorService } from './medication.service';
import { TriggerType } from '../../types/suggestion.types';

describe('MedicationCollectorService', () => {
  let service: MedicationCollectorService;
  let prisma: DeepMocked<PrismaService>;
  let doseLogReader: DeepMocked<MedicineDoseLogReaderPort>;

  beforeEach(() => {
    prisma = {
      userMedicineReminder: { findMany: vi.fn() },
      userCurrentMedicine: { findMany: vi.fn() },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          profile: { timezone: 'Asia/Shanghai' },
        }),
      },
    } as unknown as DeepMocked<PrismaService>;
    doseLogReader = {
      listFactsInRange: vi.fn(),
    } as unknown as DeepMocked<MedicineDoseLogReaderPort>;
    service = new MedicationCollectorService(prisma, doseLogReader);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockReminders = (
    overrides: Partial<Record<string, unknown>>[] = [{}],
  ) =>
    overrides.map((o) => ({
      id: 'reminder-1',
      currentMedicineId: 'med-1',
      scheduledHour: 8,
      scheduledMinute: 0,
      daysOfWeek: null,
      startDate: null,
      endDate: null,
      ...o,
    }));

  const mockMedicines = (
    overrides: Partial<Record<string, unknown>>[] = [{}],
  ) =>
    overrides.map((o) => ({
      id: 'med-1',
      displayName: 'Aspirin',
      ...o,
    }));

  it('returns an empty array when the user has no current medicines', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue([]);
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue([]);
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    // Should still emit a summary signal
    expect(signals).toHaveLength(1);
    expect(signals[0]!.kind).toBe('medication_summary');
    expect(signals[0]!.payload).toMatchObject({
      totalMedicines: 0,
      pendingCount: 0,
      completedCount: 0,
    });
  });

  it('emits pending_dose signal for a medicine with a matching reminder', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    const pendingSignal = signals.find((s) => s.kind === 'pending_dose');
    expect(pendingSignal).toBeDefined();
    expect(pendingSignal!.source).toBe('medication');
    expect(pendingSignal!.triggerType).toBe(TriggerType.EVENT);
    expect(pendingSignal!.payload).toMatchObject({
      medicineId: 'med-1',
      medicineName: 'Aspirin',
      scheduledHour: 8,
      scheduledMinute: 0,
    });
  });

  it('emits unconfirmed_medicine signal when no reminder matches', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    // No reminders
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue([]);
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    const unconfirmed = signals.find((s) => s.kind === 'unconfirmed_medicine');
    expect(unconfirmed).toBeDefined();
    expect(unconfirmed!.payload).toMatchObject({
      medicineId: 'med-1',
      medicineName: 'Aspirin',
    });
  });

  it('skips medicines that already have a taken dose log', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: '08:00',
      },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');

    const pending = signals.find((s) => s.kind === 'pending_dose');
    expect(pending).toBeUndefined();

    const unconfirmed = signals.find((s) => s.kind === 'unconfirmed_medicine');
    expect(unconfirmed).toBeUndefined();
  });

  it('skips medicines that already have a skipped dose log', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        status: DoseLogStatus.skipped,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: '08:00',
      },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals.find((s) => s.kind === 'pending_dose')).toBeUndefined();
    expect(
      signals.find((s) => s.kind === 'unconfirmed_medicine'),
    ).toBeUndefined();
  });

  it('emits a medication_summary signal with correct counts', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines([
        { id: 'med-1', displayName: 'Aspirin' },
        { id: 'med-2', displayName: 'Ibuprofen' },
      ]),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue([]);
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      { currentMedicineId: 'med-2', status: DoseLogStatus.taken },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');

    const summary = signals.find((s) => s.kind === 'medication_summary');
    expect(summary).toBeDefined();
    expect(summary!.payload).toMatchObject({
      totalMedicines: 2,
      pendingCount: 1,
      completedCount: 1,
      medicineNames: ['Aspirin', 'Ibuprofen'],
    });
  });

  it('filters reminders by daysOfWeek when set', async () => {
    // 2026-07-09 is a Thursday (weekday=4)
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([{ daysOfWeek: [1, 2, 3] }]), // Mon/Tue/Wed only
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    // Thursday is not in [1,2,3], so no pending_dose — should get unconfirmed
    expect(signals.find((s) => s.kind === 'pending_dose')).toBeUndefined();
    expect(
      signals.find((s) => s.kind === 'unconfirmed_medicine'),
    ).toBeDefined();
  });

  it('calculates overdue minutes from a fixed instant in the user timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:00:00.000Z'));
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'overdueUnconfirmed',
          source: 'medication',
          payload: expect.objectContaining({
            scheduledTime: '08:00',
            status: 'overdueUnconfirmed',
            overdueMinutes: 120,
            isOverdue: true,
          }),
        }),
      ]),
    );
  });

  it('evaluates reminder slots against the user-local current time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T02:00:00.000Z'));
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([
        { id: 'reminder-8', scheduledHour: 8, scheduledMinute: 0 },
        { id: 'reminder-1030', scheduledHour: 10, scheduledMinute: 30 },
      ]),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-08-07');

    expect(
      signals.find(
        (signal) =>
          signal.kind === 'overdueUnconfirmed' &&
          signal.payload['reminderId'] === 'reminder-8',
      ),
    ).toMatchObject({
      payload: {
        status: 'overdueUnconfirmed',
        overdueMinutes: 120,
      },
    });
    expect(
      signals.find(
        (signal) =>
          signal.kind === 'overdueUnconfirmed' &&
          signal.payload['reminderId'] === 'reminder-1030',
      ),
    ).toBeUndefined();
  });

  it('does not infer an overdue slot from a dose fact without scheduledTime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T02:00:00.000Z'));
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue([]);
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        status: DoseLogStatus.missed,
        scheduledFor: new Date('2026-08-07T00:00:00.000Z'),
        scheduledTime: null,
      },
    ]);

    const signals = await service.collect('user-1', '2026-08-07');

    expect(signals.find((signal) => signal.kind === 'overdueUnconfirmed')).toBe(
      undefined,
    );
    expect(signals.find((signal) => signal.kind === 'pending_dose')).toBe(
      undefined,
    );
  });

  it('keeps two reminder slots independent when one is taken', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T02:45:00.000Z'));
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([
        { id: 'reminder-8', scheduledHour: 8, scheduledMinute: 0 },
        { id: 'reminder-1030', scheduledHour: 10, scheduledMinute: 30 },
      ]),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-08-07T00:00:00.000Z'),
        scheduledTime: '08:00',
      },
    ]);

    const signals = await service.collect('user-1', '2026-08-07');

    expect(
      signals.find(
        (signal) =>
          signal.kind === 'taken' &&
          signal.payload['reminderId'] === 'reminder-8',
      ),
    ).toBeDefined();
    expect(
      signals.find(
        (signal) =>
          signal.kind === 'unconfirmed' &&
          signal.payload['reminderId'] === 'reminder-1030',
      ),
    ).toBeDefined();
  });

  it('trims a valid profile timezone before calculating the scheduled instant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T08:30:00.000Z'));
    (prisma.user.findUnique as vi.Mock).mockResolvedValue({
      profile: { timezone: ' UTC ' },
    });
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(
      signals.find((signal) => signal.kind === 'unconfirmed'),
    ).toMatchObject({
      payload: { overdueMinutes: 30 },
    });
  });

  it('falls back to the common default timezone for an invalid profile timezone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T00:30:00.000Z'));
    (prisma.user.findUnique as vi.Mock).mockResolvedValue({
      profile: { timezone: 'Not/IANA' },
    });
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    await expect(service.collect('user-1', '2026-07-09')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'unconfirmed',
          payload: expect.objectContaining({ overdueMinutes: 30 }),
        }),
      ]),
    );
  });

  it('does not create an overdue instant for a DST spring-forward gap', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T08:00:00.000Z'));
    (prisma.user.findUnique as vi.Mock).mockResolvedValue({
      profile: { timezone: 'America/New_York' },
    });
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([{ scheduledHour: 2, scheduledMinute: 30 }]),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-03-08');

    expect(
      signals.find((signal) => signal.kind === 'overdueUnconfirmed'),
    ).toBeUndefined();
    expect(signals.find((signal) => signal.kind === 'planned')).toMatchObject({
      payload: { scheduledTime: '02:30', overdueMinutes: 0 },
    });
  });

  it('uses the earlier instant for an ambiguous DST fall-back local time', async () => {
    vi.useFakeTimers();
    // 01:30 occurs at both 05:30Z and 06:30Z; the collector chooses 05:30Z.
    vi.setSystemTime(new Date('2026-11-01T06:00:00.000Z'));
    (prisma.user.findUnique as vi.Mock).mockResolvedValue({
      profile: { timezone: 'America/New_York' },
    });
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([{ scheduledHour: 1, scheduledMinute: 30 }]),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-11-01');

    expect(
      signals.find((signal) => signal.kind === 'unconfirmed'),
    ).toMatchObject({
      payload: { overdueMinutes: 30 },
    });
  });

  it('returns no signals for an impossible calendar date', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-02-31');

    expect(signals).toEqual([]);
  });

  it('counts reminder slots and no-reminder medicines together in the summary', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines([
        { id: 'med-1', displayName: 'Aspirin' },
        { id: 'med-2', displayName: 'Ibuprofen' },
      ]),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: '08:00',
      },
      {
        currentMedicineId: 'med-2',
        reminderId: null,
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: null,
      },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');
    const summary = signals.find(
      (signal) => signal.kind === 'medication_summary',
    );

    expect(summary!.payload).toMatchObject({
      pendingCount: 0,
      completedCount: 2,
    });
  });

  it('matches a dose log to its reminderId when same-time reminders differ', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:00:00.000Z'));
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([
        { id: 'reminder-a', scheduledHour: 8, scheduledMinute: 0 },
        { id: 'reminder-b', scheduledHour: 8, scheduledMinute: 0 },
      ]),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        reminderId: 'reminder-a',
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: '08:00',
      },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(
      signals.find(
        (signal) =>
          signal.kind === 'taken' &&
          signal.payload['reminderId'] === 'reminder-a',
      ),
    ).toBeDefined();
    expect(
      signals.find(
        (signal) =>
          signal.kind === 'overdueUnconfirmed' &&
          signal.payload['reminderId'] === 'reminder-b',
      ),
    ).toBeDefined();
  });

  it('does not apply a legacy dose log to either of two same-time reminders', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T02:00:00.000Z'));
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders([
        { id: 'reminder-a', scheduledHour: 8, scheduledMinute: 0 },
        { id: 'reminder-b', scheduledHour: 8, scheduledMinute: 0 },
      ]),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        reminderId: null,
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: '08:00',
      },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(
      signals.filter(
        (signal) =>
          signal.kind === 'taken' &&
          (signal.payload['reminderId'] === 'reminder-a' ||
            signal.payload['reminderId'] === 'reminder-b'),
      ),
    ).toHaveLength(0);
    expect(
      signals.filter(
        (signal) =>
          signal.kind === 'overdueUnconfirmed' &&
          (signal.payload['reminderId'] === 'reminder-a' ||
            signal.payload['reminderId'] === 'reminder-b'),
      ),
    ).toHaveLength(2);
  });

  it('returns no signals and performs no reads for an invalid calendar date', async () => {
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue([]);
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue([]);
    (prisma.user.findUnique as vi.Mock).mockResolvedValue(null);
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    await expect(service.collect('user-1', '2026-02-31')).resolves.toEqual([]);

    expect(prisma.userMedicineReminder.findMany).not.toHaveBeenCalled();
    expect(prisma.userCurrentMedicine.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(doseLogReader.listFactsInRange).not.toHaveBeenCalled();
  });

  it('matches a taken log by reminderId even when scheduledTime is null', async () => {
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([
      {
        currentMedicineId: 'med-1',
        reminderId: 'reminder-1',
        status: DoseLogStatus.taken,
        scheduledFor: new Date('2026-07-09T00:00:00.000Z'),
        scheduledTime: null,
      },
    ]);

    const signals = await service.collect('user-1', '2026-07-09');

    expect(
      signals.find(
        (signal) =>
          signal.kind === 'taken' &&
          signal.payload['reminderId'] === 'reminder-1',
      ),
    ).toBeDefined();
  });
});
