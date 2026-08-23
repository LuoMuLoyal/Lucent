import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { Prisma } from '#generated/prisma/client';
import { PrismaService } from '../../../prisma';
import { now } from '../../../common';
import {
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../common/result';
import { fromPrismaResult } from '../../../common';
import {
  DELIVERY_CHANNEL_LOCAL,
  DELIVERY_STATUS_DELIVERED,
  LOCAL_CAPABILITY_CACHE_TTL_MS,
  localCapabilityCacheKey,
  type LocalCapabilityState,
} from '../constants/delivery.constants';
import type { ReminderDeliveryReceiptDto } from '../dto/reminder-delivery-receipt.dto';
import type { ReminderDeliveryItemDto } from '../dto/reminder-delivery-response.dto';
import { MedicineRemindersMapperService } from './mapper.service';
import { MedicineRemindersOwnershipService } from './ownership.service';
import { wallClockToScheduledFor } from './delivery-moment';

const deliveryItemSelect = {
  id: true,
  reminderId: true,
  deviceId: true,
  channel: true,
  status: true,
  scheduledFor: true,
  deliveredAt: true,
  errorMessage: true,
  createdAt: true,
} satisfies Prisma.UserReminderDeliverySelect;

type DeliveryItemRow = Prisma.UserReminderDeliveryGetPayload<{
  select: typeof deliveryItemSelect;
}>;

/**
 * 投递写入接口：本地通知回执（幂等落 local 审计行）与本地调度能力上报。
 *
 * - `recordLocalReceipt`：客户端在本地通知实际展示后回写；墙钟时间按用户
 *   profile 时区换算为 UTC 截断分钟，先 findFirst 快速路径，再
 *   `createMany({ skipDuplicates: true })` 由唯一约束原子兜底（ADR-0013）。
 * - `reportLocalCapability`：把客户端本地调度能力写入 14 天 TTL 缓存，
 *   scheduler 据此门控 JPush 后台回退。
 */
@Injectable()
export class DeliveryReceiptsService {
  private readonly logger = new Logger(DeliveryReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ownershipService: MedicineRemindersOwnershipService,
    private readonly mapperService: MedicineRemindersMapperService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * 记录一条本地通知回执。归属校验失败（非本人提醒）返回
   * `RESOURCE_NOT_FOUND` / `FORBIDDEN`。同一 local 事件重复上报直接返回
   * 现有行，不重复写入（幂等成功）。
   */
  recordLocalReceipt(
    userId: string,
    dto: ReminderDeliveryReceiptDto,
  ): ResultAsync<ReminderDeliveryItemDto, DomainFailure> {
    return this.ownershipService
      .ensureOwnedByUser(userId, dto.reminderId)
      .andThen(() =>
        fromPromise(this.readProfileTimezone(userId), (error) => {
          throw error;
        }),
      )
      .andThen((timezone) => {
        const scheduledFor = wallClockToScheduledFor(
          dto.scheduledDate,
          dto.scheduledTime,
          timezone,
        );

        return fromPromise(
          this.findLocalDelivery(userId, dto.reminderId, scheduledFor),
          (error) => {
            throw error;
          },
        ).andThen((existing) => {
          if (existing != null) {
            return okAsync(this.toItem(existing));
          }

          return fromPrismaResult(
            this.prisma.userReminderDelivery.createMany({
              data: {
                userId,
                reminderId: dto.reminderId,
                channel: DELIVERY_CHANNEL_LOCAL,
                status: DELIVERY_STATUS_DELIVERED,
                scheduledFor,
                deliveredAt: now(),
              },
              skipDuplicates: true,
            }),
          )
            .andThen(() =>
              fromPromise(
                this.findLocalDelivery(userId, dto.reminderId, scheduledFor),
                (error) => {
                  throw error;
                },
              ),
            )
            .andThen((created) => {
              // createMany 成功（或与并发请求去重后）该行必然存在；兜底读取
              // 防御。行缺失属于程序不变式破坏，直接抛出（500），不伪装成
              // 客户端可恢复的业务失败。
              if (created == null) {
                throw new Error(
                  `Local delivery receipt row missing after write: userId=${userId}, reminderId=${dto.reminderId}`,
                );
              }
              return okAsync(this.toItem(created));
            });
        });
      });
  }

  /** 上报并持久化本地调度能力（TTL 14 天）。 */
  reportLocalCapability(
    userId: string,
    state: LocalCapabilityState,
  ): ResultAsync<{ state: LocalCapabilityState }, DomainFailure> {
    const key = localCapabilityCacheKey(userId);
    return fromPromise(
      this.cache.set(key, state, LOCAL_CAPABILITY_CACHE_TTL_MS),
      (error) => {
        this.logger.warn(
          `Reminder delivery capability cache set failed (key=${key}): ${String(error)}`,
        );
        throw error;
      },
    ).map(() => ({ state }));
  }

  private async readProfileTimezone(userId: string): Promise<string | null> {
    const profile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { timezone: true },
    });
    return profile?.timezone ?? null;
  }

  private findLocalDelivery(
    userId: string,
    reminderId: string,
    scheduledFor: Date,
  ): Promise<DeliveryItemRow | null> {
    return this.prisma.userReminderDelivery.findFirst({
      where: {
        userId,
        reminderId,
        scheduledFor,
        channel: DELIVERY_CHANNEL_LOCAL,
      },
      select: deliveryItemSelect,
    });
  }

  private toItem(row: DeliveryItemRow): ReminderDeliveryItemDto {
    return this.mapperService.toDeliveryItem(row);
  }
}
