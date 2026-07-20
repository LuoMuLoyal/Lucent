import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { now } from '../../../common/helpers/date-time.utils';
import type { RegisterDeviceDto } from '../dto';
import type { DeviceItemDto } from '../dto';

/**
 * Manages user device registration for push notifications.
 *
 * Devices are upserted by `pushToken` — a device that re-registers with the
 * same token updates its metadata instead of creating a duplicate row.
 */
@Injectable()
export class UserDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto): Promise<DeviceItemDto> {
    const record = await this.prisma.userDevice.upsert({
      where: { pushToken: dto.pushToken },
      create: {
        userId,
        pushToken: dto.pushToken,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        locale: dto.locale ?? null,
        timezone: dto.timezone ?? null,
        notificationsEnabled: dto.notificationsEnabled ?? false,
        lastSeenAt: now(),
      },
      update: {
        userId,
        platform: dto.platform,
        deviceName: dto.deviceName ?? null,
        locale: dto.locale ?? null,
        timezone: dto.timezone ?? null,
        notificationsEnabled: dto.notificationsEnabled ?? false,
        lastSeenAt: now(),
      },
    });

    return this.toItem(record);
  }

  async list(userId: string): Promise<{ items: DeviceItemDto[] }> {
    const records = await this.prisma.userDevice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return { items: records.map((r) => this.toItem(r)) };
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.userDevice.deleteMany({
      where: { id, userId },
    });

    return result.count > 0;
  }

  private toItem(row: {
    id: string;
    platform: string;
    deviceName: string | null;
    pushToken: string;
    notificationsEnabled: boolean;
    locale: string | null;
    timezone: string | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): DeviceItemDto {
    return {
      id: row.id,
      platform: row.platform,
      deviceName: row.deviceName,
      notificationsEnabled: row.notificationsEnabled,
      locale: row.locale,
      timezone: row.timezone,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
