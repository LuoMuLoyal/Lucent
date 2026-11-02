import { Module } from '@nestjs/common';
import { UserService } from './application/use_cases/user.js';
import { UserAdminService } from './application/use_cases/admin.js';
import { USER_REPOSITORY } from './application/ports/users.js';
import { PrismaUsers } from './infrastructure/persistence/users.js';

/**
 * Owner module for the `User` table (ADR-0009): a pure internal service module —
 * no controller, because the user-facing endpoints live in the auth controllers
 * and `AccountController`.
 *
 * The write surface is a port (`USER_REPOSITORY`), implemented by
 * `PrismaUsers`; `PrismaModule` is `@Global()`, so no `imports` are needed.
 * `UserService` / `UserAdminService` stay the module's public vocabulary and are
 * re-exported from the barrel unchanged.
 */
@Module({
  providers: [
    PrismaUsers,
    { provide: USER_REPOSITORY, useExisting: PrismaUsers },
    UserService,
    UserAdminService,
  ],
  exports: [UserService, UserAdminService],
})
export class UserModule {}
