import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '#generated/prisma/client.js';
import { fromPrismaResult, nonDeleted, now } from '../../../common/index.js';
import {
  createDomainFailure,
  err,
  errAsync,
  fromPromise,
  ok,
  okAsync,
  type DomainFailure,
  type Result,
  type ResultAsync,
} from '../../../common/result/index.js';
import { MedicineReminderRepositoryPort } from '../repositories/reminder.repository.js';
import type { CreateMedicineReminderDto } from '../dto/create.dto.js';

import type { UpdateMedicineReminderDto } from '../dto/update.dto.js';
import type { UpsertMedicineReminderGroupDto } from '../dto/upsert-group.dto.js';
import type { MedicineReminderItemDto } from '../dto/response.dto.js';
import type { ReminderDeliveryItemDto } from '../dto/reminder-delivery-response.dto.js';
import { MedicineRemindersOwnershipService } from './ownership.service.js';
import { MedicineRemindersMapperService } from './mapper.service.js';
import {
  REMINDER_CHANGED,
  type ReminderChangedPayload,
} from '../../../common/events/domain-events.js';

@Injectable()
export class MedicineRemindersService {
  private readonly logger = new Logger(MedicineRemindersService.name);

  constructor(
    private readonly repository: MedicineReminderRepositoryPort,
    private readonly ownershipService: MedicineRemindersOwnershipService,
    private readonly mapperService: MedicineRemindersMapperService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async list(userId: string, activeOnly = false) {
    const items = await this.repository.findManyReminders(
      {
        userId,
        ...nonDeleted,
        ...(activeOnly ? { isActive: true } : {}),
      },
      [
        { scheduledHour: 'asc' },
        { scheduledMinute: 'asc' },
        { createdAt: 'asc' },
      ],
    );

    return { items: items.map((item) => this.mapperService.toItem(item)) };
  }

  create(
    userId: string,
    dto: CreateMedicineReminderDto,
  ): ResultAsync<MedicineReminderItemDto, DomainFailure> {
    return this.ownershipService
      .ensureCurrentMedicineOwnedByUser(userId, dto.currentMedicineId ?? null)
      .andThen(() =>
        this.mapperResult(() => this.mapperService.toCreateData(userId, dto)),
      )
      .andThen((data) => this.repository.createReminder(data))
      .andThen((record) =>
        this.afterWrite(userId, () => this.mapperService.toItem(record)),
      );
  }

  update(
    userId: string,
    id: string,
    dto: UpdateMedicineReminderDto,
  ): ResultAsync<MedicineReminderItemDto, DomainFailure> {
    return this.ownershipService
      .ensureOwnedByUser(userId, id)
      .andThen((existing) => {
        const medicineCheck =
          dto.currentMedicineId !== undefined
            ? this.ownershipService.ensureCurrentMedicineOwnedByUser(
                userId,
                dto.currentMedicineId,
              )
            : okAsync(undefined);

        return medicineCheck
          .andThen(() =>
            this.mapperResult(() =>
              this.mapperService.toUpdateData(dto, existing),
            ),
          )
          .andThen((data) => this.repository.updateReminder({ id }, data))
          .andThen((record) =>
            this.afterWrite(userId, () => this.mapperService.toItem(record)),
          );
      });
  }

  delete(userId: string, id: string): ResultAsync<void, DomainFailure> {
    return this.ownershipService
      .ensureOwnedByUser(userId, id)
      .andThen(() =>
        this.repository.updateReminder(
          { id },
          { deletedAt: now(), isActive: false },
        ),
      )
      .andThen(() =>
        fromPromise(this.emitReminderChanged(userId), (error) => {
          throw error;
        }).map(() => undefined),
      );
  }

  upsertGroup(
    userId: string,
    dto: UpsertMedicineReminderGroupDto,
  ): ResultAsync<{ items: MedicineReminderItemDto[] }, DomainFailure> {
    if (dto.slots.length === 0) {
      return errAsync(this.validationFailed());
    }

    const slotIds = dto.slots
      .map((slot) => slot.id)
      .filter((id): id is string => id != null);
    if (new Set(slotIds).size !== slotIds.length) {
      return errAsync(this.validationFailed());
    }

    return this.ownershipService
      .ensureCurrentMedicineOwnedByUser(userId, dto.currentMedicineId)
      .andThen(() =>
        this.mapperResult(() =>
          this.mapperService.toGroupUpsertData(userId, dto),
        ),
      )
      .andThen((createData) =>
        this.mapperResult(() => this.mapperService.toGroupUpdateData(dto)).map(
          (updateData) => ({ createData, updateData }),
        ),
      )
      .andThen(({ createData, updateData }) => {
        const incomingIds = Array.from(new Set(slotIds));
        const transaction = this.repository.transaction(
          async (
            tx,
          ): Promise<Result<MedicineReminderItemDto[], DomainFailure>> => {
            // Slots carrying an id must belong to this user + medicine and not
            // be soft-deleted; otherwise the whole group upsert fails with 404.
            if (incomingIds.length > 0) {
              const owned = await tx.userMedicineReminder.findMany({
                where: {
                  id: { in: incomingIds },
                  userId,
                  currentMedicineId: dto.currentMedicineId,
                  ...nonDeleted,
                },
                select: { id: true },
              });
              if (owned.length !== incomingIds.length) {
                return err(this.reminderNotFoundFailure());
              }
            }

            // Soft-delete stale group rows before writing, so newly created
            // rows are not swept up by the same filter. Rows kept for update
            // are excluded via the incoming id set.
            const staleWhere: Prisma.UserMedicineReminderWhereInput = {
              userId,
              currentMedicineId: dto.currentMedicineId,
              ...nonDeleted,
            };
            if (incomingIds.length > 0) {
              staleWhere.id = { notIn: incomingIds };
            }
            await tx.userMedicineReminder.updateMany({
              where: staleWhere,
              data: { deletedAt: now(), isActive: false },
            });

            for (const [index, slot] of dto.slots.entries()) {
              if (slot.id != null) {
                await tx.userMedicineReminder.update({
                  where: { id: slot.id },
                  data: {
                    ...updateData,
                    scheduledHour: slot.scheduledHour,
                    scheduledMinute: slot.scheduledMinute,
                  },
                });
              } else {
                const data = createData[index];
                if (data !== undefined) {
                  await tx.userMedicineReminder.create({ data });
                }
              }
            }

            const rows = await tx.userMedicineReminder.findMany({
              where: {
                userId,
                currentMedicineId: dto.currentMedicineId,
                ...nonDeleted,
              },
              orderBy: [
                { scheduledHour: 'asc' },
                { scheduledMinute: 'asc' },
                { createdAt: 'asc' },
              ],
            });

            return ok(rows.map((row) => this.mapperService.toItem(row)));
          },
        );

        // Known Prisma request errors (P2002/P2025) from inside the
        // transaction map to DomainFailure; unknown errors rethrow.
        return fromPrismaResult(transaction)
          .andThen((result) => result)
          .andThen((items) =>
            fromPromise(this.emitReminderChanged(userId), (error) => {
              throw error;
            }).map(() => ({ items })),
          );
      });
  }

  private async emitReminderChanged(userId: string): Promise<void> {
    try {
      await this.eventEmitter.emitAsync(REMINDER_CHANGED, {
        userId,
      } satisfies ReminderChangedPayload);
    } catch (error) {
      this.logger.error(
        'Failed to emit reminder.changed event',
        error instanceof Error ? error.stack : undefined,
        {
          userId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  listDeliveries(
    userId: string,
    date?: string,
    limit = 20,
  ): ResultAsync<{ items: ReminderDeliveryItemDto[] }, DomainFailure> {
    const where = this.mapperResult(() =>
      this.mapperService.toDeliveryWhere(userId, date),
    );
    if (where.isErr()) {
      return errAsync(where.error);
    }

    return fromPromise(
      this.repository.findManyDeliveries(
        where.value,
        [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
        this.mapperService.capDeliveryLimit(limit),
      ),
      (error) => {
        throw error;
      },
    ).map((items) => ({
      items: items.map((item) => this.mapperService.toDeliveryItem(item)),
    }));
  }

  /**
   * Runs a synchronous mapper build that may reject invalid input. The legacy
   * mapper throws `BadRequestException` for expected validation failures;
   * those are folded into `VALIDATION_FAILED`. Anything else rethrows.
   */
  private mapperResult<T>(build: () => T): Result<T, DomainFailure> {
    try {
      return ok(build());
    } catch (error) {
      if (error instanceof BadRequestException) {
        return err(this.validationFailed());
      }
      throw error;
    }
  }

  /** Best-effort domain event emission, then maps the written record. */
  private afterWrite<T>(
    userId: string,
    build: () => T,
  ): ResultAsync<T, DomainFailure> {
    return fromPromise(this.emitReminderChanged(userId), (error) => {
      throw error;
    }).map(build);
  }

  private validationFailed(): DomainFailure {
    return createDomainFailure({
      kind: 'validation',
      code: 'VALIDATION_FAILED',
    });
  }

  private reminderNotFoundFailure(): DomainFailure {
    return createDomainFailure({
      kind: 'not_found',
      code: 'RESOURCE_NOT_FOUND',
    });
  }
}
