import { Injectable } from '@nestjs/common';
import { MedicineSource, Prisma } from '#generated/prisma/client';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository';
import { normalizeNullableText } from '../../../common';
import { UserHealthContextOwnershipService } from '../services/ownership.service';
import { UserHealthContextMapperService } from './mapper.service';
import { now } from '../../../common';
import type { CreateCurrentMedicineDto } from '../dto/create-current-medicine.dto';

import type { UpdateCurrentMedicineDto } from '../dto/update-current-medicine.dto';

@Injectable()
export class UserHealthContextMedicineWriteService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnershipService,
    private readonly mapperService: UserHealthContextMapperService,
  ) {}

  async create(userId: string, dto: CreateCurrentMedicineDto): Promise<void> {
    await this.ownershipService.ensureActiveUserExists(userId);
    const sourceRefId =
      dto.source === MedicineSource.manual ? null : (dto.sourceRefId ?? null);
    await this.repository.createCurrentMedicine({
      userId,
      source: dto.source,
      sourceRefId,
      displayName: dto.displayName.trim(),
      strengthText: normalizeNullableText(dto.strengthText),
      doseText: normalizeNullableText(dto.doseText),
      route: normalizeNullableText(dto.route),
      startedAt: this.mapperService.dateOnlyStringToUtcDate(
        dto.startedAt ?? null,
      ),
      endedAt: this.mapperService.dateOnlyStringToUtcDate(dto.endedAt ?? null),
      note: normalizeNullableText(dto.note),
    });
  }

  async update(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ): Promise<void> {
    await this.ownershipService.ensureCurrentMedicineOwnedByUser(
      userId,
      medicineId,
    );
    const data: Prisma.UserCurrentMedicineUpdateInput = {};
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.sourceRefId !== undefined)
      data.sourceRefId = normalizeNullableText(dto.sourceRefId);
    if (dto.displayName !== undefined)
      data.displayName = dto.displayName.trim();
    if (dto.strengthText !== undefined)
      data.strengthText = normalizeNullableText(dto.strengthText);
    if (dto.doseText !== undefined)
      data.doseText = normalizeNullableText(dto.doseText);
    if (dto.route !== undefined) data.route = normalizeNullableText(dto.route);
    if (dto.startedAt !== undefined)
      data.startedAt = this.mapperService.dateOnlyStringToUtcDate(
        dto.startedAt,
      );
    if (dto.endedAt !== undefined)
      data.endedAt = this.mapperService.dateOnlyStringToUtcDate(dto.endedAt);
    if (dto.note !== undefined) data.note = normalizeNullableText(dto.note);
    if (dto.isCurrent !== undefined) data.isCurrent = dto.isCurrent;
    await this.repository.updateCurrentMedicine(medicineId, data);
  }

  async softDelete(userId: string, medicineId: string): Promise<void> {
    await this.ownershipService.ensureCurrentMedicineOwnedByUser(
      userId,
      medicineId,
    );
    const endedAt = now();
    const endedDate = this.mapperService.toUtcDateOnly(endedAt);
    await this.repository.softDeleteCurrentMedicine(medicineId, endedDate);
  }
}
