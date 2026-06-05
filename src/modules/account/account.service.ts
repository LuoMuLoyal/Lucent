import { Injectable, NotFoundException } from '@nestjs/common';

import { ResultCode } from '../../common/api-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { User, UserIdentity } from '../../generated/prisma/client';
import { AccountDto } from './dto/account-response.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

type AccountUser = User & { identities: UserIdentity[] };

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

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

  private async getActiveAccountUser(userId: string): Promise<AccountUser> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { identities: { orderBy: { createdAt: 'asc' } } },
    });

    if (!user) {
      throw new NotFoundException({
        code: ResultCode.NOT_FOUND,
        message: 'User not found',
      });
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
