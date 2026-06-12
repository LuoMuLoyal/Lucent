import { Injectable, NotFoundException } from '@nestjs/common';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DailyRecordsGuardService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureOwnedByUser(userId: string, id: string): Promise<void> {
    const record = await this.prisma.userDailyRecord.findFirst({
      where: { id, deletedAt: null },
      select: { userId: true },
    });

    if (!record || record.userId !== userId) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'Record not found',
      });
    }
  }

  throwRecordNotFound(): never {
    throw new NotFoundException({
      code: ResultCode.NOT_FOUND,
      message: 'Record not found',
    });
  }
}
