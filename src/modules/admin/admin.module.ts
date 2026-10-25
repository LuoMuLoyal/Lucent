import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuditLogModule } from '../audit-log/audit-log.module.js';
import { AuthModule } from './../auth/auth.module.js';
import { UserModule } from '../user/user.module.js';
import { LegalDocumentsModule } from '../legal-documents/legal-documents.module.js';
import { MedicinesModule } from './../medicines/medicines.module.js';
import { AssistantContentModule } from './../assistant/assistant-content.module.js';
import { AdminController } from './admin.controller.js';
import { AdminDataController } from './data.controller.js';
import { AdminAccessService } from './infrastructure/persistence/access.service.js';
import { AdminAdminsService } from './infrastructure/persistence/admins.service.js';
import { AdminConsoleService } from './infrastructure/console/console.service.js';
import { AdminDataService } from './infrastructure/persistence/data.service.js';
import { AdminSharesService } from './infrastructure/persistence/shares.service.js';
import { AdminUserRelatedService } from './infrastructure/persistence/user-related.service.js';
import { QueuePanelAuthService } from './infrastructure/console/queue-panel-auth.service.js';
import { QueuePanelService } from './infrastructure/console/queue-panel.service.js';
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
    AssistantContentModule,
  ],
  controllers: [AdminController, AdminDataController],
  providers: [
    AdminAccessService,
    AdminAdminsService,
    AdminConsoleService,
    AdminDataService,
    AdminSharesService,
    AdminUserRelatedService,
    QueuePanelAuthService,
    QueuePanelService,
    AdminGuard,
    AdminPermissionGuard,
  ],
  exports: [AdminAccessService, AdminGuard, AdminPermissionGuard],
})
export class AdminModule {}
