import { Injectable, NotFoundException } from '@nestjs/common';
import type { DailyRecordKind } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';

export type OwnedRecordSnapshot = {
  kind: DailyRecordKind;
  payload: unknown;
};

@Injectable()
export class DailyRecordsGuardService {
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
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Record not found',
      });
    }

    return { kind: record.kind, payload: record.payload };
  }

  throwRecordNotFound(): never {
    throw new NotFoundException({
      code: ResultCode.NOT_FOUND,
      message: 'Record not found',
    });
  }
}
