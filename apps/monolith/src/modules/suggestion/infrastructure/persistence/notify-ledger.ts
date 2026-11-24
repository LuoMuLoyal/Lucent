import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/index.js';
import {
  NotifyLedgerPort,
  type NotifyMark,
} from '../../application/ports/notify-ledger.js';

/**
 * Prisma implementation of {@link NotifyLedgerPort}.
 *
 * ## How `claimMark` stays atomic
 *
 * `createMany({ skipDuplicates: true })` returns the number of rows it actually
 * inserted. `0` means the unique key was already taken — the caller lost, and it
 * must not emit. That count is the authoritative answer: it comes from the same
 * statement that attempted the write, so no window exists between "decide" and
 * "record".
 *
 * ## Why not `upsert`
 *
 * `upsert` cannot distinguish "created" from "updated" without a second read,
 * and a second read reopens exactly the race this method exists to close. The
 * insert-or-nothing form carries the answer in its own result.
 */
@Injectable()
export class PrismaNotifyLedger extends NotifyLedgerPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findMark(
    userId: string,
    currentMedicineId: string,
    notifyDate: string,
  ): Promise<NotifyMark | null> {
    const row = await this.prisma.userMedicineNotifyMark.findUnique({
      where: {
        userId_currentMedicineId_notifyDate: {
          userId,
          currentMedicineId,
          notifyDate,
        },
      },
      select: {
        currentMedicineId: true,
        notifyDate: true,
        notifiedAt: true,
      },
    });
    return row ?? null;
  }

  async claimMark(
    userId: string,
    currentMedicineId: string,
    notifyDate: string,
  ): Promise<boolean> {
    const inserted = await this.prisma.userMedicineNotifyMark.createMany({
      data: [{ userId, currentMedicineId, notifyDate }],
      skipDuplicates: true,
    });
    // `count` is the number of rows this statement inserted. Anything other than
    // 1 means the row was already there and another run owns today's hint.
    return inserted.count === 1;
  }
}
