import { Injectable } from '@nestjs/common';

import { Account, User } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import {
  AuthBetterAuthAdapter,
  CREDENTIAL_PROVIDER_ID,
  PasswordReauthService,
} from '../../auth';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserService } from '../../user';
import { AccountDto } from '../dto/response.dto';
import { UnlinkIdentityDto } from '../dto/unlink-identity.dto';
import { UpdateAccountDto } from '../dto/update.dto';

type AccountUser = User & { accounts: Account[] };

@Injectable()
export class AccountService {
  constructor(
    private readonly userService: UserService,
    private readonly prisma: PrismaService,
    private readonly passwordReauthService: PasswordReauthService,
    private readonly betterAuthAdapter: AuthBetterAuthAdapter,
  ) {}

  getAccount(userId: string): ResultAsync<AccountDto, DomainFailure> {
    return this.getActiveAccountUser(userId).andThen((user) =>
      this.betterAuthAdapter
        .hasPassword(userId)
        .map((hasPassword) => this.toAccountDto(user, hasPassword)),
    );
  }

  updateAccount(
    userId: string,
    dto: UpdateAccountDto,
  ): ResultAsync<AccountDto, DomainFailure> {
    const nickname = dto.nickname === '' ? null : dto.nickname;
    const avatar = dto.avatar === '' ? null : dto.avatar;

    return this.getActiveAccountUser(userId)
      .andThen(() =>
        this.userService.update(userId, {
          ...(dto.nickname !== undefined && { nickname }),
          ...(dto.avatar !== undefined && { avatar }),
        }),
      )
      .andThen(() => this.getAccount(userId));
  }

  unlinkIdentity(
    userId: string,
    identityId: string,
    dto: UnlinkIdentityDto,
  ): ResultAsync<AccountDto, DomainFailure> {
    return this.getActiveAccountUser(userId)
      .andThen((user) =>
        this.passwordReauthService.verify(userId, dto.password).map(() => user),
      )
      .andThen((user) =>
        this.betterAuthAdapter
          .hasPassword(userId)
          .map((hasPassword) => ({ user, hasPassword })),
      )
      .andThen(({ user, hasPassword }) => {
        const identity = user.accounts.find((item) => item.id === identityId);
        if (!identity) {
          return errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
            }),
          );
        }

        if (!hasPassword && user.accounts.length <= 1) {
          return errAsync(
            createDomainFailure({
              kind: 'authorization',
              code: 'FORBIDDEN',
            }),
          );
        }

        return this.deleteAccountIdentity(userId, identityId).andThen(() =>
          this.getAccount(userId),
        );
      });
  }

  private getActiveAccountUser(
    userId: string,
  ): ResultAsync<AccountUser, DomainFailure> {
    return fromPromise(this.userService.findById(userId), (error) => {
      throw error;
    }).andThen((user) => {
      if (!user) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return fromPromise(
        this.prisma.account.findMany({
          where: {
            userId,
            providerId: { not: CREDENTIAL_PROVIDER_ID },
          },
          orderBy: { createdAt: 'asc' },
        }),
        (error) => {
          throw error;
        },
      ).map((accounts) => ({ ...user, accounts }));
    });
  }

  private deleteAccountIdentity(
    userId: string,
    identityId: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.prisma.account.deleteMany({
        where: {
          id: identityId,
          userId,
          providerId: { not: CREDENTIAL_PROVIDER_ID },
        },
      }),
      (error) => {
        throw error;
      },
    ).andThen((result) => {
      if (result.count === 0) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return this.betterAuthAdapter.revokeBetterAuthSessions(userId);
    });
  }

  private toAccountDto(user: AccountUser, hasPassword: boolean): AccountDto {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      avatar: user.avatar,
      emailVerifiedAt: this.formatDateTime(user.emailVerifiedAt),
      hasPassword,
      lastLoginAt: this.formatDateTime(user.lastLoginAt),
      linkedIdentities: user.accounts.map((identity) => ({
        id: identity.id,
        provider: identity.providerId,
        email: identity.providerEmail,
        emailVerifiedAt: this.formatDateTime(identity.providerEmailVerifiedAt),
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
