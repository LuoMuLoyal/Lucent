import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { UserHealthContextRepositoryPort } from '../repositories';
import { normalizeNullableText } from '../../../common/helpers';
import { UserHealthContextOwnershipService } from '../services/ownership.service';
import { UserHealthContextMapperService } from './mapper.service';
import { now } from '../../../common/helpers';
import type {
  CreateHealthContextConditionDto,
  UpdateHealthContextConditionDto,
} from '../dto';

@Injectable()
export class UserHealthContextConditionWriteService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnershipService,
    private readonly mapperService: UserHealthContextMapperService,
  ) {}

  async create(
    userId: string,
    dto: CreateHealthContextConditionDto,
  ): Promise<void> {
    await this.ownershipService.ensureActiveUserExists(userId);
    const createData: Prisma.UserConditionCreateInput = {
      user: { connect: { id: userId } },
      label: dto.label.trim(),
      diagnosedAt: this.mapperService.dateOnlyStringToUtcDate(
        dto.diagnosedAt ?? null,
      ),
      note: normalizeNullableText(dto.note),
    };
    if (dto.status !== undefined) createData.status = dto.status;
    await this.repository.createCondition(createData);
  }

  async update(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ): Promise<void> {
    await this.ownershipService.ensureConditionOwnedByUser(userId, conditionId);
    const data: Prisma.UserConditionUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.diagnosedAt !== undefined)
      data.diagnosedAt = this.mapperService.dateOnlyStringToUtcDate(
        dto.diagnosedAt,
      );
    if (dto.note !== undefined) data.note = normalizeNullableText(dto.note);
    await this.repository.updateCondition(conditionId, data);
  }

  async softDelete(userId: string, conditionId: string): Promise<void> {
    await this.ownershipService.ensureConditionOwnedByUser(userId, conditionId);
    const resolvedAt = now();
    const resolvedDate = this.mapperService.toUtcDateOnly(resolvedAt);
    await this.repository.softDeleteCondition(conditionId, resolvedDate);
  }
}
