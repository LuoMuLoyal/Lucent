import { Module } from '@nestjs/common';
import { AdminModule as AdminJSModule } from '@adminjs/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { registerPrismaAdapter, buildAdminResources } from './prisma-adapter';

@Module({
  imports: [
    AdminJSModule.createAdminAsync({
      useFactory: (prisma: PrismaService) => {
        registerPrismaAdapter();

        return {
          adminJsOptions: {
            resources: buildAdminResources(prisma),
            rootPath: '/admin',
            branding: {
              companyName: 'Lucent Admin',
              logo: false,
            },
            settings: {
              defaultPerPage: 20,
            },
          },
          auth: {
            authenticate: (email: string, password: string) => {
              const adminEmail =
                process.env['ADMIN_EMAIL'] ?? 'admin@lucent.local';
              const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'admin123';

              if (email === adminEmail && password === adminPassword) {
                return { email, role: 'admin' };
              }
              return null;
            },
            cookieName: 'adminjs',
            cookiePassword:
              process.env['ADMIN_COOKIE_SECRET'] ?? 'change-me-in-production',
          },
          sessionOptions: {
            resave: false,
            saveUninitialized: true,
            secret:
              process.env['ADMIN_SESSION_SECRET'] ?? 'change-me-in-production',
          },
        };
      },
      inject: [PrismaService],
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AdminPanelModule {}
