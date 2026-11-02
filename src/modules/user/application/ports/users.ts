/**
 * Outbound port for the `User` aggregate (ADR-0024 \`application/ports\`).
 *
 * The `user` module is the **single writer** for the \`User\` table (ADR-0009):
 * auth registers users through it, account edits them through it, and the admin
 * console changes status through it. Making that write surface an explicit port
 * is what lets those three callers depend on "user writes" instead of on this
 * module's implementation classes.
 *
 * ## Why the row type is the Prisma model
 *
 * Unlike a rich aggregate, \`User\` here is a **supporting-context record**: it has
 * no invariants of its own (status transitions are validated by the callers/
 * admin surface, uniqueness is enforced by the database). ADR-0024 §4 allows a
 * supporting context to keep a thin aggregate — inventing a parallel \`User\`
 * entity would mean translating every auth/account/admin consumer for no rule
 * gain. The port therefore names the persistence row honestly and keeps the
 * layering benefit (one interface, swappable implementation) that matters.
 *
 * The \`Prisma\` input/where types below are type-only imports: \`application/\`
 * may name types from anywhere, only runtime edges are forbidden.
 */

import type { Prisma, User, UserStatus } from '#generated/prisma/client.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';

/** DI token — string so a Nest resolution error names the port readably. */
export const USER_REPOSITORY = 'USER_REPOSITORY';

/** A user row as the write side reads it (soft-deleted rows excluded). */
export type UserRecord = User;

/** Fields the admin surface reads before/after a status change. */
export interface UserStatusSnapshot {
  status: UserStatus;
}

export interface UserRepositoryPort {
  /** Loads a non-deleted user by id, or \`null\`. */
  findById(id: string): Promise<UserRecord | null>;

  /** Loads a non-deleted user by email, or \`null\`. */
  findByEmail(email: string): Promise<UserRecord | null>;

  /**
   * Creates a user, mapping P2002 unique-constraint violations to
   * \`RESOURCE_CONFLICT\` so concurrent same-email registrations receive a domain
   * failure instead of an unhandled 500.
   */
  create(data: Prisma.UserCreateInput): ResultAsync<UserRecord, DomainFailure>;

  update(
    id: string,
    data: Prisma.UserUpdateInput,
  ): ResultAsync<UserRecord, DomainFailure>;

  /** Updates by email; \`null\` when no such user exists. */
  updateByEmail(
    email: string,
    data: Prisma.UserUpdateInput,
  ): Promise<UserRecord | null>;

  /** The status of a non-deleted user, or \`null\` when it does not exist. */
  findStatus(userId: string): Promise<UserStatusSnapshot | null>;

  /** Sets \`status\` (audit is the caller's job — the port only writes). */
  setStatus(userId: string, status: UserStatus): Promise<UserStatusSnapshot>;

  /** Soft-deletes: \`status = deleted\` plus \`deletedAt\`. */
  softDelete(userId: string, at: Date): Promise<void>;
}
