import { badRequest, nonDeleted, notFound, now } from '../../../common';
import { Injectable, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Prisma } from '#generated/prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MedicineReminderRepositoryPort } from '../repositories/reminder.repository';
import type { CreateMedicineReminderDto } from '../dto/create.dto';

import type { UpdateMedicineReminderDto } from '../dto/update.dto';
import type { UpsertMedicineReminderGroupDto } from '../dto/upsert-group.dto';
import { MedicineRemindersOwnershipService } from './ownership.service';
import { MedicineRemindersMapperService } from './mapper.service';
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
    private readonly i18n: I18nService,
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

  async create(userId: string, dto: CreateMedicineReminderDto) {
    await this.ownershipService.ensureCurrentMedicineOwnedByUser(
      userId,
      dto.currentMedicineId ?? null,
    );

    const record = await this.repository.createReminder(
      this.mapperService.toCreateData(userId, dto),
    );

    await this.emitReminderChanged(userId);
    return this.mapperService.toItem(record);
  }

  async update(userId: string, id: string, dto: UpdateMedicineReminderDto) {
    const existing = await this.ownershipService.ensureOwnedByUser(userId, id);

    if (dto.currentMedicineId !== undefined) {
      await this.ownershipService.ensureCurrentMedicineOwnedByUser(
        userId,
        dto.currentMedicineId,
      );
    }

    const record = await this.repository.updateReminder(
      { id },
      this.mapperService.toUpdateData(dto, existing),
    );

    await this.emitReminderChanged(userId);
    return this.mapperService.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ownershipService.ensureOwnedByUser(userId, id);
    await this.repository.updateReminder(
      { id },
      { deletedAt: now(), isActive: false },
    );
    await this.emitReminderChanged(userId);
  }

  async upsertGroup(userId: string, dto: UpsertMedicineReminderGroupDto) {
    if (dto.slots.length === 0) {
      badRequest(this.i18n.t('medicine-reminders.reminder_group_empty'));
    }

    await this.ownershipService.ensureCurrentMedicineOwnedByUser(
      userId,
      dto.currentMedicineId,
    );

    const createData = this.mapperService.toGroupUpsertData(userId, dto);
    const updateData = this.mapperService.toGroupUpdateData(dto);
    const incomingIds = Array.from(
      new Set(
        dto.slots
          .map((slot) => slot.id)
          .filter((id): id is string => id != null),
      ),
    );

    const items = await this.repository.transaction(async (tx) => {
      // Slots carrying an id must belong to this user + medicine and not be
      // soft-deleted; otherwise the whole group upsert fails with 404.
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
          notFound(this.i18n.t('medicine-reminders.reminder_not_found'));
        }
      }

      // Soft-delete stale group rows before writing, so newly created rows are
      // not swept up by the same filter. Rows kept for update are excluded via
      // the incoming id set.
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

      return rows.map((row) => this.mapperService.toItem(row));
    });

    await this.emitReminderChanged(userId);
    return { items };
  }

  private async emitReminderChanged(userId: string): Promise<void> {
    try {
      await this.eventEmitter.emitAsync(REMINDER_CHANGED, {
        userId,
      } satisfies ReminderChangedPayload);
    } catch (error) {
      this.logger.warn('Failed to emit reminder.changed event', {
        userId,
        error,
      });
    }
  }

  async listDeliveries(userId: string, date?: string, limit = 20) {
    const items = await this.repository.findManyDeliveries(
      this.mapperService.toDeliveryWhere(userId, date),
      [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
      this.mapperService.capDeliveryLimit(limit),
    );

    return {
      items: items.map((item) => this.mapperService.toDeliveryItem(item)),
    };
  }
}
