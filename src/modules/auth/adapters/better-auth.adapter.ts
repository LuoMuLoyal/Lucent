import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { betterAuth, type Auth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import * as argon2 from 'argon2';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { EnvKey } from '../../../config/env/env-keys.enum.js';
import { ARGON2_OPTIONS } from '../config/argon2-options.js';

/**
 * NestJS adapter wrapping the Better Auth library against Lucent's merged
 * `User` model.  This service is intentionally not exposed as an HTTP route —
 * it only constructs and holds the configured `auth` instance so that later
 * tasks can call `auth.api.*` methods to drive credential and OAuth flows.
 *
 * Field mapping:
 * - Better Auth `name`   -> Lucent `nickname`
 * - Better Auth `image`  -> Lucent `avatar`
 * - Better Auth `emailVerified` already exists on the merged `User` model.
 */
@Injectable()
export class AuthBetterAuthAdapter {
  readonly auth: Auth;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret = this.config.get<string>(EnvKey.BETTER_AUTH_SECRET);
    if (!secret) {
      throw new Error(
        `Missing required environment variable: ${EnvKey.BETTER_AUTH_SECRET}`,
      );
    }

    const baseURL =
      this.config.get<string>(EnvKey.BETTER_AUTH_URL)?.trim() ||
      this.config.get<string>(EnvKey.PUBLIC_BASE_URL)?.trim() ||
      'http://localhost:3000';

    this.auth = betterAuth({
      database: prismaAdapter(this.prisma, { provider: 'postgresql' }),
      secret,
      baseURL,
      user: {
        modelName: 'User',
        fields: {
          name: 'nickname',
          image: 'avatar',
        },
      },
      emailAndPassword: {
        enabled: true,
        password: {
          hash: async (password: string) =>
            argon2.hash(password, ARGON2_OPTIONS),
          verify: async (data: { hash: string; password: string }) =>
            argon2.verify(data.hash, data.password, ARGON2_OPTIONS),
        },
      },
    }) as Auth;
  }
}
