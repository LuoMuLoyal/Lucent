/**
 * Data-ownership verification service for daily-records.
 *
 * This is NOT a NestJS Guard. It is imported by domain services to ensure
 * records belong to the current user before mutating or returning them.
 */
import { notFound } from '../../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';

import type { DailyRecordKind } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

export type OwnedRecordSnapshot = {
  kind: DailyRecordKind;
  payload: unknown;
};

@Injectable()
export class DailyRecordsOwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureOwnedByUser(
    userId: string,
    id: string,
  ): Promise<OwnedRecordSnapshot> {
    const record = await this.prisma.userDailyRecord.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true, kind: true, payload: true },
    });

    if (!record || record.userId !== userId) {
      notFound('Record not found');
    }

    return { kind: record.kind, payload: record.payload };
  }

  throwRecordNotFound(): never {
    notFound('Record not found');
  }
}
