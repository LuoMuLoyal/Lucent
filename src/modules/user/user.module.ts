import { Module } from '@nestjs/common';
import { UserService } from './services/user.service';

/**
 * Pure internal service module — provides user CRUD operations to auth/account.
 * No controller is needed; user-facing endpoints live in AuthController and AccountController.
 */
@Module({
  providers: [UserService],
  exports: [UserService],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- NestJS @Module requires a class declaration
export class UserModule {}
