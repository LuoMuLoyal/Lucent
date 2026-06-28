import { nonDeleted } from '../../common/utils/prisma.helpers';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateMedicineReminderDto,
  UpdateMedicineReminderDto,
} from './dto';
import { MedicineRemindersOwnershipService } from './guards/ownership.service';
import { MedicineRemindersMapperService } from './services/medicine-reminders-mapper.service';

@Injectable()
export class MedicineRemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: MedicineRemindersOwnershipService,
    private readonly mapperService: MedicineRemindersMapperService,
  ) {}

  async list(userId: string, activeOnly = false) {
    const items = await this.prisma.userMedicineReminder.findMany({
      where: {
        userId,
        ...nonDeleted,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [
        { scheduledHour: 'asc' },
        { scheduledMinute: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    return { items: items.map((item) => this.mapperService.toItem(item)) };
  }

  async create(userId: string, dto: CreateMedicineReminderDto) {
    await this.ownershipService.ensureCurrentMedicineOwnedByUser(
      userId,
      dto.currentMedicineId ?? null,
    );

    const record = await this.prisma.userMedicineReminder.create({
      data: this.mapperService.toCreateData(userId, dto),
    });

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

    const record = await this.prisma.userMedicineReminder.update({
      where: { id },
      data: this.mapperService.toUpdateData(dto, existing),
    });

    return this.mapperService.toItem(record);
  }

  async delete(userId: string, id: string) {
    await this.ownershipService.ensureOwnedByUser(userId, id);
    await this.prisma.userMedicineReminder.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async listDeliveries(userId: string, date?: string, limit = 20) {
    const items = await this.prisma.userReminderDelivery.findMany({
      where: this.mapperService.toDeliveryWhere(userId, date),
      orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
      take: this.mapperService.capDeliveryLimit(limit),
    });

    return {
      items: items.map((item) => this.mapperService.toDeliveryItem(item)),
    };
  }
}
