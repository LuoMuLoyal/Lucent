import { Injectable } from '@nestjs/common';
import { MedicineSource, Prisma } from '#generated/prisma/client.js';
import { UserHealthContextRepositoryPort } from '../../repositories/health-context.repository.js';
import { normalizeNullableText, now } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { UserHealthContextOwnershipService } from '../ownership.service.js';
import { UserHealthContextMapperService } from '../mapper.service.js';
import type { CreateCurrentMedicineDto } from '../../dto/create-current-medicine.dto.js';

import type { UpdateCurrentMedicineDto } from '../../dto/update-current-medicine.dto.js';

@Injectable()
export class UserHealthContextMedicineWriteService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnershipService,
    private readonly mapperService: UserHealthContextMapperService,
  ) {}

  create(
    userId: string,
    dto: CreateCurrentMedicineDto,
  ): ResultAsync<void, DomainFailure> {
    return this.ownershipService.ensureActiveUserExists(userId).andThen(() => {
      const sourceRefId =
        dto.source === MedicineSource.manual ? null : (dto.sourceRefId ?? null);
      return this.repository.createCurrentMedicine({
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
        endedAt: this.mapperService.dateOnlyStringToUtcDate(
          dto.endedAt ?? null,
        ),
        note: normalizeNullableText(dto.note),
      });
    });
  }

  update(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ): ResultAsync<void, DomainFailure> {
    return this.ownershipService
      .ensureCurrentMedicineOwnedByUser(userId, medicineId)
      .andThen(() => {
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
        if (dto.route !== undefined)
          data.route = normalizeNullableText(dto.route);
        if (dto.startedAt !== undefined)
          data.startedAt = this.mapperService.dateOnlyStringToUtcDate(
            dto.startedAt,
          );
        if (dto.endedAt !== undefined)
          data.endedAt = this.mapperService.dateOnlyStringToUtcDate(
            dto.endedAt,
          );
        if (dto.note !== undefined) data.note = normalizeNullableText(dto.note);
        if (dto.isCurrent !== undefined) data.isCurrent = dto.isCurrent;
        return this.repository.updateCurrentMedicine(medicineId, data);
      });
  }

  softDelete(
    userId: string,
    medicineId: string,
  ): ResultAsync<void, DomainFailure> {
    return this.ownershipService
      .ensureCurrentMedicineOwnedByUser(userId, medicineId)
      .andThen(() => {
        const endedAt = now();
        const endedDate = this.mapperService.toUtcDateOnly(endedAt);
        return this.repository.softDeleteCurrentMedicine(medicineId, endedDate);
      });
  }
}
