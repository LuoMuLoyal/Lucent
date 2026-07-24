import { Injectable } from '@nestjs/common';
import { Prisma, UserAllergySeverity } from '#generated/prisma/client';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository';
import { normalizeNullableText } from '../../../common';
import { UserHealthContextOwnershipService } from '../services/ownership.service';
import type { CreateHealthContextAllergyDto } from '../dto/create-allergy.dto';

import type { UpdateHealthContextAllergyDto } from '../dto/update-allergy.dto';

@Injectable()
export class UserHealthContextAllergyWriteService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnershipService,
  ) {}

  async create(
    userId: string,
    dto: CreateHealthContextAllergyDto,
  ): Promise<void> {
    await this.ownershipService.ensureActiveUserExists(userId);
    await this.repository.createAllergy({
      userId,
      kind: dto.kind,
      label: dto.label.trim(),
      reaction: normalizeNullableText(dto.reaction),
      severity: dto.severity ?? UserAllergySeverity.unknown,
      note: normalizeNullableText(dto.note),
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : null,
    });
  }

  async update(
    userId: string,
    allergyId: string,
    dto: UpdateHealthContextAllergyDto,
  ): Promise<void> {
    await this.ownershipService.ensureAllergyOwnedByUser(userId, allergyId);
    const data: Prisma.UserAllergyUpdateInput = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.reaction !== undefined)
      data.reaction = normalizeNullableText(dto.reaction);
    if (dto.severity !== undefined) data.severity = dto.severity;
    if (dto.note !== undefined) data.note = normalizeNullableText(dto.note);
    if (dto.recordedAt !== undefined)
      data.recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    await this.repository.updateAllergy(allergyId, data);
  }

  async softDelete(userId: string, allergyId: string): Promise<void> {
    await this.ownershipService.ensureAllergyOwnedByUser(userId, allergyId);
    await this.repository.softDeleteAllergy(allergyId);
  }
}
