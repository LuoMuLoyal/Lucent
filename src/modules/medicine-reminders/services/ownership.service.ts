import { Injectable } from '@nestjs/common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';

import { MedicineReminderRepositoryPort } from '../repositories/reminder.repository.js';
import type { OwnedMedicineReminderRecord } from '../types/reminder.types.js';

@Injectable()
export class MedicineRemindersOwnershipService {
  constructor(private readonly repository: MedicineReminderRepositoryPort) {}

  ensureCurrentMedicineOwnedByUser(
    userId: string,
    currentMedicineId: string | null | undefined,
  ): ResultAsync<void, DomainFailure> {
    if (currentMedicineId == null) {
      return okAsync(undefined);
    }

    return fromPromise(
      this.repository.findCurrentMedicine(currentMedicineId, userId),
      (error) => {
        throw error;
      },
    ).andThen((medicine) => {
      if (medicine == null) {
        return errAsync(this.medicineNotFoundFailure());
      }
      // The repository query is already scoped by userId+isCurrent; the
      // explicit check is defense in depth and keeps the legacy 404 semantics
      // (a foreign medicine is indistinguishable from a missing one).
      if (medicine.userId !== userId) {
        return errAsync(this.medicineNotFoundFailure());
      }
      return okAsync(undefined);
    });
  }

  ensureOwnedByUser(
    userId: string,
    id: string,
  ): ResultAsync<OwnedMedicineReminderRecord, DomainFailure> {
    return fromPromise(
      this.repository.findReminderById(id, {
        userId: true,
        startDate: true,
        endDate: true,
      }),
      (error) => {
        throw error;
      },
    ).andThen((reminder) => {
      const record = reminder as OwnedMedicineReminderRecord | null;
      if (record == null) {
        return errAsync(this.reminderNotFoundFailure());
      }
      if (record.userId !== userId) {
        return errAsync(this.forbiddenFailure());
      }
      return okAsync(record);
    });
  }

  private medicineNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  private reminderNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }

  private forbiddenFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'authorization',
      code: 'FORBIDDEN',
    });
  }
}
