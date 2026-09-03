import { parseDateOnly, now } from '../../../common/index.js';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Cache } from 'cache-manager';
import * as argon2 from 'argon2';

import { ARGON2_OPTIONS } from '../../auth/index.js';
import { loginFailureCacheKey } from '../../auth/index.js';
import { PrismaService } from '../../../prisma/index.js';
import { UserStatus } from '#generated/prisma/client.js';
import type { PrepareFullstackRecordLaneDto } from '../dto/prepare-fullstack-record-lane.dto.js';
import {
  listDefaultBooleanUserSettings,
  userSettingsCacheKey,
} from '../../user-settings/index.js';

const DEFAULT_RECORD_LANE_NICKNAME = 'E2E Record Lane';

type TestingSupportDbClient = Pick<
  PrismaService,
  | 'user'
  | 'account'
  | 'userDailyRecord'
  | 'userDailyRecordAttachment'
  | 'userSession'
  | 'userSetting'
>;

export interface PrepareFullstackRecordLaneResult {
  createdUser: boolean;
  userId: string;
  email: string;
  nickname: string | null;
  date: string;
  clearedRecordCount: number;
}

@Injectable()
export class TestingSupportService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: PrismaService,
  ) {}

  async prepareFullstackRecordLane(
    dto: PrepareFullstackRecordLaneDto,
  ): Promise<PrepareFullstackRecordLaneResult> {
    const email = dto.email.trim().toLowerCase();
    const nickname = dto.nickname?.trim() || DEFAULT_RECORD_LANE_NICKNAME;
    const credentialPassword = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const result = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: { email, deletedAt: null },
        select: { id: true, nickname: true },
      });

      const user = existingUser
        ? await tx.user.update({
            where: { id: existingUser.id },
            data: {
              nickname,
              status: UserStatus.active,
              emailVerifiedAt: now(),
              profile: {
                upsert: {
                  create: {},
                  update: {},
                },
              },
            },
            select: { id: true, nickname: true },
          })
        : await tx.user.create({
            data: {
              email,
              nickname,
              status: UserStatus.active,
              emailVerifiedAt: now(),
              profile: { create: {} },
            },
            select: { id: true, nickname: true },
          });

      await tx.account.upsert({
        where: {
          providerId_accountId: {
            providerId: 'credential',
            accountId: user.id,
          },
        },
        create: {
          id: randomUUID(),
          userId: user.id,
          providerId: 'credential',
          issuer: 'local:credential',
          accountId: user.id,
          password: credentialPassword,
        },
        update: {
          password: credentialPassword,
        },
      });

      const clearedRecordCount = await this.clearDailyRecordsForDate(
        tx,
        user.id,
        dto.date,
      );

      for (const setting of listDefaultBooleanUserSettings()) {
        await tx.userSetting.upsert({
          where: {
            userId_key: {
              userId: user.id,
              key: setting.key,
            },
          },
          create: {
            userId: user.id,
            key: setting.key,
            value: setting.value,
          },
          update: {
            value: setting.value,
          },
        });
      }

      await tx.userSession.deleteMany({
        where: { userId: user.id },
      });

      return {
        createdUser: existingUser == null,
        user,
        clearedRecordCount,
      };
    });

    await this.cache.del(loginFailureCacheKey(email));
    await this.cache.del(userSettingsCacheKey(result.user.id));

    return {
      createdUser: result.createdUser,
      userId: result.user.id,
      email,
      nickname: result.user.nickname,
      date: dto.date,
      clearedRecordCount: result.clearedRecordCount,
    };
  }

  private async clearDailyRecordsForDate(
    tx: TestingSupportDbClient,
    userId: string,
    date: string,
  ): Promise<number> {
    const targetDay = parseDateOnly(date);
    const recordIds = (
      await tx.userDailyRecord.findMany({
        where: {
          userId,
          occurredAt: targetDay,
        },
        select: { id: true },
      })
    ).map((record) => record.id);

    if (recordIds.length === 0) {
      return 0;
    }

    await tx.userDailyRecordAttachment.deleteMany({
      where: {
        userId,
        recordId: { in: recordIds },
      },
    });

    await tx.userDailyRecord.deleteMany({
      where: {
        userId,
        id: { in: recordIds },
      },
    });

    return recordIds.length;
  }
}
