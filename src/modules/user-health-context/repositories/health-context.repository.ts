import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { nonDeleted } from '../../../common';
import { userHealthContextInclude } from '../types/health-context.types';

/**
 * Abstract port for user-health-context data access.
 *
 * Centralises all Prisma queries for user health context (profile, allergies,
 * conditions, current medicines) behind a single interface so that the write
 * services and ownership service don't depend on `PrismaService` directly.
 */
export abstract class UserHealthContextRepositoryPort {
  // ── Read ────────────────────────────────────────────────────────────────

  abstract findUserWithHealthContext(
    userId: string,
  ): Promise<Prisma.UserGetPayload<{
    include: typeof userHealthContextInclude;
  }> | null>;

  abstract findProfileByUserId(
    userId: string,
    select: { onboardingCompletedAt?: boolean; extras?: boolean },
  ): Promise<{
    onboardingCompletedAt?: Date | null;
    extras?: Prisma.JsonValue | null;
  } | null>;

  // ── Profile ─────────────────────────────────────────────────────────────

  abstract upsertProfile(
    where: { userId: string },
    create: Prisma.UserProfileUncheckedCreateInput,
    update: Prisma.UserProfileUpdateInput,
  ): Promise<void>;

  // ── Allergy ─────────────────────────────────────────────────────────────

  abstract createAllergy(
    data: Prisma.UserAllergyUncheckedCreateInput,
  ): Promise<void>;
  abstract updateAllergy(
    id: string,
    data: Prisma.UserAllergyUpdateInput,
  ): Promise<void>;
  abstract softDeleteAllergy(id: string): Promise<void>;
  abstract findAllergyById(
    userId: string,
    id: string,
  ): Promise<{ userId: string } | null>;

  // ── Condition ───────────────────────────────────────────────────────────

  abstract createCondition(
    data: Prisma.UserConditionCreateInput,
  ): Promise<void>;
  abstract updateCondition(
    id: string,
    data: Prisma.UserConditionUpdateInput,
  ): Promise<void>;
  abstract softDeleteCondition(id: string, resolvedAt: Date): Promise<void>;
  abstract findConditionById(
    userId: string,
    id: string,
  ): Promise<{ userId: string } | null>;

  // ── Current Medicine ────────────────────────────────────────────────────

  abstract createCurrentMedicine(
    data: Prisma.UserCurrentMedicineUncheckedCreateInput,
  ): Promise<void>;
  abstract updateCurrentMedicine(
    id: string,
    data: Prisma.UserCurrentMedicineUpdateInput,
  ): Promise<void>;
  abstract softDeleteCurrentMedicine(id: string, endedAt: Date): Promise<void>;
  abstract findCurrentMedicineById(
    userId: string,
    id: string,
  ): Promise<{ userId: string; endedAt: Date | null } | null>;

  // ── User ────────────────────────────────────────────────────────────────

  abstract findActiveUserById(userId: string): Promise<{ id: string } | null>;
}

@Injectable()
export class UserHealthContextRepository extends UserHealthContextRepositoryPort {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  override findUserWithHealthContext(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      include: userHealthContextInclude,
    });
  }

  override findProfileByUserId(
    userId: string,
    select: { onboardingCompletedAt: boolean },
  ) {
    return this.prisma.userProfile.findUnique({ where: { userId }, select });
  }

  override async upsertProfile(
    where: { userId: string },
    create: Prisma.UserProfileUncheckedCreateInput,
    update: Prisma.UserProfileUpdateInput,
  ): Promise<void> {
    await this.prisma.userProfile.upsert({ where, create, update });
  }

  override async createAllergy(
    data: Prisma.UserAllergyUncheckedCreateInput,
  ): Promise<void> {
    await this.prisma.userAllergy.create({ data });
  }

  override async updateAllergy(
    id: string,
    data: Prisma.UserAllergyUpdateInput,
  ): Promise<void> {
    await this.prisma.userAllergy.update({ where: { id }, data });
  }

  override async softDeleteAllergy(id: string): Promise<void> {
    await this.prisma.userAllergy.update({
      where: { id },
      data: { isActive: false },
    });
  }

  override findAllergyById(userId: string, id: string) {
    return this.prisma.userAllergy.findFirst({
      where: { id, userId },
      select: { userId: true },
    });
  }

  override async createCondition(
    data: Prisma.UserConditionCreateInput,
  ): Promise<void> {
    await this.prisma.userCondition.create({ data });
  }

  override async updateCondition(
    id: string,
    data: Prisma.UserConditionUpdateInput,
  ): Promise<void> {
    await this.prisma.userCondition.update({ where: { id }, data });
  }

  override async softDeleteCondition(
    id: string,
    resolvedAt: Date,
  ): Promise<void> {
    await this.prisma.userCondition.update({
      where: { id },
      data: { status: 'resolved', resolvedAt },
    });
  }

  override findConditionById(userId: string, id: string) {
    return this.prisma.userCondition.findFirst({
      where: { id, userId },
      select: { userId: true },
    });
  }

  override async createCurrentMedicine(
    data: Prisma.UserCurrentMedicineUncheckedCreateInput,
  ): Promise<void> {
    await this.prisma.userCurrentMedicine.create({ data });
  }

  override async updateCurrentMedicine(
    id: string,
    data: Prisma.UserCurrentMedicineUpdateInput,
  ): Promise<void> {
    await this.prisma.userCurrentMedicine.update({ where: { id }, data });
  }

  override async softDeleteCurrentMedicine(
    id: string,
    endedAt: Date,
  ): Promise<void> {
    const current = await this.prisma.userCurrentMedicine.findUnique({
      where: { id },
      select: { endedAt: true },
    });
    await this.prisma.userCurrentMedicine.update({
      where: { id },
      data: { isCurrent: false, endedAt: current?.endedAt ?? endedAt },
    });
  }

  override findCurrentMedicineById(userId: string, id: string) {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id, userId },
      select: { userId: true, endedAt: true },
    });
  }

  override findActiveUserById(userId: string) {
    return this.prisma.user.findFirst({
      where: { id: userId, ...nonDeleted },
      select: { id: true },
    });
  }
}
