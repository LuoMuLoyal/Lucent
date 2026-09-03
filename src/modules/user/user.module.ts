import { Module } from '@nestjs/common';
import { UserService } from './services/user.service.js';

/**
 * Pure internal service module — provides user CRUD operations to auth/account.
 * No controller is needed; user-facing endpoints live in auth controllers and AccountController.
 */
@Module({
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
