import { ensureOwnedByUser } from '../../../common/utils/prisma-ownership.helper';
import { notFound } from '../../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import type { DailyRecordKind } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export type OwnedRecordSnapshot = {
  kind: DailyRecordKind;
  payload: unknown;
};

@Injectable()
export class DailyRecordsOwnershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async ensureOwnedByUser(
    userId: string,
    id: string,
  ): Promise<OwnedRecordSnapshot> {
    const record = await this.prisma.userDailyRecord.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, kind: true, payload: true },
    });

    ensureOwnedByUser(
      record,
      userId,
      this.i18n.t('daily-records.record_not_found'),
    );

    return { kind: record.kind, payload: record.payload };
  }

  throwRecordNotFound(): never {
    notFound(this.i18n.t('daily-records.record_not_found'));
  }
}
