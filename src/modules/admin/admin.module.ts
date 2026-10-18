import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { UserModule } from '../user/user.module.js';
import { LegalDocumentsModule } from '../legal-documents/legal-documents.module.js';
import { MedicinesModule } from '../medicines/medicines.module.js';
import { AdminController } from './controllers/admin.controller.js';
import { AdminAccessService } from './services/access.service.js';
import { AdminAdminsService } from './services/admins.service.js';
import { AdminConsoleService } from './services/console.service.js';
import { AdminSharesService } from './services/shares.service.js';
import { QueuePanelAuthService } from './services/queue-panel-auth.service.js';
import { QueuePanelService } from './services/queue-panel.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AdminPermissionGuard } from './guards/admin-permission.guard.js';

@Module({
  imports: [
    PrismaModule,
    AuditLogModule,
    AuthModule,
    UserModule,
    LegalDocumentsModule,
    MedicinesModule,
  ],
  controllers: [AdminController],
  providers: [
    AdminAccessService,
    AdminAdminsService,
    AdminConsoleService,
    AdminSharesService,
    QueuePanelAuthService,
    QueuePanelService,
    AdminGuard,
    AdminPermissionGuard,
  ],
  exports: [AdminAccessService, AdminGuard, AdminPermissionGuard],
})
export class AdminModule {}
