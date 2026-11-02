/**
 * Persistence: the reminder group upsert transaction.
 *
 * ## Why this lives in `infrastructure/`
 *
 * `PUT /medicine-reminders/group` is one transaction that touches several
 * aggregate instances at once (update the kept slots, soft-delete the ones the
 * request omitted, create the new ones, then re-read), and it is written against
 * Prisma's transaction client. Expressing it through the repository port would
 * mean a port method that re-declares Prisma's `WhereInput` semantics — which is
 * exactly the leak the four-layer split exists to remove.
 *
 * So the *transaction* lives here and the *service* keeps the orchestration
 * (validation, ownership proof, mapping, event publication). The service calls
 * `applyGroupUpsert`, which either resolves the re-read reminder rows or rejects
 * with the mapped `DomainFailure`.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';

import { PrismaService } from '../../../../prisma/index.js';
import { nonDeleted } from '../../../../common/index.js';
import { mapPrismaKnownRequestError } from '../../../../common/helpers/prisma/prisma-result.utils.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';

/** What the group upsert has to write. */
export interface ReminderGroupWrite {
  userId: string;
  currentMedicineId: string;
  /** Ids of the slots the request kept; everything else is soft-deleted. */
  incomingIds: string[];
  /** Columns shared by every slot in the group (label, window, flags, ...). */
  updateData: Prisma.UserMedicineReminderUncheckedUpdateManyInput;
  /** Per-slot rows to create, in request order. */
  createData: Prisma.UserMedicineReminderUncheckedCreateInput[];
  /** Per-slot schedule overrides keyed by slot id. */
  slots: ReadonlyArray<{
    id: string | null;
    scheduledHour: number;
    scheduledMinute: number;
  }>;
  deletedAt: Date;
}

@Injectable()
export class ReminderGroupWriter {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Applies the group upsert in one transaction and returns the live rows.
   *
   * Throws `DomainFailureException(RESOURCE_NOT_FOUND)` when a slot being kept
   * does not belong to this user + medicine (or is soft-deleted), and maps
   * P2002/P2025 the same way the rest of the module does.
   */
  async apply(write: ReminderGroupWrite): Promise<ReminderRow[]> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (write.incomingIds.length > 0) {
          const owned = await tx.userMedicineReminder.findMany({
            where: {
              id: { in: write.incomingIds },
              userId: write.userId,
              currentMedicineId: write.currentMedicineId,
              ...nonDeleted,
            },
            select: { id: true },
          });
          if (owned.length !== write.incomingIds.length) {
            throw new DomainFailureException(this.notFoundFailure());
          }
        }

        // Soft-delete stale rows before writing, so newly created rows are not
        // swept up by the same filter. Kept rows are excluded by id.
        const staleWhere: Prisma.UserMedicineReminderWhereInput = {
          userId: write.userId,
          currentMedicineId: write.currentMedicineId,
          ...nonDeleted,
        };
        if (write.incomingIds.length > 0) {
          staleWhere.id = { notIn: write.incomingIds };
        }
        await tx.userMedicineReminder.updateMany({
          where: staleWhere,
          data: { deletedAt: write.deletedAt, isActive: false },
        });

        for (const slot of write.slots) {
          if (slot.id != null) {
            await tx.userMedicineReminder.update({
              where: { id: slot.id },
              data: {
                ...write.updateData,
                scheduledHour: slot.scheduledHour,
                scheduledMinute: slot.scheduledMinute,
              },
            });
          }
        }
        for (const data of write.createData) {
          await tx.userMedicineReminder.create({ data });
        }

        return await tx.userMedicineReminder.findMany({
          where: {
            userId: write.userId,
            currentMedicineId: write.currentMedicineId,
            ...nonDeleted,
          },
          orderBy: [
            { scheduledHour: 'asc' },
            { scheduledMinute: 'asc' },
            { createdAt: 'asc' },
          ],
        });
      });
    } catch (error) {
      if (error instanceof DomainFailureException) {
        throw error;
      }
      const failure = mapPrismaKnownRequestError(error);
      if (failure != null) {
        throw new DomainFailureException(failure);
      }
      throw error;
    }
  }

  private notFoundFailure() {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }
}

/** A reminder row as returned by the writer (shape the mapper consumes). */
export type ReminderRow = Prisma.UserMedicineReminderGetPayload<object>;
