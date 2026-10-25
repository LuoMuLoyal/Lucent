import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UserModule } from '../user/user.module.js';
import { AccountController } from './adapters/http/account.controller.js';
import { Account } from './application/use_cases/account.js';

@Module({
  imports: [AuthModule, UserModule],
  controllers: [AccountController],
  providers: [Account],
})
export class AccountModule {}
