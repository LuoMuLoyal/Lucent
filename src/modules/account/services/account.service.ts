import { notFound, forbidden } from '../../../common/helpers';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { User, UserIdentity } from '#generated/prisma/client';
import { UserService } from '../../user/services/user.service';
import { AccountDto } from '../dto/response.dto';
import { UpdateAccountDto } from '../dto/update.dto';

type AccountUser = User & { identities: UserIdentity[] };

@Injectable()
export class AccountService {
  constructor(
    private readonly userService: UserService,
    private readonly i18n: I18nService,
  ) {}

  async getAccount(userId: string): Promise<AccountDto> {
    return this.toAccountDto(await this.getActiveAccountUser(userId));
  }

  async updateAccount(
    userId: string,
    dto: UpdateAccountDto,
  ): Promise<AccountDto> {
    await this.getActiveAccountUser(userId);

    const nickname = dto.nickname === '' ? null : dto.nickname;
    const avatar = dto.avatar === '' ? null : dto.avatar;

    await this.userService.update(userId, {
      ...(dto.nickname !== undefined && { nickname }),
      ...(dto.avatar !== undefined && { avatar }),
    });
    return this.getAccount(userId);
  }

  async unlinkIdentity(
    userId: string,
    identityId: string,
  ): Promise<AccountDto> {
    const user = await this.getActiveAccountUser(userId);
    const identity = user.identities.find((item) => item.id === identityId);
    if (!identity) {
      notFound(this.i18n.t('account.identity_not_found'));
    }

    if (user.passwordHash === null && user.identities.length <= 1) {
      forbidden(this.i18n.t('account.cannot_unlink_last_method'));
    }

    await this.userService.unlinkIdentity(identityId);
    return this.getAccount(userId);
  }

  private async getActiveAccountUser(userId: string): Promise<AccountUser> {
    const user = await this.userService.findByIdWithIdentities(userId);

    if (!user) {
      notFound(this.i18n.t('account.user_not_found'));
    }

    return user;
  }

  private toAccountDto(user: AccountUser): AccountDto {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      emailVerifiedAt: this.formatDateTime(user.emailVerifiedAt),
      hasPassword: user.passwordHash !== null,
      lastLoginAt: this.formatDateTime(user.lastLoginAt),
      linkedIdentities: user.identities.map((identity) => ({
        id: identity.id,
        provider: identity.provider,
        email: identity.email,
        emailVerifiedAt: this.formatDateTime(identity.emailVerifiedAt),
        linkedAt: identity.createdAt.toISOString(),
      })),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private formatDateTime(value: Date | null): string | null {
    return value?.toISOString() ?? null;
  }
}
