import { ensureOwnedByUser } from '../../../common';
import { notFound } from '../../../common';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { DailyRecordRepositoryPort } from '../repositories/daily-record.repository';
import type { OwnedRecordSnapshot } from '../types/record.types';

export type { OwnedRecordSnapshot };

@Injectable()
export class DailyRecordsOwnershipService {
  constructor(
    private readonly repository: DailyRecordRepositoryPort,
    private readonly i18n: I18nService,
  ) {}

  async ensureOwnedByUser(
    userId: string,
    id: string,
  ): Promise<OwnedRecordSnapshot> {
    const record = await this.repository.findOwnershipData(id);

    ensureOwnedByUser(
      record,
      userId,
      this.i18n.t('daily-records.record_not_found'),
    );

    return {
      kind: record.kind,
      payload: record.payload,
      occurredAt: record.occurredAt,
    };
  }

  throwRecordNotFound(): never {
    notFound(this.i18n.t('daily-records.record_not_found'));
  }
}
