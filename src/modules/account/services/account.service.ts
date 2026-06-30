import { notFound, forbidden } from '../../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

import { PrismaService } from '../../../prisma/prisma.service';
import { User, UserIdentity } from '../../../generated/prisma/client';
import { AccountDto } from '../dto/account-response.dto';
import { UpdateAccountDto } from '../dto/update-account.dto';

type AccountUser = User & { identities: UserIdentity[] };

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
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

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.nickname !== undefined && { nickname }),
        ...(dto.avatar !== undefined && { avatar }),
      },
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

    await this.prisma.userIdentity.delete({ where: { id: identityId } });
    return this.getAccount(userId);
  }

  private async getActiveAccountUser(userId: string): Promise<AccountUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { identities: { orderBy: { createdAt: 'asc' } } },
    });

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
