import { Injectable, NotFoundException } from '@nestjs/common';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type { OwnedMedicineReminderRecord } from './medicine-reminders.types';

@Injectable()
export class MedicineRemindersGuardService {
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
      select: { id: true },
    });

    if (medicine == null) {
      this.throwMedicineNotFound();
    }
  }

  async ensureOwnedByUser(
    userId: string,
    id: string,
  ): Promise<OwnedMedicineReminderRecord> {
    const reminder = await this.prisma.userMedicineReminder.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, startDate: true, endDate: true },
    });

    if (!reminder || reminder.userId !== userId) {
      this.throwReminderNotFound();
    }

    return reminder;
  }

  private throwMedicineNotFound(): never {
    throw new NotFoundException({
      code: ResultCode.NOT_FOUND,
      message: 'Medicine not found',
    });
  }

  private throwReminderNotFound(): never {
    throw new NotFoundException({
      code: ResultCode.NOT_FOUND,
      message: 'Reminder not found',
    });
  }
}
