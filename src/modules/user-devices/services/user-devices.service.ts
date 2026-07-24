import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { PrismaService } from '../../../prisma';
import { now } from '../../../common';
import type { RegisterDeviceDto } from '../dto/register-device.dto';
import type { DeviceItemDto } from '../dto/device-response.dto';

/**
 * Manages user device registration for push notifications.
 *
 * Devices are keyed by `pushToken` (globally unique). When a device
 * re-registers with the same token, its metadata is updated — but only
 * if the token still belongs to the same user. A token owned by another
 * user cannot be hijacked via the registration endpoint.
 */
@Injectable()
export class UserDevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async register(
    userId: string,
    dto: RegisterDeviceDto,
    locale: string = 'en',
  ): Promise<DeviceItemDto> {
    // Check whether this pushToken already exists.
    const existing = await this.prisma.userDevice.findUnique({
      where: { pushToken: dto.pushToken },
      select: { id: true, userId: true },
    });

    if (existing !== null && existing.userId !== userId) {
      throw new ForbiddenException(
        this.i18n.t('user-devices.device_registered_to_another_user', {
          lang: locale,
        }),
      );
    }

    const commonData = {
      platform: dto.platform as never,
      deviceName: dto.deviceName ?? null,
      locale: dto.locale ?? null,
      timezone: dto.timezone ?? null,
      notificationsEnabled: dto.notificationsEnabled ?? false,
      lastSeenAt: now(),
    };

    const record =
      existing !== null
        ? await this.prisma.userDevice.update({
            where: { id: existing.id },
            // userId intentionally omitted — never reassign ownership on update.
            data: commonData,
          })
        : await this.prisma.userDevice.create({
            data: { userId, pushToken: dto.pushToken, ...commonData },
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

  async remove(
    userId: string,
    id: string,
    locale: string = 'en',
  ): Promise<void> {
    const existing = await this.prisma.userDevice.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (existing === null) {
      throw new NotFoundException(
        this.i18n.t('user-devices.device_not_found', { lang: locale }),
      );
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException(
        this.i18n.t('user-devices.device_belongs_to_another_user', {
          lang: locale,
        }),
      );
    }

    await this.prisma.userDevice.delete({ where: { id } });
  }

  private toItem(row: {
    id: string;
    platform: unknown;
    deviceName: string | null;
    pushToken: string | null;
    notificationsEnabled: boolean;
    locale: string | null;
    timezone: string | null;
    lastSeenAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): DeviceItemDto {
    return {
      id: row.id,
      platform: row.platform as string,
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
