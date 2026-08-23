import { Injectable } from '@nestjs/common';

import { User, UserIdentity } from '#generated/prisma/client';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { PasswordReauthService } from '../../auth';
import { UserService } from '../../user';
import { AccountDto } from '../dto/response.dto';
import { UnlinkIdentityDto } from '../dto/unlink-identity.dto';
import { UpdateAccountDto } from '../dto/update.dto';

type AccountUser = User & { identities: UserIdentity[] };

@Injectable()
export class AccountService {
  constructor(
    private readonly userService: UserService,
    private readonly passwordReauthService: PasswordReauthService,
  ) {}

  getAccount(userId: string): ResultAsync<AccountDto, DomainFailure> {
    return this.getActiveAccountUser(userId).map((user) =>
      this.toAccountDto(user),
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
      .andThen((user) => {
        const identity = user.identities.find((item) => item.id === identityId);
        if (!identity) {
          return errAsync(
            createDomainFailure({
              kind: 'not_found',
              code: 'RESOURCE_NOT_FOUND',
            }),
          );
        }

        if (user.passwordHash === null && user.identities.length <= 1) {
          return errAsync(
            createDomainFailure({
              kind: 'authorization',
              code: 'FORBIDDEN',
            }),
          );
        }

        return this.userService
          .unlinkIdentity(identityId)
          .andThen(() => this.getAccount(userId));
      });
  }

  private getActiveAccountUser(
    userId: string,
  ): ResultAsync<AccountUser, DomainFailure> {
    return fromPromise(
      this.userService.findByIdWithIdentities(userId),
      (error) => {
        throw error;
      },
    ).andThen((user) => {
      if (!user) {
        return errAsync(
          createDomainFailure({
            kind: 'not_found',
            code: 'RESOURCE_NOT_FOUND',
          }),
        );
      }
      return okAsync(user);
    });
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
