import type { ConfigService } from '@nestjs/config';
import type { Router } from 'express';
import type AdminJSDefault from 'adminjs';

import {
  ADMIN_COOKIE_SECRET_KEY,
  ADMIN_EMAIL_KEY,
  ADMIN_PASSWORD_KEY,
  NODE_ENV_KEY,
} from '../constants/constants';
import type { AdminJsExpressModule, AdminUser } from '../types/types';

/**
 * Builds an authenticated Express router for the AdminJS panel using
 * credentials and cookie configuration from the application config service.
 */
export function buildAdminAuthRouter(
  admin: AdminJSDefault,
  configService: ConfigService,
  buildAuthenticatedRouter: AdminJsExpressModule['buildAuthenticatedRouter'],
): Router {
  const adminEmail = configService.getOrThrow<string>(ADMIN_EMAIL_KEY);
  const adminPassword = configService.getOrThrow<string>(ADMIN_PASSWORD_KEY);
  const cookieSecret = configService.getOrThrow<string>(
    ADMIN_COOKIE_SECRET_KEY,
  );
  const isProduction = configService.get<string>(NODE_ENV_KEY) === 'production';

  return buildAuthenticatedRouter(
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
}
