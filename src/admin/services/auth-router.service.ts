import type { ConfigService } from '@nestjs/config';
import type { FastifyInstance } from 'fastify';
import type AdminJSDefault from 'adminjs';

import { safeCompare } from '../../common';
import {
  ADMIN_COOKIE_SECRET_KEY,
  ADMIN_EMAIL_KEY,
  ADMIN_PASSWORD_KEY,
  NODE_ENV_KEY,
} from '../constants';
import type { AdminJsFastifyModule, AdminUser } from '../types';

/**
 * Registers an authenticated Fastify router for the AdminJS panel using
 * credentials and cookie configuration from the application config service.
 */
export async function buildAdminAuthRouter(
  admin: AdminJSDefault,
  configService: ConfigService,
  buildAuthenticatedRouter: AdminJsFastifyModule['buildAuthenticatedRouter'],
  fastifyInstance: FastifyInstance,
): Promise<void> {
  const adminEmail = configService.getOrThrow<string>(ADMIN_EMAIL_KEY);
  const adminPassword = configService.getOrThrow<string>(ADMIN_PASSWORD_KEY);
  const cookieSecret = configService.getOrThrow<string>(
    ADMIN_COOKIE_SECRET_KEY,
  );
  const isProduction = configService.get<string>(NODE_ENV_KEY) === 'production';

  await buildAuthenticatedRouter(
    admin,
    {
      cookieName: 'lucent-admin',
      cookiePassword: cookieSecret,
      authenticate: (email, password): AdminUser | null =>
        safeCompare(email, adminEmail) && safeCompare(password, adminPassword)
          ? { email: adminEmail }
          : null,
    },
    fastifyInstance,
    {
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
      },
    },
  );
}
