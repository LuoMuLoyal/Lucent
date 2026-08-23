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

import { User, UserIdentity, UserStatus } from '#generated/prisma/client';
import { UserService } from '../../../user';
import type { OAuthProfile } from '../../types/oauth.types';

@Injectable()
export class AuthOAuthService {
  constructor(private readonly userService: UserService) {}

  findOrCreateOAuthUser(
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    return fromPromise(
      this.userService.findByIdentity(profile.provider, profile.providerUserId),
      (error) => {
        throw error;
      },
    ).andThen((linkedUser) => {
      if (linkedUser) {
        return okAsync(linkedUser);
      }
      return this.matchByUnionIdOrEmail(profile);
    });
  }

  updateOAuthLoginUser(
    user: User,
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    return this.userService.update(user.id, {
      lastLoginAt: new Date(),
      status: UserStatus.active,
      ...(profile.nickname !== undefined && { nickname: profile.nickname }),
      ...(profile.avatar !== undefined && { avatar: profile.avatar }),
    });
  }

  linkOAuthProfileToUser(
    userId: string,
    profile: OAuthProfile,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.userService.findByIdentity(profile.provider, profile.providerUserId),
      (error) => {
        throw error;
      },
    ).andThen((linkedUser) => {
      if (linkedUser) {
        if (linkedUser.id !== userId) {
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
      return fromPromise(
        this.userService.findByProviderUnionId(profile.unionId),
        (error) => {
          throw error;
        },
      ).andThen((existingUnionUser) => {
        if (existingUnionUser) {
          return this.linkOAuthIdentity(existingUnionUser.id, profile).map(
            () => existingUnionUser,
          );
        }
        return this.matchByEmail(profile);
      });
    }
    return this.matchByEmail(profile);
  }

  private matchByEmail(
    profile: OAuthProfile,
  ): ResultAsync<User, DomainFailure> {
    if (profile.email) {
      return fromPromise(
        this.userService.findByEmail(normalizeEmail(profile.email)),
        (error) => {
          throw error;
        },
      ).andThen((existingUser) => {
        if (existingUser) {
          return this.linkOAuthIdentity(existingUser.id, profile).map(
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
    if (!profile.email) {
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
      this.userService.createOAuthUser({
        email: normalizeEmail(profile.email),
        ...(profile.nickname !== undefined && { nickname: profile.nickname }),
        ...(profile.avatar !== undefined && { avatar: profile.avatar }),
        ...(profile.emailVerifiedAt !== undefined && {
          emailVerifiedAt: profile.emailVerifiedAt,
        }),
        identity: {
          provider: profile.provider,
          providerUserId: profile.providerUserId,
          ...(profile.unionId !== undefined && {
            providerUnionId: profile.unionId,
          }),
          email: normalizeEmail(profile.email),
          ...(profile.emailVerifiedAt !== undefined && {
            emailVerifiedAt: profile.emailVerifiedAt,
          }),
          ...(profile.rawProfile !== undefined && {
            rawProfile: profile.rawProfile,
          }),
        },
      }),
    );
  }

  private checkUnionAndLink(
    userId: string,
    profile: OAuthProfile,
  ): ResultAsync<void, DomainFailure> {
    if (profile.unionId) {
      return fromPromise(
        this.userService.findByProviderUnionId(profile.unionId),
        (error) => {
          throw error;
        },
      ).andThen((unionUser) => {
        if (unionUser && unionUser.id !== userId) {
          return errAsync(this.identityInUse());
        }
        return this.linkOAuthIdentity(userId, profile).map(() => undefined);
      });
    }
    return this.linkOAuthIdentity(userId, profile).map(() => undefined);
  }

  private linkOAuthIdentity(
    userId: string,
    profile: OAuthProfile,
  ): ResultAsync<UserIdentity, DomainFailure> {
    return fromPrismaResult(
      this.userService.linkIdentity(userId, {
        provider: profile.provider,
        providerUserId: profile.providerUserId,
        ...(profile.unionId !== undefined && {
          providerUnionId: profile.unionId,
        }),
        ...(profile.email !== undefined && {
          email: profile.email === null ? null : normalizeEmail(profile.email),
        }),
        ...(profile.emailVerifiedAt !== undefined && {
          emailVerifiedAt: profile.emailVerifiedAt,
        }),
        ...(profile.rawProfile !== undefined && {
          rawProfile: profile.rawProfile,
        }),
      }),
    );
  }

  private identityInUse(): DomainFailure {
    return createDomainFailure({
      kind: 'conflict',
      code: 'RESOURCE_CONFLICT',
    });
  }
}
