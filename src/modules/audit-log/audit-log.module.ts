import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { AuditLogService } from './services/audit-log.service';

/**
 * Global audit logging module.
 *
 * Exports `AuditLogService` so that any feature module can inject it
 * to record security-sensitive operations (password changes, identity
 * binding, data exports, admin writes, …).
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
