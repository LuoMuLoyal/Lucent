import type { INestApplication } from '@nestjs/common';
import type { Express } from 'express';
import AdminJS from 'adminjs';
import { buildRouter } from '@adminjs/express';
import session from 'express-session';
import type { PrismaService } from '../prisma/prisma.service';

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

function buildResources(prisma: PrismaService) {
  return ADMIN_MODELS.map((modelKey) => ({
    resource: (prisma as unknown as Record<string, unknown>)[modelKey],
    options: {
      navigation: {
        icon: 'Database',
        name: 'Database',
      },
    },
  }));
}

function buildAdminJs(prisma: PrismaService) {
  const admin = new AdminJS({
    resources: buildResources(prisma),
    rootPath: '/admin',
    branding: {
      companyName: 'Lucent Admin',
      logo: false,
    },
    settings: {
      defaultPerPage: 20,
    },
  });

  const router = buildRouter(admin);

  const sessionMiddleware = session({
    resave: false,
    saveUninitialized: true,
    secret: process.env['ADMIN_SESSION_SECRET'] ?? 'change-me-in-production',
  });

  return { admin, router, sessionMiddleware };
}

/**
 * Mount AdminJS directly on the underlying Express app.
 * Bypasses NestJS middleware to avoid global prefix (/api) interference.
 */
export function mountAdminPanel(
  app: INestApplication,
  prisma: PrismaService,
): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const expressApp: Express = app.getHttpAdapter().getInstance();
  const { router, sessionMiddleware } = buildAdminJs(prisma);

  expressApp.use('/admin', sessionMiddleware, router);
}
