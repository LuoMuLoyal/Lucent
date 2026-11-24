import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { UserContextRepositoryPort } from '../ports/context-repository.js';
import { normalizeNullableText, now } from '../../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { UserContextOwnership } from '../../application/use_cases/ownership.js';
import { UserContextMapper } from '../read_models/mapper.js';
import type { CreateContextConditionDto } from '../ports/create-condition.js';

import type { UpdateContextConditionDto } from '../ports/update-condition.js';

@Injectable()
export class ConditionUseCases {
  constructor(
    private readonly repository: UserContextRepositoryPort,
    private readonly ownershipService: UserContextOwnership,
    private readonly mapperService: UserContextMapper,
  ) {}

  create(
    userId: string,
    dto: CreateContextConditionDto,
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
    dto: UpdateContextConditionDto,
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
