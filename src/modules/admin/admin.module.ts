import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AdminController } from './controllers/admin.controller.js';
import { AdminAccessService } from './services/access.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AdminPermissionGuard } from './guards/admin-permission.guard.js';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [AdminAccessService, AdminGuard, AdminPermissionGuard],
  exports: [AdminAccessService, AdminGuard, AdminPermissionGuard],
})
export class AdminModule {}
