import type { DeepMocked } from '../../../../common/types/deep-mocked';
import { DoseLogStatus } from '#generated/prisma/client';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { MedicineDoseLogReaderPort } from '../../../medicine-dose-logs/repositories';
import { MedicationCollectorService } from './medication.service';
import { TriggerType } from '../../../today-suggestion/types';

describe('MedicationCollectorService', () => {
  let service: MedicationCollectorService;
  let prisma: DeepMocked<PrismaService>;
  let doseLogReader: DeepMocked<MedicineDoseLogReaderPort>;

  beforeEach(() => {
    prisma = {
      userMedicineReminder: { findMany: vi.fn() },
      userCurrentMedicine: { findMany: vi.fn() },
    } as unknown as DeepMocked<PrismaService>;
    doseLogReader = {
      listFactsInRange: vi.fn(),
    } as unknown as DeepMocked<MedicineDoseLogReaderPort>;
    service = new MedicationCollectorService(prisma, doseLogReader);
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
      { currentMedicineId: 'med-1', status: DoseLogStatus.taken },
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
      { currentMedicineId: 'med-1', status: DoseLogStatus.skipped },
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

  it('includes overdue info when scheduled time has passed', async () => {
    // Use a date with time component — parseDateOnly sets to UTC midnight,
    // but the collector computes overdueMinutes from day.getUTCHours/Minutes
    // Since parseDateOnly gives midnight, overdueMinutes will be 0 - scheduled = negative
    // and Math.max(overdueMinutes, 0) = 0, isOverdue = false
    (prisma.userCurrentMedicine.findMany as vi.Mock).mockResolvedValue(
      mockMedicines(),
    );
    (prisma.userMedicineReminder.findMany as vi.Mock).mockResolvedValue(
      mockReminders(),
    );
    (doseLogReader.listFactsInRange as vi.Mock).mockResolvedValue([]);

    const signals = await service.collect('user-1', '2026-07-09');

    const pending = signals.find((s) => s.kind === 'pending_dose');
    expect(pending).toBeDefined();
    expect(pending!.payload).toHaveProperty('overdueMinutes');
    expect(pending!.payload).toHaveProperty('isOverdue');
  });
});
