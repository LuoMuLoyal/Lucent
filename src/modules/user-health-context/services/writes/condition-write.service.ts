import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { UserHealthContextRepositoryPort } from '../../repositories/health-context.repository';
import { normalizeNullableText, now } from '../../../../common';
import type { DomainFailure, ResultAsync } from '../../../../common/result';
import { UserHealthContextOwnershipService } from '../ownership.service';
import { UserHealthContextMapperService } from '../mapper.service';
import type { CreateHealthContextConditionDto } from '../../dto/create-condition.dto';

import type { UpdateHealthContextConditionDto } from '../../dto/update-condition.dto';

@Injectable()
export class UserHealthContextConditionWriteService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnershipService,
    private readonly mapperService: UserHealthContextMapperService,
  ) {}

  create(
    userId: string,
    dto: CreateHealthContextConditionDto,
  ): ResultAsync<void, DomainFailure> {
    return this.ownershipService.ensureActiveUserExists(userId).andThen(() => {
      const createData: Prisma.UserConditionCreateInput = {
        user: { connect: { id: userId } },
        label: dto.label.trim(),
        diagnosedAt: this.mapperService.dateOnlyStringToUtcDate(
          dto.diagnosedAt ?? null,
        ),
        note: normalizeNullableText(dto.note),
      };
      if (dto.status !== undefined) createData.status = dto.status;
      return this.repository.createCondition(createData);
    });
  }

  update(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ): ResultAsync<void, DomainFailure> {
    return this.ownershipService
      .ensureConditionOwnedByUser(userId, conditionId)
      .andThen(() => {
        const data: Prisma.UserConditionUpdateInput = {};
        if (dto.label !== undefined) data.label = dto.label.trim();
        if (dto.status !== undefined) data.status = dto.status;
        if (dto.diagnosedAt !== undefined)
          data.diagnosedAt = this.mapperService.dateOnlyStringToUtcDate(
            dto.diagnosedAt,
          );
        if (dto.note !== undefined) data.note = normalizeNullableText(dto.note);
        return this.repository.updateCondition(conditionId, data);
      });
  }

  softDelete(
    userId: string,
    conditionId: string,
  ): ResultAsync<void, DomainFailure> {
    return this.ownershipService
      .ensureConditionOwnedByUser(userId, conditionId)
      .andThen(() => {
        const resolvedAt = now();
        const resolvedDate = this.mapperService.toUtcDateOnly(resolvedAt);
        return this.repository.softDeleteCondition(conditionId, resolvedDate);
      });
  }
}
