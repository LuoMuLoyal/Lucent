import { conflict } from '../../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';

import { I18nService } from 'nestjs-i18n';
import { User, UserStatus } from '#generated/prisma/client';
import { UserService } from '../../user/services/user.service';
import type { OAuthProfile } from '../types/oauth.types';

@Injectable()
export class AuthOAuthService {
  constructor(
    private readonly userService: UserService,
    private readonly i18n: I18nService,
  ) {}

  async findOrCreateOAuthUser(profile: OAuthProfile): Promise<User> {
    const linkedUser = await this.userService.findByIdentity(
      profile.provider,
      profile.providerUserId,
    );
    if (linkedUser) {
      return linkedUser;
    }

    if (profile.unionId) {
      const existingUnionUser = await this.userService.findByProviderUnionId(
        profile.unionId,
      );
      if (existingUnionUser) {
        await this.linkOAuthIdentity(existingUnionUser.id, profile);
        return existingUnionUser;
      }
    }

    if (profile.email) {
      const existingUser = await this.userService.findByEmail(
        this.normalizeEmail(profile.email),
      );
      if (existingUser) {
        await this.linkOAuthIdentity(existingUser.id, profile);
        return existingUser;
      }
    }

    return this.userService.createOAuthUser({
      ...(profile.email !== undefined && {
        email:
          profile.email === null ? null : this.normalizeEmail(profile.email),
      }),
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
        ...(profile.email !== undefined && {
          email:
            profile.email === null ? null : this.normalizeEmail(profile.email),
        }),
        ...(profile.emailVerifiedAt !== undefined && {
          emailVerifiedAt: profile.emailVerifiedAt,
        }),
        ...(profile.rawProfile !== undefined && {
          rawProfile: profile.rawProfile,
        }),
      },
    });
  }

  async updateOAuthLoginUser(user: User, profile: OAuthProfile): Promise<User> {
    return this.userService.update(user.id, {
      lastLoginAt: new Date('2026-01-01T00:00:00Z'),
      status: UserStatus.active,
      ...(profile.nickname !== undefined && { nickname: profile.nickname }),
      ...(profile.avatar !== undefined && { avatar: profile.avatar }),
    });
  }

  async linkOAuthProfileToUser(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    const linkedUser = await this.userService.findByIdentity(
      profile.provider,
      profile.providerUserId,
    );
    if (linkedUser) {
      if (linkedUser.id !== userId) {
        conflict(this.i18n.t('auth.oauth_identity_in_use'));
      }
      return;
    }

    if (profile.unionId) {
      const unionUser = await this.userService.findByProviderUnionId(
        profile.unionId,
      );
      if (unionUser && unionUser.id !== userId) {
        conflict(this.i18n.t('auth.oauth_identity_in_use'));
      }
    }

    await this.linkOAuthIdentity(userId, profile);
  }

  private async linkOAuthIdentity(
    userId: string,
    profile: OAuthProfile,
  ): Promise<void> {
    await this.userService.linkIdentity(userId, {
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      ...(profile.unionId !== undefined && {
        providerUnionId: profile.unionId,
      }),
      ...(profile.email !== undefined && {
        email:
          profile.email === null ? null : this.normalizeEmail(profile.email),
      }),
      ...(profile.emailVerifiedAt !== undefined && {
        emailVerifiedAt: profile.emailVerifiedAt,
      }),
      ...(profile.rawProfile !== undefined && {
        rawProfile: profile.rawProfile,
      }),
    });
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }
}
