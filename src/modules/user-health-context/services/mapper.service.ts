import { Injectable } from '@nestjs/common';

import {
  calculateAge,
  formatDateOnly,
  formatDateTime,
  parseDateOnly,
} from '../../../common';
import type { HealthContextResponseData } from '../dto/response.dto';
import {
  CORE_PROFILE_FIELDS,
  type UserHealthContextRecord,
} from '../types/health-context.types';

@Injectable()
export class UserHealthContextMapperService {
  toResponse(user: UserHealthContextRecord): HealthContextResponseData {
    const rawExtras =
      (user.profile?.extras as Record<string, unknown> | null) ?? {};

    const emergencyContactName =
      typeof rawExtras['emergencyContactName'] === 'string'
        ? rawExtras['emergencyContactName']
        : null;
    const emergencyContactPhone =
      typeof rawExtras['emergencyContactPhone'] === 'string'
        ? rawExtras['emergencyContactPhone']
        : null;
    const hasEmergencyContact =
      emergencyContactName !== null || emergencyContactPhone !== null;

    const profile = {
      birthDate: formatDateOnly(user.profile?.birthDate ?? null),
      sexAtBirth: user.profile?.sexAtBirth ?? null,
      heightCm: user.profile?.heightCm ?? null,
      weightKg:
        typeof rawExtras['weightKg'] === 'number'
          ? rawExtras['weightKg']
          : null,
      bloodType: user.profile?.bloodType ?? null,
      locale: user.profile?.locale ?? null,
      timezone: user.profile?.timezone ?? null,
      unitSystem: user.profile?.unitSystem ?? null,
      onboardingCompletedAt: formatDateTime(
        user.profile?.onboardingCompletedAt ?? null,
      ),
      emergencyContact: hasEmergencyContact
        ? {
            name: emergencyContactName,
            phone: emergencyContactPhone,
          }
        : null,
      extras: user.profile?.extras ?? null,
    };

    const allergies = user.allergies.map(
      ({ userId: _userId, recordedAt, createdAt, updatedAt, ...rest }) => ({
        ...rest,
        recordedAt: formatDateTime(recordedAt),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }),
    );

    const conditions = user.conditions.map(
      ({
        userId: _userId,
        diagnosedAt,
        resolvedAt,
        createdAt,
        updatedAt,
        ...rest
      }) => ({
        ...rest,
        diagnosedAt: formatDateOnly(diagnosedAt),
        resolvedAt: formatDateOnly(resolvedAt),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }),
    );

    const currentMedicines = user.currentMedicines.map(
      ({
        userId: _userId,
        startedAt,
        endedAt,
        createdAt,
        updatedAt,
        ...rest
      }) => ({
        ...rest,
        startedAt: formatDateOnly(startedAt),
        endedAt: formatDateOnly(endedAt),
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
      }),
    );

    return {
      summary: {
        age: user.profile?.birthDate
          ? calculateAge(user.profile.birthDate)
          : null,
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

  dateOnlyStringToUtcDate(value: string | null): Date | null {
    return value ? parseDateOnly(value) : null;
  }

  toUtcDateOnly(date: Date): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private getMissingCoreProfileFields(profile: {
    birthDate: string | null;
    sexAtBirth: string | null;
    heightCm: number | null;
    unitSystem: string | null;
  }): string[] {
    return CORE_PROFILE_FIELDS.filter((field) => profile[field] === null);
  }
}
