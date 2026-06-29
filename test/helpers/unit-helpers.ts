import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Create a minimal PrismaService mock with no pre-defined methods.
 * Use jest.spyOn() on individual models afterwards for fine-grained control.
 *
 * Usage:
 *   const prisma = createPrismaServiceMock();
 *   jest.spyOn(prisma.user, 'findFirst').mockResolvedValue(...);
 */
export function createPrismaServiceMock(): jest.Mocked<PrismaService> {
  return {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $on: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    userIdentity: {
      delete: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    userSession: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    userProfile: { upsert: jest.fn(), findUnique: jest.fn() },
    userSetting: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    userAllergy: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userCondition: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userCurrentMedicine: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userDailyRecord: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    userDailyRecordAttachment: { createMany: jest.fn(), deleteMany: jest.fn() },
    userMedicineReminder: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    userMedicineDoseLog: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userReminderDelivery: { create: jest.fn() },
    userDevice: { upsert: jest.fn() },
    userNotification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    dataExportRequest: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    assistantConversation: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    assistantMessage: { create: jest.fn(), findMany: jest.fn() },
    assistantSummaryHistory: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    drugSourceImport: { findFirst: jest.fn(), create: jest.fn() },
    cnMedicineProduct: { findMany: jest.fn(), count: jest.fn() },
    cnMedicineLeaflet: { findUnique: jest.fn() },
    cnMedicineProductLeafletLink: { findMany: jest.fn() },
    medicineLeafletChunk: { findMany: jest.fn() },
    drugbankDrug: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    drugbankExternalLink: { findMany: jest.fn() },
    drugbankTarget: { findMany: jest.fn() },
    drugbankDrugTarget: { findMany: jest.fn() },
    medicineSafetyTip: { findMany: jest.fn() },
  } as unknown as jest.Mocked<PrismaService>;
}

/**
 * Configure the PrismaService mock so that `$transaction(cb)` simply
 * invokes the callback with the same mock instance. This mirrors the
 * pattern used in daily-records.service.spec.ts and testing-support.service.spec.ts.
 *
 * Usage:
 *   const prisma = createPrismaServiceMock();
 *   mockTransaction(prisma);
 */
export function mockTransaction(prisma: jest.Mocked<PrismaService>): void {
  const runner = async <T>(
    callback: (tx: jest.Mocked<PrismaService>) => Promise<T>,
  ): Promise<T> => callback(prisma);
  (prisma.$transaction as jest.Mock).mockImplementation(runner);
}
