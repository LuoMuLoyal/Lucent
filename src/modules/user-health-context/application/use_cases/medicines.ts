import { Injectable } from '@nestjs/common';
import { MedicineSource, Prisma } from '#generated/prisma/client.js';
import { UserHealthContextRepositoryPort } from '../ports/health-context-repository.js';
import { normalizeNullableText, now } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { UserHealthContextOwnership } from '../../application/use_cases/ownership.js';
import { UserHealthContextMapper } from '../read_models/mapper.js';
import type { CreateCurrentMedicineDto } from '../ports/create-current-medicine.js';

import type { UpdateCurrentMedicineDto } from '../ports/update-current-medicine.js';

@Injectable()
export class MedicineUseCases {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnership,
    private readonly mapperService: UserHealthContextMapper,
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
