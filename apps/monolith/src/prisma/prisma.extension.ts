/**
 * Prisma client extension providing soft-delete-aware query variants.
 *
 * Models with a `deletedAt` column (User, userRecord,
 * UserReminder, UserDoseLog) gain a `nonDeleted` namespace
 * on their delegate.  Every method in that namespace automatically injects
 * `deletedAt: null` into the `where` clause, so callers no longer need to
 * remember the manual `{ deletedAt: null }` spread.
 *
 * Usage (on an extended client):
 * ```ts
 * // Instead of:
 * prisma.user.findMany({ where: { ..., deletedAt: null } })
 * // Use:
 * prisma.user.nonDeleted.findMany({ where: { ... } })
 * ```
 *
 * The extension is defined via `Prisma.defineExtension` so that the
 * TypeScript type of `$extends(...)` correctly includes the new
 * `nonDeleted` properties.
 */
import { Prisma, type PrismaClient } from '#generated/prisma/client.js';

// ──────────────────────────────────────────────────────────────────────────
//  Internal helper
// ──────────────────────────────────────────────────────────────────────────

/**
 * Merges `deletedAt: null` into a (possibly undefined) `where` clause.
 *
 * The cast to `Record<string, unknown>` is safe because every Prisma
 * `WhereInput` type is a plain object that accepts `deletedAt` as an
 * optional field.  The return type is cast back so callers get full type
 * inference for the model-specific `WhereInput`.
 */
function withNonDeletedFilter<W>(where: W | undefined): W {
  return { ...(where ?? {}), deletedAt: null } as W;
}

// ──────────────────────────────────────────────────────────────────────────
//  Extension definition
// ──────────────────────────────────────────────────────────────────────────

export const softDeleteExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    model: {
      user: {
        nonDeleted: {
          findMany: (args?: Prisma.UserFindManyArgs) =>
            client.user.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserFindFirstArgs) =>
            client.user.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (args?: Prisma.UserFindFirstOrThrowArgs) =>
            client.user.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserFindUniqueArgs) =>
            client.user.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (args: Prisma.UserFindUniqueOrThrowArgs) =>
            client.user.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserCountArgs) =>
            client.user.count({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
        },
      },
      userRecord: {
        nonDeleted: {
          findMany: (args?: Prisma.UserRecordFindManyArgs) =>
            client.userRecord.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserRecordFindFirstArgs) =>
            client.userRecord.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (
            args?: Prisma.UserRecordFindFirstOrThrowArgs,
          ) =>
            client.userRecord.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserRecordFindUniqueArgs) =>
            client.userRecord.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (
            args: Prisma.UserRecordFindUniqueOrThrowArgs,
          ) =>
            client.userRecord.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserRecordCountArgs) =>
            client.userRecord.count({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
        },
      },
      userReminder: {
        nonDeleted: {
          findMany: (args?: Prisma.UserReminderFindManyArgs) =>
            client.userReminder.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserReminderFindFirstArgs) =>
            client.userReminder.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (
            args?: Prisma.UserReminderFindFirstOrThrowArgs,
          ) =>
            client.userReminder.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserReminderFindUniqueArgs) =>
            client.userReminder.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (
            args: Prisma.UserReminderFindUniqueOrThrowArgs,
          ) =>
            client.userReminder.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserReminderCountArgs) =>
            client.userReminder.count({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
        },
      },
      userDoseLog: {
        nonDeleted: {
          findMany: (args?: Prisma.UserDoseLogFindManyArgs) =>
            client.userDoseLog.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserDoseLogFindFirstArgs) =>
            client.userDoseLog.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (
            args?: Prisma.UserDoseLogFindFirstOrThrowArgs,
          ) =>
            client.userDoseLog.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserDoseLogFindUniqueArgs) =>
            client.userDoseLog.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (
            args: Prisma.UserDoseLogFindUniqueOrThrowArgs,
          ) =>
            client.userDoseLog.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserDoseLogCountArgs) =>
            client.userDoseLog.count({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
        },
      },
    },
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Convenience function & type export
// ──────────────────────────────────────────────────────────────────────────

/**
 * Applies the soft-delete extension to a `PrismaClient` instance and returns
 * the extended client.  The return type is used by `PrismaService` to type
 * its internal `_extended` field.
 */
export function applySoftDeleteExtension(client: PrismaClient) {
  return client.$extends(softDeleteExtension);
}

/**
 * The type of a `PrismaClient` after the soft-delete extension is applied.
 * Includes all original model delegates plus the `nonDeleted` namespace on
 * the four soft-delete models.
 */
export type ExtendedPrismaClient = ReturnType<typeof applySoftDeleteExtension>;
