import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AuthIdentityService, PasswordReauthService } from '../auth/index.js';
import { UserModule } from '../user/user.module.js';
import { AccountController } from './adapters/http/account.controller.js';
import { Account } from './application/use_cases/account.js';
import { AccountIdentity } from './application/ports/account-identity.js';
import { LinkedIdentities } from './application/ports/linked-identities.js';
import { PrismaLinkedIdentities } from './infrastructure/persistence/linked-identities.js';

/**
 * 账户档案模块。
 *
 * ## `AccountIdentity` 为什么在装配层做适配
 *
 * `account` 只需要 auth 的两个能力：「有没有密码」与「重验密码」。直接在
 * 用例里注入 auth 的两个 service 会同时踩两条 arch 规则——经 barrel 导入被
 * `ddd-application-no-infra-or-adapters` 拦（barrel 重新导出了
 * `infrastructure/oauth/*`），经 deep path 导入被
 * `modules-cross-boundary-must-use-barrel` 拦。**那是个没有合法解的形状。**
 *
 * 所以在 `account` 侧声明最小端口 `AccountIdentity`，**只在装配层**把它绑到
 * auth 的两个 service 上。用例只看见两个方法，看不见它们背后的限流、审计与
 * 会话依赖。
 */
@Module({
  imports: [AuthModule, UserModule],
  controllers: [AccountController],
  providers: [
    Account,
    PrismaLinkedIdentities,
    { provide: LinkedIdentities, useExisting: PrismaLinkedIdentities },
    {
      provide: AccountIdentity,
      useFactory: (
        identity: AuthIdentityService,
        reauth: PasswordReauthService,
      ): AccountIdentity => ({
        hasPassword: (userId, scope) => identity.hasPassword(userId, scope),
        verifyPassword: (userId, password) => reauth.verify(userId, password),
      }),
      inject: [AuthIdentityService, PasswordReauthService],
    },
  ],
})
export class AccountModule {}
