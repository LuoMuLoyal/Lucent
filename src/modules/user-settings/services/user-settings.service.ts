import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../../prisma/prisma.service';
import type { UpdateUserSettingsDto, UserSettingsDataDto } from '../dto';
import {
  ASSISTANT_CONTEXT_DEFAULTS,
  ASSISTANT_CONTEXT_SETTING_KEYS,
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
} from '../constants/user-settings.constants';

/** Type union for settings values stored in the DB. */
type SettingValue = boolean | number;

@Injectable()
export class UserSettingsService {
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  private static readonly CACHE_PREFIX = 'user-settings';

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async getSettings(userId: string): Promise<UserSettingsDataDto> {
    const cacheKey = `${UserSettingsService.CACHE_PREFIX}:${userId}`;
    const cached = await this.cache.get<UserSettingsDataDto>(cacheKey);
    if (cached != null) {
      return cached;
    }

    const result = await this.fetchSettings(userId);
    await this.cache.set(cacheKey, result, UserSettingsService.CACHE_TTL_MS);
    return result;
  }

  private async fetchSettings(userId: string): Promise<UserSettingsDataDto> {
    const rows = await this.prisma.userSetting.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    const map = new Map<string, unknown>();
    for (const row of rows) {
      map.set(row.key, row.value);
    }

    const latest = rows[0];

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        securityPinEnabled: true,
        securityPinChangedAt: true,
      },
    });

    return {
      aiSummariesEnabled: this.readBool(
        map,
        USER_SETTING_KEYS.aiSummariesEnabled,
        USER_SETTINGS_DEFAULTS.aiSummariesEnabled,
      ),
      dataSharingConsent: this.readBool(
        map,
        USER_SETTING_KEYS.dataSharingConsent,
        USER_SETTINGS_DEFAULTS.dataSharingConsent,
      ),
      assistantEnabled: this.readBool(
        map,
        USER_SETTING_KEYS.assistantEnabled,
        USER_SETTINGS_DEFAULTS.assistantEnabled,
      ),
      assistantMemoryEnabled: this.readBool(
        map,
        USER_SETTING_KEYS.assistantMemoryEnabled,
        USER_SETTINGS_DEFAULTS.assistantMemoryEnabled,
      ),
      waterTargetCount: this.readNumber(
        map,
        USER_SETTING_KEYS.waterTargetCount,
        USER_SETTINGS_DEFAULTS.waterTargetCount,
      ),
      assistantContext: {
        healthProfile: this.readBool(
          map,
          ASSISTANT_CONTEXT_SETTING_KEYS.healthProfile,
          ASSISTANT_CONTEXT_DEFAULTS.healthProfile,
        ),
        dailyRecords: this.readBool(
          map,
          ASSISTANT_CONTEXT_SETTING_KEYS.dailyRecords,
          ASSISTANT_CONTEXT_DEFAULTS.dailyRecords,
        ),
        sleepRecords: this.readBool(
          map,
          ASSISTANT_CONTEXT_SETTING_KEYS.sleepRecords,
          ASSISTANT_CONTEXT_DEFAULTS.sleepRecords,
        ),
        currentMedicines: this.readBool(
          map,
          ASSISTANT_CONTEXT_SETTING_KEYS.currentMedicines,
          ASSISTANT_CONTEXT_DEFAULTS.currentMedicines,
        ),
      },
      updatedAt: latest ? latest.updatedAt.toISOString() : null,
      securityPin: {
        enabled: user.securityPinEnabled,
        lastChangedAt: user.securityPinChangedAt?.toISOString() ?? null,
      },
    };
  }

  async updateSettings(
    userId: string,
    dto: UpdateUserSettingsDto,
  ): Promise<UserSettingsDataDto> {
    const upserts: Array<{ key: string; value: SettingValue }> = [];
    if (dto.aiSummariesEnabled !== undefined) {
      upserts.push({
        key: USER_SETTING_KEYS.aiSummariesEnabled,
        value: dto.aiSummariesEnabled,
      });
    }
    if (dto.dataSharingConsent !== undefined) {
      upserts.push({
        key: USER_SETTING_KEYS.dataSharingConsent,
        value: dto.dataSharingConsent,
      });
    }
    if (dto.assistantEnabled !== undefined) {
      upserts.push({
        key: USER_SETTING_KEYS.assistantEnabled,
        value: dto.assistantEnabled,
      });
    }
    if (dto.assistantMemoryEnabled !== undefined) {
      upserts.push({
        key: USER_SETTING_KEYS.assistantMemoryEnabled,
        value: dto.assistantMemoryEnabled,
      });
    }
    if (dto.waterTargetCount !== undefined) {
      upserts.push({
        key: USER_SETTING_KEYS.waterTargetCount,
        value: dto.waterTargetCount,
      });
    }

    if (dto.assistantContext?.healthProfile !== undefined) {
      upserts.push({
        key: ASSISTANT_CONTEXT_SETTING_KEYS.healthProfile,
        value: dto.assistantContext.healthProfile,
      });
    }
    if (dto.assistantContext?.dailyRecords !== undefined) {
      upserts.push({
        key: ASSISTANT_CONTEXT_SETTING_KEYS.dailyRecords,
        value: dto.assistantContext.dailyRecords,
      });
    }
    if (dto.assistantContext?.sleepRecords !== undefined) {
      upserts.push({
        key: ASSISTANT_CONTEXT_SETTING_KEYS.sleepRecords,
        value: dto.assistantContext.sleepRecords,
      });
    }
    if (dto.assistantContext?.currentMedicines !== undefined) {
      upserts.push({
        key: ASSISTANT_CONTEXT_SETTING_KEYS.currentMedicines,
        value: dto.assistantContext.currentMedicines,
      });
    }

    for (const { key, value } of upserts) {
      await this.prisma.userSetting.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, value },
        update: { value },
      });
    }

    // Invalidate cache and return fresh data
    await this.cache.del(`${UserSettingsService.CACHE_PREFIX}:${userId}`);
    return this.getSettings(userId);
  }

  private readBool(
    map: Map<string, unknown>,
    key: string,
    fallback: boolean,
  ): boolean {
    const raw = map.get(key);
    return typeof raw === 'boolean' ? raw : fallback;
  }

  private readNumber(
    map: Map<string, unknown>,
    key: string,
    fallback: number,
  ): number {
    const raw = map.get(key);
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
  }
}
