import { normalizeNullableText } from '../../../common/utils/string.utils';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { UpdateHealthContextProfileDto } from '../dto';
import { UserHealthContextOwnershipService } from '../guards/ownership.service';
import { UserHealthContextMapperService } from './user-health-context-mapper.service';

@Injectable()
export class UserHealthContextProfileWriteService {
  constructor(
    private readonly prisma: PrismaService,
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

    if (dto.pregnancyState !== undefined) {
      updateData.pregnancyState = dto.pregnancyState;
      createData.pregnancyState = dto.pregnancyState;
    }

    if (dto.lactationState !== undefined) {
      updateData.lactationState = dto.lactationState;
      createData.lactationState = dto.lactationState;
    }

    if (dto.bloodType !== undefined) {
      const blood = normalizeNullableText(dto.bloodType);
      updateData.bloodType = blood;
      createData.bloodType = blood;
    }

    if (dto.onboardingCompleted !== undefined) {
      if (dto.onboardingCompleted) {
        const current = await this.prisma.userProfile.findUnique({
          where: { userId },
          select: { onboardingCompletedAt: true },
        });
        if (!current?.onboardingCompletedAt) {
          const completedAt = new Date();
          updateData.onboardingCompletedAt = completedAt;
          createData.onboardingCompletedAt = completedAt;
        }
      } else {
        updateData.onboardingCompletedAt = null;
      }
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.userProfile.upsert({
        where: { userId },
        create: createData,
        update: updateData,
      });
    }
  }
}
