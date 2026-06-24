import { Injectable } from '@nestjs/common';
import type { HealthContextResponseData } from '../dto';
import {
  CORE_PROFILE_FIELDS,
  type UserHealthContextRecord,
} from '../types/user-health-context.types';

@Injectable()
export class UserHealthContextMapperService {
  toResponse(user: UserHealthContextRecord): HealthContextResponseData {
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

  normalizePreferenceString(value: string | null): string | null {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  }

  dateOnlyStringToUtcDate(value: string | null): Date | null {
    return value ? new Date(`${value}T00:00:00.000Z`) : null;
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
