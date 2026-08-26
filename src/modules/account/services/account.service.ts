import { Injectable } from '@nestjs/common';

import { Account, User } from '#generated/prisma/client';
import {
  createDomainFailure,
  DomainFailureException,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
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

        // Re-check hasPassword and accounts inside a transaction to close
        // the TOCTOU window between the initial read and the delete: another
        // concurrent transaction could have added a credential account (e.g.
        // user successfully set a password) or deleted the last social
        // identity. The transaction ensures atomicity.
        return fromPromise(
          this.prisma.$transaction(async (tx) => {
            // Re-check hasPassword and accounts inside the transaction to
            // close the TOCTOU window: another concurrent transaction could
            // have added a credential account (e.g. user successfully set a
            // password) or deleted the last social identity.
            const txHasPasswordResult = await this.betterAuthAdapter
              .hasPassword(userId, tx)
              .then((r) => r.isOk());
            const txAccounts = await tx.account.findMany({
              where: {
                userId,
                providerId: { not: CREDENTIAL_PROVIDER_ID },
              },
            });

            const txIdentity = txAccounts.find(
              (item) => item.id === identityId,
            );
            if (!txIdentity) {
              throw new DomainFailureException(
                createDomainFailure({
                  kind: 'not_found',
                  code: 'RESOURCE_NOT_FOUND',
                }),
              );
            }

            if (!txHasPasswordResult && txAccounts.length <= 1) {
              throw new DomainFailureException(
                createDomainFailure({
                  kind: 'authorization',
                  code: 'FORBIDDEN',
                }),
              );
            }

            const result = await tx.account.deleteMany({
              where: {
                id: identityId,
                userId,
                providerId: { not: CREDENTIAL_PROVIDER_ID },
              },
            });
            if (result.count === 0) {
              throw new DomainFailureException(
                createDomainFailure({
                  kind: 'not_found',
                  code: 'RESOURCE_NOT_FOUND',
                }),
              );
            }

            await this.betterAuthAdapter.revokeBetterAuthSessions(userId, tx);
          }),
          (error) => {
            if (error instanceof DomainFailureException) {
              return error.failure;
            }
            return mapUnknownToDependencyFailure(
              error,
              'Failed to unlink identity',
            );
          },
        ).andThen(() => this.getAccount(userId));
      });
  }

  private getActiveAccountUser(
    userId: string,
  ): ResultAsync<AccountUser, DomainFailure> {
    return fromPromise(this.userService.findById(userId), (error) =>
      mapUnknownToDependencyFailure(
        error,
        'Failed to load user for account operation',
      ),
    ).andThen((user) => {
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
        (error) =>
          mapUnknownToDependencyFailure(
            error,
            'Failed to load linked identities',
          ),
      ).map((accounts) => ({ ...user, accounts }));
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
