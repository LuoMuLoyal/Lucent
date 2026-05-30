import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { Prisma } from '../generated/prisma/client';
import { ResultCode } from '../common/api-envelope';
import { PrismaService } from '../prisma/prisma.service';
import type { HealthContextResponseData } from './dto';

const CORE_PROFILE_FIELDS = [
  'birthDate',
  'sexAtBirth',
  'heightCm',
  'unitSystem',
] as const;

const userHealthContextInclude = {
  profile: true,
  allergies: {
    where: {
      isActive: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  },
  conditions: {
    orderBy: {
      updatedAt: 'desc',
    },
  },
  currentMedicines: {
    where: {
      isCurrent: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  },
} satisfies Prisma.UserInclude;

type UserHealthContextRecord = Prisma.UserGetPayload<{
  include: typeof userHealthContextInclude;
}>;

@Injectable()
export class UserHealthContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async getForUser(userId: string): Promise<HealthContextResponseData> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      include: userHealthContextInclude,
    });

    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }

    return this.toHealthContextResponse(user);
  }

  private toHealthContextResponse(
    user: UserHealthContextRecord,
  ): HealthContextResponseData {
    const profile = {
      birthDate: this.formatDateOnly(user.profile?.birthDate ?? null),
      sexAtBirth: user.profile?.sexAtBirth ?? null,
      heightCm: user.profile?.heightCm ?? null,
      pregnancyState: user.profile?.pregnancyState ?? null,
      lactationState: user.profile?.lactationState ?? null,
      bloodType: user.profile?.bloodType ?? null,
      locale: user.profile?.locale ?? null,
      timezone: user.profile?.timezone ?? null,
      unitSystem: user.profile?.unitSystem ?? null,
      onboardingCompletedAt: this.formatDateTime(
        user.profile?.onboardingCompletedAt ?? null,
      ),
      extras: user.profile?.extras ?? null,
    };

    const allergies = user.allergies.map((allergy) => ({
      id: allergy.id,
      kind: allergy.kind,
      label: allergy.label,
      reaction: allergy.reaction,
      severity: allergy.severity,
      isActive: allergy.isActive,
      note: allergy.note,
      extras: allergy.extras,
      recordedAt: this.formatDateTime(allergy.recordedAt),
      createdAt: allergy.createdAt.toISOString(),
      updatedAt: allergy.updatedAt.toISOString(),
    }));

    const conditions = user.conditions.map((condition) => ({
      id: condition.id,
      label: condition.label,
      status: condition.status,
      diagnosedAt: this.formatDateOnly(condition.diagnosedAt),
      resolvedAt: this.formatDateOnly(condition.resolvedAt),
      note: condition.note,
      extras: condition.extras,
      createdAt: condition.createdAt.toISOString(),
      updatedAt: condition.updatedAt.toISOString(),
    }));

    const currentMedicines = user.currentMedicines.map((medicine) => ({
      id: medicine.id,
      source: medicine.source,
      sourceRefId: medicine.sourceRefId,
      displayName: medicine.displayName,
      strengthText: medicine.strengthText,
      doseText: medicine.doseText,
      route: medicine.route,
      startedAt: this.formatDateOnly(medicine.startedAt),
      endedAt: this.formatDateOnly(medicine.endedAt),
      isCurrent: medicine.isCurrent,
      note: medicine.note,
      sourcePayload: medicine.sourcePayload,
      createdAt: medicine.createdAt.toISOString(),
      updatedAt: medicine.updatedAt.toISOString(),
    }));

    return {
      summary: {
        age: this.calculateAge(user.profile?.birthDate ?? null),
        onboardingCompleted: profile.onboardingCompletedAt !== null,
        activeAllergyCount: allergies.length,
        conditionCount: conditions.length,
        currentMedicineCount: currentMedicines.length,
        missingCoreProfileFields: this.getMissingCoreProfileFields(profile),
      },
      profile,
      allergies,
      conditions,
      currentMedicines,
    };
  }

  private getMissingCoreProfileFields(profile: {
    birthDate: string | null;
    sexAtBirth: string | null;
    heightCm: number | null;
    unitSystem: string | null;
  }): string[] {
    return CORE_PROFILE_FIELDS.filter((field) => profile[field] === null);
  }

  private calculateAge(birthDate: Date | null): number | null {
    if (!birthDate) {
      return null;
    }

    const today = new Date();
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();

    const hasHadBirthdayThisYear =
      today.getUTCMonth() > birthDate.getUTCMonth() ||
      (today.getUTCMonth() === birthDate.getUTCMonth() &&
        today.getUTCDate() >= birthDate.getUTCDate());

    if (!hasHadBirthdayThisYear) {
      age -= 1;
    }

    return Math.max(age, 0);
  }

  private formatDateOnly(value: Date | null): string | null {
    if (!value) {
      return null;
    }

    return value.toISOString().slice(0, 10);
  }

  private formatDateTime(value: Date | null): string | null {
    return value?.toISOString() ?? null;
  }
}
