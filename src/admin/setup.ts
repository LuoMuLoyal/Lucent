import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/index.js';
import { ADMIN_ROOT_PATH } from './constants/admin.constants.js';
import { buildPrismaClientModule } from './services/prisma-module.service.js';
import { buildResources } from './services/resource-builder.service.js';
import { buildAdminAuthRouter } from './services/auth-router.service.js';
import type {
  AdminJsFastifyModule,
  AdminJsModule,
  AdminJsPrismaModule,
} from './types/admin.types.js';

/**
 * AdminJS packages are ESM-only and must be imported dynamically. In the ESM
 * build SWC preserves `import()` as-is, so a plain wrapper is sufficient —
 * the previous `new Function('specifier', 'return import(specifier)')`
 * indirection only existed to survive the old CommonJS build.
 */
const dynamicImport = async <T>(specifier: string): Promise<T> =>
  import(specifier) as Promise<T>;

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
