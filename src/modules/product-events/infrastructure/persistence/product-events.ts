import { Injectable } from '@nestjs/common';

import {
  Prisma,
  type HealthEventStatus,
  type ProductEventName as PrismaProductEventName,
  type ProductEventResult as PrismaProductEventResult,
  type ProductEventSurface as PrismaProductEventSurface,
  type UserDevicePlatform as PrismaUserDevicePlatform,
} from '#generated/prisma/client.js';
import { isDomainFailure } from '../../../../common/result/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  ProductEvents,
  type FunnelAggregateRow,
  type FunnelWindow,
  type ProductEventRow,
} from '../../application/ports/product-events.js';

/**
 * `ProductEvents` 端口的 Prisma 实现。
 *
 * ## `describeFailure` 为什么在这里
 *
 * 「什么算稳定可记录的错误标识」是 **Prisma 的知识**：只有
 * `PrismaClientKnownRequestError` 才有 `P10xx/P20xx` 这类稳定码，其它错误的
 * 原文可能带连接串、主机名、表名。把它放进应用层就等于让应用层 import
 * `@prisma/client`——`arch:check` 会拦，且那也确实不是应用层该知道的。
 */
@Injectable()
export class PrismaProductEvents extends ProductEvents {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async insertBatch(rows: ProductEventRow[]): Promise<number> {
    const result = await this.prisma.userProductEvent.createMany({
      data: rows.map((row) => ({
        userId: row.userId,
        clientEventId: row.clientEventId,
        name: row.name as PrismaProductEventName,
        surface: row.surface as PrismaProductEventSurface,
        result: row.result as PrismaProductEventResult,
        eventStatus: (row.eventStatus as HealthEventStatus | null) ?? null,
        suggestionRuleCode: row.suggestionRuleCode,
        appVersion: row.appVersion,
        platform: row.platform as PrismaUserDevicePlatform,
        occurredAt: row.occurredAt,
      })),
      // 唯一约束 (userId, clientEventId) + 跳过重复 = 幂等批写。
      skipDuplicates: true,
    });
    return result.count;
  }

  async aggregateByDay(window: FunnelWindow): Promise<FunnelAggregateRow[]> {
    return await this.prisma.$queryRaw<FunnelAggregateRow[]>(Prisma.sql`
      SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             name,
             COUNT(*)::int AS count
      FROM user_product_events
      WHERE occurred_at >= ${window.start} AND occurred_at < ${window.end}
      GROUP BY 1, 2
    `);
  }

  describeFailure(failure: unknown): string {
    if (failure instanceof Prisma.PrismaClientKnownRequestError) {
      return `prisma ${failure.code}`;
    }
    if (failure instanceof Error) {
      return failure.constructor.name;
    }
    if (isDomainFailure(failure)) {
      return failure.cause instanceof Prisma.PrismaClientKnownRequestError
        ? `prisma ${failure.cause.code}`
        : `domain ${failure.code}`;
    }
    return 'unknown error';
  }
}
