/**
 * Prisma client extension providing soft-delete-aware query variants.
 *
 * Models with a `deletedAt` column (User, UserDailyRecord,
 * UserMedicineReminder, UserMedicineDoseLog) gain a `nonDeleted` namespace
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
      userDailyRecord: {
        nonDeleted: {
          findMany: (args?: Prisma.UserDailyRecordFindManyArgs) =>
            client.userDailyRecord.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserDailyRecordFindFirstArgs) =>
            client.userDailyRecord.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (
            args?: Prisma.UserDailyRecordFindFirstOrThrowArgs,
          ) =>
            client.userDailyRecord.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserDailyRecordFindUniqueArgs) =>
            client.userDailyRecord.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (
            args: Prisma.UserDailyRecordFindUniqueOrThrowArgs,
          ) =>
            client.userDailyRecord.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserDailyRecordCountArgs) =>
            client.userDailyRecord.count({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
        },
      },
      userMedicineReminder: {
        nonDeleted: {
          findMany: (args?: Prisma.UserMedicineReminderFindManyArgs) =>
            client.userMedicineReminder.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserMedicineReminderFindFirstArgs) =>
            client.userMedicineReminder.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (
            args?: Prisma.UserMedicineReminderFindFirstOrThrowArgs,
          ) =>
            client.userMedicineReminder.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserMedicineReminderFindUniqueArgs) =>
            client.userMedicineReminder.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (
            args: Prisma.UserMedicineReminderFindUniqueOrThrowArgs,
          ) =>
            client.userMedicineReminder.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserMedicineReminderCountArgs) =>
            client.userMedicineReminder.count({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
        },
      },
      userMedicineDoseLog: {
        nonDeleted: {
          findMany: (args?: Prisma.UserMedicineDoseLogFindManyArgs) =>
            client.userMedicineDoseLog.findMany({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirst: (args?: Prisma.UserMedicineDoseLogFindFirstArgs) =>
            client.userMedicineDoseLog.findFirst({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findFirstOrThrow: (
            args?: Prisma.UserMedicineDoseLogFindFirstOrThrowArgs,
          ) =>
            client.userMedicineDoseLog.findFirstOrThrow({
              ...args,
              where: withNonDeletedFilter(args?.where),
            }),
          findUnique: (args: Prisma.UserMedicineDoseLogFindUniqueArgs) =>
            client.userMedicineDoseLog.findUnique({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          findUniqueOrThrow: (
            args: Prisma.UserMedicineDoseLogFindUniqueOrThrowArgs,
          ) =>
            client.userMedicineDoseLog.findUniqueOrThrow({
              ...args,
              where: {
                ...args.where,
                deletedAt: null,
              },
            }),
          count: (args?: Prisma.UserMedicineDoseLogCountArgs) =>
            client.userMedicineDoseLog.count({
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
