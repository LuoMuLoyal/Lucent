import { Injectable, NotFoundException } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { MedicineSource, Prisma } from '../../generated/prisma/client';
import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateCurrentMedicineDto,
  CreateHealthContextAllergyDto,
  CreateHealthContextConditionDto,
  HealthContextResponseData,
  UpdateCurrentMedicineDto,
  UpdateHealthContextAllergyDto,
  UpdateHealthContextConditionDto,
  UpdateHealthContextProfileDto,
} from './dto';

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

  async updateProfile(
    userId: string,
    dto: UpdateHealthContextProfileDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureActiveUserExists(userId);

    const updateData: Prisma.UserProfileUpdateInput = {};
    const createData: Prisma.UserProfileUncheckedCreateInput = { userId };

    if (dto.locale !== undefined) {
      const locale = this.normalizePreferenceString(dto.locale);
      updateData.locale = locale;
      createData.locale = locale;
    }

    if (dto.timezone !== undefined) {
      const timezone = this.normalizePreferenceString(dto.timezone);
      updateData.timezone = timezone;
      createData.timezone = timezone;
    }

    if (dto.unitSystem !== undefined) {
      updateData.unitSystem = dto.unitSystem;
      createData.unitSystem = dto.unitSystem;
    }

    if (dto.birthDate !== undefined) {
      const date = dto.birthDate
        ? new Date(`${dto.birthDate}T00:00:00.000Z`)
        : null;
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
      const blood = this.normalizePreferenceString(dto.bloodType);
      updateData.bloodType = blood;
      createData.bloodType = blood;
    }

    if (dto.onboardingCompleted !== undefined) {
      if (dto.onboardingCompleted) {
        // Set onboardingCompletedAt only when it is missing.
        // We cannot read-and-check atomically in a single upsert,
        // so we first fetch the current value.
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

    return this.getForUser(userId);
  }

  // ── Allergy write methods ──

  async createAllergy(
    userId: string,
    dto: CreateHealthContextAllergyDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureActiveUserExists(userId);

    await this.prisma.userAllergy.create({
      data: {
        userId,
        kind: dto.kind,
        label: dto.label.trim(),
        reaction: dto.reaction?.trim() ?? null,
        severity: dto.severity ?? null,
        note: dto.note?.trim() ?? null,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : null,
      },
    });

    return this.getForUser(userId);
  }

  async updateAllergy(
    userId: string,
    allergyId: string,
    dto: UpdateHealthContextAllergyDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureAllergyOwnedByUser(userId, allergyId);

    const data: Prisma.UserAllergyUpdateInput = {};

    if (dto.kind !== undefined) {
      data.kind = dto.kind;
    }
    if (dto.label !== undefined) {
      data.label = dto.label.trim();
    }
    if (dto.reaction !== undefined) {
      data.reaction = dto.reaction?.trim() ?? null;
    }
    if (dto.severity !== undefined) {
      data.severity = dto.severity;
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }
    if (dto.recordedAt !== undefined) {
      data.recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : null;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    await this.prisma.userAllergy.update({
      where: { id: allergyId },
      data,
    });

    return this.getForUser(userId);
  }

  async deleteAllergy(
    userId: string,
    allergyId: string,
  ): Promise<HealthContextResponseData> {
    await this.ensureAllergyOwnedByUser(userId, allergyId);

    await this.prisma.userAllergy.update({
      where: { id: allergyId },
      data: { isActive: false },
    });

    return this.getForUser(userId);
  }

  // ── Condition write methods ──

  async createCondition(
    userId: string,
    dto: CreateHealthContextConditionDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureActiveUserExists(userId);

    const createData: Prisma.UserConditionCreateInput = {
      user: { connect: { id: userId } },
      label: dto.label.trim(),
      diagnosedAt: dto.diagnosedAt
        ? new Date(`${dto.diagnosedAt}T00:00:00.000Z`)
        : null,
      note: dto.note?.trim() ?? null,
    };

    if (dto.status !== undefined) {
      createData.status = dto.status;
    }

    await this.prisma.userCondition.create({ data: createData });

    return this.getForUser(userId);
  }

  async updateCondition(
    userId: string,
    conditionId: string,
    dto: UpdateHealthContextConditionDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureConditionOwnedByUser(userId, conditionId);

    const data: Prisma.UserConditionUpdateInput = {};

    if (dto.label !== undefined) {
      data.label = dto.label.trim();
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.diagnosedAt !== undefined) {
      data.diagnosedAt = dto.diagnosedAt
        ? new Date(`${dto.diagnosedAt}T00:00:00.000Z`)
        : null;
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }

    await this.prisma.userCondition.update({
      where: { id: conditionId },
      data,
    });

    return this.getForUser(userId);
  }

  async deleteCondition(
    userId: string,
    conditionId: string,
  ): Promise<HealthContextResponseData> {
    await this.ensureConditionOwnedByUser(userId, conditionId);

    const resolvedAt = new Date();
    // normalise to date-only
    const resolvedDate = new Date(
      Date.UTC(
        resolvedAt.getUTCFullYear(),
        resolvedAt.getUTCMonth(),
        resolvedAt.getUTCDate(),
      ),
    );

    // Only set resolvedAt when it is missing.
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

    return this.getForUser(userId);
  }

  // ── Current medicine write methods ──

  async createCurrentMedicine(
    userId: string,
    dto: CreateCurrentMedicineDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureActiveUserExists(userId);

    const sourceRefId =
      dto.source === MedicineSource.manual ? null : (dto.sourceRefId ?? null);

    await this.prisma.userCurrentMedicine.create({
      data: {
        userId,
        source: dto.source,
        sourceRefId,
        displayName: dto.displayName.trim(),
        strengthText: dto.strengthText?.trim() ?? null,
        doseText: dto.doseText?.trim() ?? null,
        route: dto.route?.trim() ?? null,
        startedAt: dto.startedAt
          ? new Date(`${dto.startedAt}T00:00:00.000Z`)
          : null,
        endedAt: dto.endedAt ? new Date(`${dto.endedAt}T00:00:00.000Z`) : null,
        note: dto.note?.trim() ?? null,
      },
    });

    return this.getForUser(userId);
  }

  async updateCurrentMedicine(
    userId: string,
    medicineId: string,
    dto: UpdateCurrentMedicineDto,
  ): Promise<HealthContextResponseData> {
    await this.ensureCurrentMedicineOwnedByUser(userId, medicineId);

    const data: Prisma.UserCurrentMedicineUpdateInput = {};

    if (dto.source !== undefined) {
      data.source = dto.source;
    }
    if (dto.sourceRefId !== undefined) {
      data.sourceRefId = dto.sourceRefId?.trim() ?? null;
    }
    if (dto.displayName !== undefined) {
      data.displayName = dto.displayName.trim();
    }
    if (dto.strengthText !== undefined) {
      data.strengthText = dto.strengthText?.trim() ?? null;
    }
    if (dto.doseText !== undefined) {
      data.doseText = dto.doseText?.trim() ?? null;
    }
    if (dto.route !== undefined) {
      data.route = dto.route?.trim() ?? null;
    }
    if (dto.startedAt !== undefined) {
      data.startedAt = dto.startedAt
        ? new Date(`${dto.startedAt}T00:00:00.000Z`)
        : null;
    }
    if (dto.endedAt !== undefined) {
      data.endedAt = dto.endedAt
        ? new Date(`${dto.endedAt}T00:00:00.000Z`)
        : null;
    }
    if (dto.note !== undefined) {
      data.note = dto.note?.trim() ?? null;
    }
    if (dto.isCurrent !== undefined) {
      data.isCurrent = dto.isCurrent;
    }

    await this.prisma.userCurrentMedicine.update({
      where: { id: medicineId },
      data,
    });

    return this.getForUser(userId);
  }

  async deleteCurrentMedicine(
    userId: string,
    medicineId: string,
  ): Promise<HealthContextResponseData> {
    await this.ensureCurrentMedicineOwnedByUser(userId, medicineId);

    const endedAt = new Date();
    const endedDate = new Date(
      Date.UTC(
        endedAt.getUTCFullYear(),
        endedAt.getUTCMonth(),
        endedAt.getUTCDate(),
      ),
    );

    // Only set endedAt when it is missing.
    const current = await this.prisma.userCurrentMedicine.findUnique({
      where: { id: medicineId },
      select: { endedAt: true },
    });

    await this.prisma.userCurrentMedicine.update({
      where: { id: medicineId },
      data: {
        isCurrent: false,
        endedAt: current?.endedAt ?? endedDate,
      },
    });

    return this.getForUser(userId);
  }

  // ── Ownership guards ──

  private async ensureAllergyOwnedByUser(
    userId: string,
    allergyId: string,
  ): Promise<void> {
    const allergy = await this.prisma.userAllergy.findUnique({
      where: { id: allergyId },
      select: { userId: true },
    });

    if (!allergy || allergy.userId !== userId) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
  }

  private async ensureConditionOwnedByUser(
    userId: string,
    conditionId: string,
  ): Promise<void> {
    const condition = await this.prisma.userCondition.findUnique({
      where: { id: conditionId },
      select: { userId: true },
    });

    if (!condition || condition.userId !== userId) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
  }

  private async ensureCurrentMedicineOwnedByUser(
    userId: string,
    medicineId: string,
  ): Promise<void> {
    const medicine = await this.prisma.userCurrentMedicine.findUnique({
      where: { id: medicineId },
      select: { userId: true },
    });

    if (!medicine || medicine.userId !== userId) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
  }

  // ── Response mapping ──

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

  private async ensureActiveUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: this.i18n.t('auth.user_not_found'),
      });
    }
  }

  private normalizePreferenceString(value: string | null): string | null {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length == 0 ? null : normalized;
  }
}
