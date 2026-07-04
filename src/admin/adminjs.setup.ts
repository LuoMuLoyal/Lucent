import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_COOKIE_SECRET_KEY,
  ADMIN_EMAIL_KEY,
  ADMIN_PASSWORD_KEY,
  ADMIN_ROOT_PATH,
  NODE_ENV_KEY,
} from './constants/adminjs.constants';
import { buildPrismaClientModule } from './services/admin-prisma-module.service';
import { buildResources } from './services/admin-resource-builder.service';
import { registerAdminStaticAssets } from './services/admin-static-asset.service';
import type {
  AdminJsExpressModule,
  AdminJsModule,
  AdminJsPrismaModule,
  AdminUser,
  DynamicImport,
} from './types/adminjs.types';

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

  const adminEmail = configService.getOrThrow<string>(ADMIN_EMAIL_KEY);
  const adminPassword = configService.getOrThrow<string>(ADMIN_PASSWORD_KEY);
  const cookieSecret = configService.getOrThrow<string>(
    ADMIN_COOKIE_SECRET_KEY,
  );
  const isProduction = configService.get<string>(NODE_ENV_KEY) === 'production';

  const router = buildAuthenticatedRouter(
    admin,
    {
      cookieName: 'lucent-admin',
      cookiePassword: cookieSecret,
      authenticate: (email, password): AdminUser | null =>
        email === adminEmail && password === adminPassword
          ? { email: adminEmail }
          : null,
    },
    null,
    {
      resave: false,
      saveUninitialized: false,
      secret: cookieSecret,
      name: 'lucent-admin',
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },
  );

  registerAdminStaticAssets(
    app,
    admin.options.rootPath,
    adminJsModule.Router.assets,
  );
  app.use(admin.options.rootPath, router);
}
