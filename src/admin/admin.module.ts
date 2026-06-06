import { Module } from '@nestjs/common';
import {
  AdminModule,
  ADMIN_ADAPTER,
  PrismaAdminAdapter,
} from 'nestjs-dj-admin';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import {
  UserAdmin,
  UserProfileAdmin,
  DrugbankDrugAdmin,
  CnMedicineProductAdmin,
  UserDailyRecordAdmin,
  UserMedicineDoseLogAdmin,
} from './admin.resources';

const RESOURCES = [
  UserAdmin,
  UserProfileAdmin,
  DrugbankDrugAdmin,
  CnMedicineProductAdmin,
  UserDailyRecordAdmin,
  UserMedicineDoseLogAdmin,
];

@Module({
  imports: [
    PrismaModule,
    AdminModule.forRoot({
      path: '/admin',
      branding: {
        siteHeader: 'Lucent Admin',
        siteTitle: 'Lucent Admin',
        indexTitle: 'Lucent 后台管理',
      },
      auth: {
        // eslint-disable-next-line @typescript-eslint/require-await
        authenticate: async ({ email, password }) => {
          const adminEmail = process.env['ADMIN_EMAIL'] ?? 'admin@lucent.local';
          const adminPassword = process.env['ADMIN_PASSWORD'] ?? 'admin123';

          if (email === adminEmail && password === adminPassword) {
            return {
              id: 'admin',
              permissions: [],
              email: adminEmail,
              isSuperuser: true,
            };
          }
          return null;
        },
      },
    }),
  ],
  providers: [
    ...RESOURCES,
    {
      provide: ADMIN_ADAPTER,
      useFactory: (prisma: PrismaService) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new PrismaAdminAdapter(prisma as any),
      inject: [PrismaService],
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class AdminPanelModule {}
