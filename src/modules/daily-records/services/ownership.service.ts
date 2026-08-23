import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { Injectable } from '@nestjs/common';

import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository';
import type { OwnedRecordSnapshot } from '../types/record.types';

export type { OwnedRecordSnapshot };

@Injectable()
export class DailyRecordsOwnershipService {
  constructor(private readonly repository: DailyRecordRepositoryPort) {}

  /**
   * Ensures a daily record exists and belongs to the user. A missing record
   * maps to `RESOURCE_NOT_FOUND`; a record owned by another user maps to
   * `FORBIDDEN` (403). The ownership lookup is id-scoped (not id+userId) so
   * the two cases can be told apart; the row is never returned to callers.
   */
  ensureOwnedByUser(
    userId: string,
    id: string,
  ): ResultAsync<OwnedRecordSnapshot, DomainFailure> {
    return fromPromise(this.repository.findOwnershipData(id), (error) => {
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
      return okAsync({
        kind: record.kind,
        payload: record.payload,
        occurredAt: record.occurredAt,
      });
    });
  }

  /**
   * Invariant guard used only inside a transaction read-back after a
   * successful create/update (a row that must exist). Keeping it a throw —
   * not a DomainFailure — since it can only mean a programming/database
   * invariant violation, not a client-facing expected failure.
   */
  throwRecordNotFound(): never {
    throw new Error(
      'Daily record invariant violated: expected row missing after write',
    );
  }

  private notFound(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }
}
