import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { SecurityPinModule } from '../security-pin/security-pin.module';
import { UserModule } from '../user/user.module';
import { AccountController } from './account.controller';
import { AccountService } from './services';

@Module({
  imports: [AuthModule, SecurityPinModule, UserModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
