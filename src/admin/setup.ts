import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROOT_PATH } from './constants/constants';
import { buildPrismaClientModule } from './services/prisma-module.service';
import { buildResources } from './services/resource-builder.service';
import { buildAdminAuthRouter } from './services/auth-router.service';
import type {
  AdminJsFastifyModule,
  AdminJsModule,
  AdminJsPrismaModule,
  DynamicImport,
} from './types/types';

/**
 * AdminJS packages are ESM-only and must be imported dynamically.
 * SWC compiles standard `import()` to `require()` in this CJS build, which
 * breaks ESM interop. Using `new Function` bypasses SWC's transform so the
 * runtime `import()` is preserved as-is. This is safe because the specifiers
 * are hardcoded string literals ('adminjs', '@adminjs/fastify',
 * '@sergiyiva/adminjs-prisma') and never come from user input.
 */
const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as DynamicImport;

/**
 * Registers the AdminJS panel and authenticated router on the given NestJS
 * Fastify application. Static assets and routes are handled internally by
 * @adminjs/fastify's buildAuthenticatedRouter → buildRouter.
 */
export async function registerAdminPanel(
  app: NestFastifyApplication,
  configService: ConfigService,
): Promise<void> {
  const [adminJsModule, adminFastifyModule, adminPrismaModule] =
    await Promise.all([
      dynamicImport<AdminJsModule>('adminjs'),
      dynamicImport<AdminJsFastifyModule>('@adminjs/fastify'),
      dynamicImport<AdminJsPrismaModule>('@sergiyiva/adminjs-prisma'),
    ]);

  const AdminJS = adminJsModule.default;
  const { buildAuthenticatedRouter } = adminFastifyModule;
  const { Database, Resource, getModelByName } = adminPrismaModule;

  AdminJS.registerAdapter({ Database, Resource });

  const prisma = app.get(PrismaService);
  const clientModule = await buildPrismaClientModule();
  const resources = buildResources(getModelByName, prisma, clientModule);
  const admin = new AdminJS({
    rootPath: ADMIN_ROOT_PATH,
    branding: {
      companyName: 'Lucent Admin',
      withMadeWithLove: false,
    },
    resources,
  });

  const fastifyInstance = app.getHttpAdapter().getInstance();
  await buildAdminAuthRouter(
    admin,
    configService,
    buildAuthenticatedRouter,
    fastifyInstance,
  );
}
