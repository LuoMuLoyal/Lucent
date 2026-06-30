import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { ensureOwnedByUser } from '../../../common/utils/prisma-ownership.helper';

import { PrismaService } from '../../../prisma/prisma.service';
import type { OwnedMedicineReminderRecord } from '../types/medicine-reminders.types';

@Injectable()
export class MedicineRemindersOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

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

    ensureOwnedByUser(
      medicine,
      userId,
      this.i18n.t('medicine-reminders.medicine_not_found'),
    );
  }

  async ensureOwnedByUser(
    userId: string,
    id: string,
  ): Promise<OwnedMedicineReminderRecord> {
    const reminder = await this.prisma.userMedicineReminder.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, startDate: true, endDate: true },
    });

    ensureOwnedByUser(
      reminder,
      userId,
      this.i18n.t('medicine-reminders.reminder_not_found'),
    );

    return reminder;
  }
}
