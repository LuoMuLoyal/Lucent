import type { PrismaService } from '../../src/prisma/index.js';
export type { DeepMocked } from '../../src/common/types/deep-mocked.js';
import type { DeepMocked } from '../../src/common/types/deep-mocked.js';

/**
 * Create a minimal PrismaService mock with no pre-defined methods.
 * Use vi.spyOn() on individual models afterwards for fine-grained control.
 *
 * Usage:
 *   const prisma = createPrismaServiceMock();
 *   vi.spyOn(prisma.user, 'findFirst').mockResolvedValue(...);
 */
export function createPrismaServiceMock(): DeepMocked<PrismaService> {
  return {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $on: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    userSession: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    userProfile: { upsert: vi.fn(), findUnique: vi.fn() },
    userSetting: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    userAllergy: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userCondition: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userCurrentMedicine: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userDailyRecord: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    userDailyRecordAttachment: { createMany: vi.fn(), deleteMany: vi.fn() },
    userMedicineReminder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userMedicineDoseLog: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    userReminderDelivery: { create: vi.fn() },
    userNotification: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    dataExportRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    assistantConversation: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    assistantMessage: { create: vi.fn(), findMany: vi.fn() },
    assistantSummaryHistory: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    drugSourceImport: { findFirst: vi.fn(), create: vi.fn() },
    cnMedicineProduct: { findMany: vi.fn(), count: vi.fn() },
    cnMedicineLeaflet: { findUnique: vi.fn() },
    cnMedicineProductLeafletLink: { findMany: vi.fn() },
    medicineLeafletChunk: { findMany: vi.fn() },
    drugbankDrug: {
      findMany: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    drugbankExternalLink: { findMany: vi.fn() },
    drugbankTarget: { findMany: vi.fn() },
    drugbankDrugTarget: { findMany: vi.fn() },
    medicineSafetyTip: { findMany: vi.fn() },
  } as unknown as DeepMocked<PrismaService>;
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
export function mockTransaction(prisma: DeepMocked<PrismaService>): void {
  const runner = async <T>(
    callback: (tx: DeepMocked<PrismaService>) => Promise<T>,
  ): Promise<T> => callback(prisma);
  prisma.$transaction.mockImplementation(runner);
}
