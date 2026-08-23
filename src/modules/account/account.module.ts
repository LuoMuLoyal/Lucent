import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { AccountController } from './account.controller';
import { AccountService } from './services/account.service';

@Module({
  imports: [AuthModule, UserModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
