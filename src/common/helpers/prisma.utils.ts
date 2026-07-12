/**
 * Shared Prisma query helpers.
 */

/** Soft-delete filter: excludes records with non-null deletedAt. */
export const nonDeleted = { deletedAt: null } as const;
