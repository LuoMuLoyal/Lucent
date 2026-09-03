import { Injectable } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '../../../prisma/index.js';
import { fromPrismaResult, nonDeleted } from '../../../common/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../common/result/index.js';
import { userHealthContextInclude } from '../types/health-context.types.js';

/**
 * Abstract port for user-health-context data access.
 *
 * Centralises all Prisma queries for user health context (profile, allergies,
 * conditions, current medicines) behind a single interface so that the write
 * services and ownership service don't depend on `PrismaService` directly.
 *
 * Write methods return `ResultAsync<T, DomainFailure>`: known Prisma request
 * errors (P2002 -> RESOURCE_CONFLICT, P2025 -> RESOURCE_NOT_FOUND) are mapped
 * to domain failures while unknown database/connection errors are re-thrown
 * and reach the global exception filter unchanged. Reads stay
 * `Promise<T | null>` — a missing row is a legitimate value; the application
 * service decides when absence is a failure.
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
  ): ResultAsync<void, DomainFailure>;

  // ── Allergy ─────────────────────────────────────────────────────────────

  abstract createAllergy(
    data: Prisma.UserAllergyUncheckedCreateInput,
  ): ResultAsync<void, DomainFailure>;
  abstract updateAllergy(
    id: string,
    data: Prisma.UserAllergyUpdateInput,
  ): ResultAsync<void, DomainFailure>;
  abstract softDeleteAllergy(id: string): ResultAsync<void, DomainFailure>;

  /**
   * Looks up an allergy by id regardless of owner so the ownership service
   * can distinguish "missing" (RESOURCE_NOT_FOUND) from "owned by another
   * user" (FORBIDDEN). The caller must never return the row to the client.
   */
  abstract findAllergyById(id: string): Promise<{ userId: string } | null>;

  // ── Condition ───────────────────────────────────────────────────────────

  abstract createCondition(
    data: Prisma.UserConditionCreateInput,
  ): ResultAsync<void, DomainFailure>;
  abstract updateCondition(
    id: string,
    data: Prisma.UserConditionUpdateInput,
  ): ResultAsync<void, DomainFailure>;
  abstract softDeleteCondition(
    id: string,
    resolvedAt: Date,
  ): ResultAsync<void, DomainFailure>;

  /**
   * Looks up a condition by id regardless of owner so the ownership service
   * can distinguish "missing" (RESOURCE_NOT_FOUND) from "owned by another
   * user" (FORBIDDEN). The caller must never return the row to the client.
   */
  abstract findConditionById(id: string): Promise<{ userId: string } | null>;

  // ── Current Medicine ────────────────────────────────────────────────────

  abstract createCurrentMedicine(
    data: Prisma.UserCurrentMedicineUncheckedCreateInput,
  ): ResultAsync<void, DomainFailure>;
  abstract updateCurrentMedicine(
    id: string,
    data: Prisma.UserCurrentMedicineUpdateInput,
  ): ResultAsync<void, DomainFailure>;
  abstract softDeleteCurrentMedicine(
    id: string,
    endedAt: Date,
  ): ResultAsync<void, DomainFailure>;

  /**
   * Looks up a current medicine by id regardless of owner so the ownership
   * service can distinguish "missing" (RESOURCE_NOT_FOUND) from "owned by
   * another user" (FORBIDDEN). The caller must never return the row to the
   * client.
   */
  abstract findCurrentMedicineById(
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

  override upsertProfile(
    where: { userId: string },
    create: Prisma.UserProfileUncheckedCreateInput,
    update: Prisma.UserProfileUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userProfile.upsert({ where, create, update }),
    ).map(() => undefined);
  }

  override createAllergy(
    data: Prisma.UserAllergyUncheckedCreateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(this.prisma.userAllergy.create({ data })).map(
      () => undefined,
    );
  }

  override updateAllergy(
    id: string,
    data: Prisma.UserAllergyUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userAllergy.update({ where: { id }, data }),
    ).map(() => undefined);
  }

  override softDeleteAllergy(id: string): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userAllergy.update({
        where: { id },
        data: { isActive: false },
      }),
    ).map(() => undefined);
  }

  override findAllergyById(id: string) {
    return this.prisma.userAllergy.findFirst({
      where: { id },
      select: { userId: true },
    });
  }

  override createCondition(
    data: Prisma.UserConditionCreateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(this.prisma.userCondition.create({ data })).map(
      () => undefined,
    );
  }

  override updateCondition(
    id: string,
    data: Prisma.UserConditionUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCondition.update({ where: { id }, data }),
    ).map(() => undefined);
  }

  override softDeleteCondition(
    id: string,
    resolvedAt: Date,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCondition.update({
        where: { id },
        data: { status: 'resolved', resolvedAt },
      }),
    ).map(() => undefined);
  }

  override findConditionById(id: string) {
    return this.prisma.userCondition.findFirst({
      where: { id },
      select: { userId: true },
    });
  }

  override createCurrentMedicine(
    data: Prisma.UserCurrentMedicineUncheckedCreateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCurrentMedicine.create({ data }),
    ).map(() => undefined);
  }

  override updateCurrentMedicine(
    id: string,
    data: Prisma.UserCurrentMedicineUpdateInput,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.userCurrentMedicine.update({ where: { id }, data }),
    ).map(() => undefined);
  }

  override softDeleteCurrentMedicine(
    id: string,
    endedAt: Date,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      (async () => {
        const current = await this.prisma.userCurrentMedicine.findUnique({
          where: { id },
          select: { endedAt: true },
        });
        return this.prisma.userCurrentMedicine.update({
          where: { id },
          data: { isCurrent: false, endedAt: current?.endedAt ?? endedAt },
        });
      })(),
    ).map(() => undefined);
  }

  override findCurrentMedicineById(id: string) {
    return this.prisma.userCurrentMedicine.findFirst({
      where: { id },
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
