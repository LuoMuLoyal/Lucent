/**
 * Data-ownership verification service for medicine-reminders.
 *
 * This is NOT a NestJS Guard. It is imported by domain services to ensure
 * medicines and reminders belong to the current user before mutating them.
 */
import { Injectable } from '@nestjs/common';
import { ensureOwnedByUser } from '../../../common/utils/prisma-ownership.helper';

import { PrismaService } from '../../../prisma/prisma.service';
import type { OwnedMedicineReminderRecord } from '../types/medicine-reminders.types';

@Injectable()
export class MedicineRemindersOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureCurrentMedicineOwnedByUser(
    userId: string,
    currentMedicineId: string | null | undefined,
  ): Promise<void> {
    if (currentMedicineId == null) {
      return;
    }

    const medicine = await this.prisma.userCurrentMedicine.findFirst({
      where: { id: currentMedicineId, userId, isCurrent: true },
      select: { id: true, userId: true },
    });

    ensureOwnedByUser(medicine, userId, 'Medicine not found');
  }

  async ensureOwnedByUser(
    userId: string,
    id: string,
  ): Promise<OwnedMedicineReminderRecord> {
    const reminder = await this.prisma.userMedicineReminder.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, startDate: true, endDate: true },
    });

    ensureOwnedByUser(reminder, userId, 'Reminder not found');

    return reminder;
  }
}
