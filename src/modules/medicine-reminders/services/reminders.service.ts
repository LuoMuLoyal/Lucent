import { nonDeleted } from '../../../common/helpers/prisma.helpers';
import { Injectable } from '@nestjs/common';
import { MedicineReminderRepositoryPort } from '../repositories';
import type {
  CreateMedicineReminderDto,
  UpdateMedicineReminderDto,
} from '../dto';
import { MedicineRemindersOwnershipService } from './ownership.service';
import { MedicineRemindersMapperService } from './mapper.service';
import { now } from '../../../common/helpers/date-time.utils';

@Injectable()
export class MedicineRemindersService {
  constructor(
    private readonly repository: MedicineReminderRepositoryPort,
    private readonly ownershipService: MedicineRemindersOwnershipService,
    private readonly mapperService: MedicineRemindersMapperService,
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

    return this.mapperService.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ownershipService.ensureOwnedByUser(userId, id);
    await this.repository.updateReminder(
      { id },
      { deletedAt: now(), isActive: false },
    );
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
