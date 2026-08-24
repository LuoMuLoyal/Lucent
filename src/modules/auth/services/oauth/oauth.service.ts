import { randomUUID } from 'node:crypto';
import { normalizeEmail, fromPrismaResult } from '../../../../common';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result';
import { Injectable } from '@nestjs/common';

import { Prisma, User, UserStatus } from '#generated/prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import type { OAuthProfile } from '../../types/oauth.types';

@Injectable()
export class AuthOAuthService {
  constructor(private readonly prisma: PrismaService) {}

  findOrCreateOAuthUser(
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    return this.findAccountUser(
      profile.provider,
      profile.providerUserId,
    ).andThen((existing) => {
      if (existing) {
        return okAsync(existing.user);
      }
      return this.matchByUnionIdOrEmail(profile);
    });
  }

  updateOAuthLoginUser(
    user: User,
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    return fromPrismaResult(
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          status: UserStatus.active,
          ...(profile.nickname !== undefined && { nickname: profile.nickname }),
          ...(profile.avatar !== undefined && { avatar: profile.avatar }),
        },
      }),
    );
  }

  linkOAuthProfileToUser(
    userId: string,
    profile: OAuthProfile,
  ): ResultAsync<void, DomainFailure> {
    if (profile.provider === 'apple' || profile.provider === 'google') {
      return errAsync(this.identityInUse());
    }

    return this.findAccountUser(
      profile.provider,
      profile.providerUserId,
    ).andThen((existing) => {
      if (existing) {
        if (existing.user.id !== userId) {
          return errAsync(this.identityInUse());
        }
        return okAsync(undefined);
      }
      return this.checkUnionAndLink(userId, profile);
    });
  }

  // ── Private helpers ──

  private matchByUnionIdOrEmail(
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    if (profile.unionId) {
      return this.findAccountUserByUnionId(profile.unionId).andThen(
        (existingUnionUser) => {
          if (existingUnionUser) {
            return this.createAccount(existingUnionUser.user.id, profile).map(
              () => existingUnionUser.user,
            );
          }
          return this.matchByEmail(profile);
        },
      );
    }
    return this.matchByEmail(profile);
  }

  private matchByEmail(
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    if (profile.email) {
      return fromPromise(
        this.prisma.user.findFirst({
          where: {
            email: normalizeEmail(profile.email),
            deletedAt: null,
          },
        }),
        (error) => {
          throw error;
        },
      ).andThen((existingUser) => {
        if (existingUser && profile.emailVerifiedAt) {
          return this.createAccount(existingUser.id, profile).map(
            () => existingUser,
          );
        }
        return this.createOAuthUser(profile);
      });
    }
    return this.createOAuthUser(profile);
  }

  private createOAuthUser(
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    const email = profile.email;
    if (!email) {
      return errAsync(
        createDomainFailure({
          kind: 'validation',
          code: 'VALIDATION_FAILED',
          detail:
            'OAuth profile must provide an email to create a Lucent account',
        }),
      );
    }

    return fromPrismaResult(
      this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: normalizeEmail(email),
            ...(profile.nickname !== undefined && {
              nickname: profile.nickname,
            }),
            ...(profile.avatar !== undefined && { avatar: profile.avatar }),
            ...(profile.emailVerifiedAt !== undefined && {
              emailVerifiedAt: profile.emailVerifiedAt,
            }),
            profile: { create: {} },
          },
        });
        await tx.account.create({
          data: this.toAccountCreateData(user.id, profile),
        });
        return user;
      }),
    );
  }

  private checkUnionAndLink(
    userId: string,
    profile: OAuthProfile,
  ): ResultAsync<void, DomainFailure> {
    if (profile.unionId) {
      return this.findAccountUserByUnionId(profile.unionId).andThen(
        (unionAccount) => {
          if (unionAccount && unionAccount.user.id !== userId) {
            return errAsync(this.identityInUse());
          }
          return this.createAccount(userId, profile).map(() => undefined);
        },
      );
    }
    return this.createAccount(userId, profile).map(() => undefined);
  }

  private createAccount(
    userId: string,
    profile: OAuthProfile,
  ): ResultAsync<void, DomainFailure> {
    return fromPrismaResult(
      this.prisma.account
        .create({
          data: this.toAccountCreateData(userId, profile),
        })
        .then(() => undefined),
    );
  }

  private toAccountCreateData(
    userId: string,
    profile: OAuthProfile,
  ): Prisma.AccountCreateInput {
    const email = profile.email;
    return {
      id: randomUUID(),
      user: { connect: { id: userId } },
      issuer: profile.provider,
      providerId: profile.provider,
      accountId: profile.providerUserId,
      ...(profile.unionId !== undefined && {
        providerUnionId: profile.unionId,
      }),
      ...(email !== undefined && {
        providerEmail: email === null ? null : normalizeEmail(email),
      }),
      ...(profile.emailVerifiedAt !== undefined && {
        providerEmailVerifiedAt: profile.emailVerifiedAt,
      }),
      ...(profile.rawProfile !== undefined && {
        rawProfile: profile.rawProfile,
      }),
    };
  }

  private findAccountUser(
    providerId: string,
    accountId: string,
  ): ResultAsync<{ user: User } | null, DomainFailure> {
    return fromPromise(
      this.prisma.account.findFirst({
        where: {
          providerId,
          accountId,
          user: { deletedAt: null },
        },
        include: { user: true },
      }),
      (error) => {
        throw error;
      },
    ).map((account) => (account ? { user: account.user } : null));
  }

  private findAccountUserByUnionId(
    providerUnionId: string,
  ): ResultAsync<{ user: User } | null, DomainFailure> {
    return fromPromise(
      this.prisma.account.findFirst({
        where: {
          providerUnionId,
          user: { deletedAt: null },
        },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
      (error) => {
        throw error;
      },
    ).map((account) => (account ? { user: account.user } : null));
  }

  private identityInUse(): DomainFailure {
    return createDomainFailure({
      kind: 'conflict',
      code: 'RESOURCE_CONFLICT',
    });
  }
}
