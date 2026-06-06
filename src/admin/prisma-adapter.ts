import AdminJS from 'adminjs';
import { Database, Resource } from '@adminjs/prisma';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Register AdminJS adapter with Prisma.
 * Must be called once before creating admin resources.
 */
export function registerPrismaAdapter() {
  AdminJS.registerAdapter({
    Database,
    Resource,
  });
}

/**
 * All Prisma models available in the admin panel.
 */
const ADMIN_MODELS = [
  'user',
  'userProfile',
  'userIdentity',
  'userSession',
  'userDevice',
  'userAllergy',
  'userCondition',
  'userCurrentMedicine',
  'userMedicineDoseLog',
  'userDailyRecord',
  'drugSourceImport',
  'cnMedicineProduct',
  'drugbankDrug',
  'drugbankExternalLink',
  'drugbankTarget',
  'drugbankDrugTarget',
] as const;

/**
 * Build AdminJS resources from Prisma models.
 */
export function buildAdminResources(prisma: PrismaService) {
  return ADMIN_MODELS.map((modelKey) => ({
    resource: {
      model: (prisma as unknown as Record<string, unknown>)[modelKey],
      client: prisma,
    },
    options: {
      navigation: {
        icon: 'Database',
        name: 'Database',
      },
    },
  }));
}
