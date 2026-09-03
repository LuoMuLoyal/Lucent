import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { UserModule } from '../user/user.module.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './services/account.service.js';

@Module({
  imports: [AuthModule, UserModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
