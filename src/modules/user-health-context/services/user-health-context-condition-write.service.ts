import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { normalizeNullableText } from '../../../common/utils/string.utils';
import { UserHealthContextOwnershipService } from '../guards/ownership.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';
import type {
  CreateHealthContextConditionDto,
  UpdateHealthContextConditionDto,
} from '../dto';

@Injectable()
export class UserHealthContextConditionWriteService {
  constructor(
    private readonly prisma: PrismaService,
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
    await this.prisma.userCondition.create({ data: createData });
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
    await this.prisma.userCondition.update({
      where: { id: conditionId },
      data,
    });
  }

  async softDelete(userId: string, conditionId: string): Promise<void> {
    await this.ownershipService.ensureConditionOwnedByUser(userId, conditionId);
    const resolvedAt = new Date();
    const resolvedDate = this.mapperService.toUtcDateOnly(resolvedAt);
    const current = await this.prisma.userCondition.findUnique({
      where: { id: conditionId },
      select: { resolvedAt: true },
    });
    await this.prisma.userCondition.update({
      where: { id: conditionId },
      data: {
        status: 'resolved',
        resolvedAt: current?.resolvedAt ?? resolvedDate,
      },
    });
  }
}
