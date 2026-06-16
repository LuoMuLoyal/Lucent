import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateUserSettingsDto, UserSettingsDataDto } from './dto';

/** Known setting keys with their default boolean values. */
const SETTING_DEFAULTS = {
  aiSummariesEnabled: true,
  dataSharingConsent: false,
} as const;

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
        'aiSummariesEnabled',
        SETTING_DEFAULTS.aiSummariesEnabled,
      ),
      dataSharingConsent: this.readBool(
        map,
        'dataSharingConsent',
        SETTING_DEFAULTS.dataSharingConsent,
      ),
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
        key: 'aiSummariesEnabled',
        value: dto.aiSummariesEnabled,
      });
    }
    if (dto.dataSharingConsent !== undefined) {
      upserts.push({
        key: 'dataSharingConsent',
        value: dto.dataSharingConsent,
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
