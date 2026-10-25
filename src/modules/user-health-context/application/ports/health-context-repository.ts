/**
 * Repository port for the User Profile context's stored records.
 *
 * Exposes the read/write shapes the use cases need without leaking
 * `PrismaService` into them. Prisma *types* are named here because the port
 * describes storage; the Prisma *client* is never imported (D5).
 */

import { type Prisma } from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { type userHealthContextInclude } from '../../domain/health-context/health-context.types.js';

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
