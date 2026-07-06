import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_ROOT_PATH } from './constants/constants';
import { buildPrismaClientModule } from './services/prisma-module.service';
import { buildResources } from './services/resource-builder.service';
import { registerAdminStaticAssets } from './services/static-asset.service';
import { buildAdminAuthRouter } from './services/auth-router.service';
import type {
  AdminJsExpressModule,
  AdminJsModule,
  AdminJsPrismaModule,
  DynamicImport,
} from './types/types';

/**
 * AdminJS packages are ESM-only and must be imported dynamically.
 * SWC compiles standard `import()` to `require()` in this CJS build, which
 * breaks ESM interop. Using `new Function` bypasses SWC's transform so the
 * runtime `import()` is preserved as-is. This is safe because the specifiers
 * are hardcoded string literals ('adminjs', '@adminjs/express',
 * '@sergiyiva/adminjs-prisma') and never come from user input.
 */
const dynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as DynamicImport;

/**
 * Registers the AdminJS panel, authenticated router, and static assets on the
 * given NestJS application.
 */
export async function registerAdminPanel(
  app: INestApplication,
  configService: ConfigService,
): Promise<void> {
  const [adminJsModule, adminExpressModule, adminPrismaModule] =
    await Promise.all([
      dynamicImport<AdminJsModule>('adminjs'),
      dynamicImport<AdminJsExpressModule>('@adminjs/express'),
      dynamicImport<AdminJsPrismaModule>('@sergiyiva/adminjs-prisma'),
    ]);

  const AdminJS = adminJsModule.default;
  const { buildAuthenticatedRouter } = adminExpressModule;
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

  const router = buildAdminAuthRouter(
    admin,
    configService,
    buildAuthenticatedRouter,
  );

  registerAdminStaticAssets(
    app,
    admin.options.rootPath,
    adminJsModule.Router.assets,
  );
  app.use(admin.options.rootPath, router);
}
