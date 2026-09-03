import { Injectable } from '@nestjs/common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result/index.js';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository.js';

/**
 * Ownership + existence guards for user health context.
 *
 * Expected failures are expressed as `ResultAsync<void, DomainFailure>`:
 * a missing record maps to `RESOURCE_NOT_FOUND` and a record owned by
 * another user maps to `FORBIDDEN` (403). The lookup reads are deliberately
 * id-scoped (not id+userId) so the two cases can be told apart; the row is
 * never returned to callers.
 */
@Injectable()
export class UserHealthContextOwnershipService {
  constructor(private readonly repository: UserHealthContextRepositoryPort) {}

  ensureActiveUserExists(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.repository.findActiveUserById(userId), (error) => {
      throw error;
    }).andThen((user) => {
      if (user == null) {
        return errAsync(this.notFound());
      }
      return okAsync(undefined);
    });
  }

  ensureAllergyOwnedByUser(
    userId: string,
    allergyId: string,
  ): ResultAsync<void, DomainFailure> {
    return this.ensureOwned(userId, () =>
      this.repository.findAllergyById(allergyId),
    );
  }

  ensureConditionOwnedByUser(
    userId: string,
    conditionId: string,
  ): ResultAsync<void, DomainFailure> {
    return this.ensureOwned(userId, () =>
      this.repository.findConditionById(conditionId),
    );
  }

  ensureCurrentMedicineOwnedByUser(
    userId: string,
    medicineId: string,
  ): ResultAsync<void, DomainFailure> {
    return this.ensureOwned(userId, () =>
      this.repository.findCurrentMedicineById(medicineId),
    );
  }

  private ensureOwned(
    userId: string,
    lookup: () => Promise<{ userId: string } | null>,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(lookup(), (error) => {
      throw error;
    }).andThen((record) => {
      if (record == null) {
        return errAsync(this.notFound());
      }
      if (record.userId !== userId) {
        return errAsync(
          createDomainFailure({ kind: 'authorization', code: 'FORBIDDEN' }),
        );
      }
      return okAsync(undefined);
    });
  }

  private notFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }
}
