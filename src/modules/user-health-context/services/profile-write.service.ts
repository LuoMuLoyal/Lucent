import { normalizeNullableText } from '../../../common';
import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { UserHealthContextRepositoryPort } from '../repositories/health-context.repository';
import type { UpdateHealthContextProfileDto } from '../dto/update-profile.dto';
import { UserHealthContextOwnershipService } from '../services/ownership.service';
import { UserHealthContextMapperService } from './mapper.service';
import { now } from '../../../common';

@Injectable()
export class UserHealthContextProfileWriteService {
  constructor(
    private readonly repository: UserHealthContextRepositoryPort,
    private readonly ownershipService: UserHealthContextOwnershipService,
    private readonly mapperService: UserHealthContextMapperService,
  ) {}

  async upsertProfile(
    userId: string,
    dto: UpdateHealthContextProfileDto,
  ): Promise<void> {
    await this.ownershipService.ensureActiveUserExists(userId);

    const updateData: Prisma.UserProfileUpdateInput = {};
    const createData: Prisma.UserProfileUncheckedCreateInput = { userId };

    if (dto.locale !== undefined) {
      const locale = normalizeNullableText(dto.locale);
      updateData.locale = locale;
      createData.locale = locale;
    }

    if (dto.timezone !== undefined) {
      const timezone = normalizeNullableText(dto.timezone);
      updateData.timezone = timezone;
      createData.timezone = timezone;
    }

    if (dto.unitSystem !== undefined) {
      updateData.unitSystem = dto.unitSystem;
      createData.unitSystem = dto.unitSystem;
    }

    if (dto.birthDate !== undefined) {
      const date = this.mapperService.dateOnlyStringToUtcDate(dto.birthDate);
      updateData.birthDate = date;
      createData.birthDate = date;
    }

    if (dto.sexAtBirth !== undefined) {
      updateData.sexAtBirth = dto.sexAtBirth;
      createData.sexAtBirth = dto.sexAtBirth;
    }

    if (dto.heightCm !== undefined) {
      updateData.heightCm = dto.heightCm;
      createData.heightCm = dto.heightCm;
    }

    if (dto.bloodType !== undefined) {
      const blood = normalizeNullableText(dto.bloodType);
      updateData.bloodType = blood;
      createData.bloodType = blood;
    }

    if (dto.onboardingCompleted !== undefined) {
      if (dto.onboardingCompleted) {
        const current = await this.repository.findProfileByUserId(userId, {
          onboardingCompletedAt: true,
        });
        if (!current?.onboardingCompletedAt) {
          const completedAt = now();
          updateData.onboardingCompletedAt = completedAt;
          createData.onboardingCompletedAt = completedAt;
        }
      } else {
        updateData.onboardingCompletedAt = null;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.repository.upsertProfile({ userId }, createData, updateData);
    }
  }
}
