import { nonDeleted } from '../../../common/helpers';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MedicineReminderRepositoryPort } from '../repositories';
import type {
  CreateMedicineReminderDto,
  UpdateMedicineReminderDto,
} from '../dto';
import { MedicineRemindersOwnershipService } from './ownership.service';
import { MedicineRemindersMapperService } from './mapper.service';
import { now } from '../../../common/helpers';
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
