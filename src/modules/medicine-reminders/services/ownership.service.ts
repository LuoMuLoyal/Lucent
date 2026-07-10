import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { ensureOwnedByUser } from '../../../common/helpers/prisma-ownership.helper';

import { MedicineReminderRepositoryPort } from '../repositories';
import type { OwnedMedicineReminderRecord } from '../types/types';

@Injectable()
export class MedicineRemindersOwnershipService {
  constructor(
    private readonly repository: MedicineReminderRepositoryPort,
    private readonly i18n: I18nService,
  ) {}

  async ensureCurrentMedicineOwnedByUser(
    userId: string,
    currentMedicineId: string | null | undefined,
  ): Promise<void> {
    if (currentMedicineId == null) {
      return;
    }

    const medicine = await this.repository.findCurrentMedicine(
      currentMedicineId,
      userId,
    );

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
    const reminder = (await this.repository.findReminderById(id, {
      userId: true,
      startDate: true,
      endDate: true,
    })) as OwnedMedicineReminderRecord | null;

    ensureOwnedByUser(
      reminder,
      userId,
      this.i18n.t('medicine-reminders.reminder_not_found'),
    );

    return reminder;
  }
}
