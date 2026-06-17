import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateUserSettingsDto, UserSettingsDataDto } from './dto';
import {
  AI_CHAT_CONTEXT_DEFAULTS,
  AI_CHAT_CONTEXT_SETTING_KEYS,
  USER_SETTING_KEYS,
  USER_SETTINGS_DEFAULTS,
} from './user-settings.constants';

@Injectable()
export class UserSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(userId: string): Promise<UserSettingsDataDto> {
    const rows = await this.prisma.userSetting.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });

    const map = new Map<string, unknown>();
    for (const row of rows) {
      map.set(row.key, row.value);
    }

    const latest = rows[0];

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
      aiChatEnabled: this.readBool(
        map,
        USER_SETTING_KEYS.aiChatEnabled,
        USER_SETTINGS_DEFAULTS.aiChatEnabled,
      ),
      aiChatContext: {
        healthProfile: this.readBool(
          map,
          AI_CHAT_CONTEXT_SETTING_KEYS.healthProfile,
          AI_CHAT_CONTEXT_DEFAULTS.healthProfile,
        ),
        dailyRecords: this.readBool(
          map,
          AI_CHAT_CONTEXT_SETTING_KEYS.dailyRecords,
          AI_CHAT_CONTEXT_DEFAULTS.dailyRecords,
        ),
        sleepRecords: this.readBool(
          map,
          AI_CHAT_CONTEXT_SETTING_KEYS.sleepRecords,
          AI_CHAT_CONTEXT_DEFAULTS.sleepRecords,
        ),
        currentMedicines: this.readBool(
          map,
          AI_CHAT_CONTEXT_SETTING_KEYS.currentMedicines,
          AI_CHAT_CONTEXT_DEFAULTS.currentMedicines,
        ),
      },
      updatedAt: latest ? latest.updatedAt.toISOString() : null,
    };
  }

  async updateSettings(
    userId: string,
    dto: UpdateUserSettingsDto,
  ): Promise<UserSettingsDataDto> {
    const upserts: Array<{ key: string; value: boolean }> = [];
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
    if (dto.aiChatEnabled !== undefined) {
      upserts.push({
        key: USER_SETTING_KEYS.aiChatEnabled,
        value: dto.aiChatEnabled,
      });
    }

    if (dto.aiChatContext?.healthProfile !== undefined) {
      upserts.push({
        key: AI_CHAT_CONTEXT_SETTING_KEYS.healthProfile,
        value: dto.aiChatContext.healthProfile,
      });
    }
    if (dto.aiChatContext?.dailyRecords !== undefined) {
      upserts.push({
        key: AI_CHAT_CONTEXT_SETTING_KEYS.dailyRecords,
        value: dto.aiChatContext.dailyRecords,
      });
    }
    if (dto.aiChatContext?.sleepRecords !== undefined) {
      upserts.push({
        key: AI_CHAT_CONTEXT_SETTING_KEYS.sleepRecords,
        value: dto.aiChatContext.sleepRecords,
      });
    }
    if (dto.aiChatContext?.currentMedicines !== undefined) {
      upserts.push({
        key: AI_CHAT_CONTEXT_SETTING_KEYS.currentMedicines,
        value: dto.aiChatContext.currentMedicines,
      });
    }

    for (const { key, value } of upserts) {
      await this.prisma.userSetting.upsert({
        where: { userId_key: { userId, key } },
        create: { userId, key, value },
        update: { value },
      });
    }

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
}
