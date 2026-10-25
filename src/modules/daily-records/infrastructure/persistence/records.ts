/**
 * `DailyRecords`（写侧聚合端口）的 Prisma 实现。
 *
 * ## 为什么写数据是结构化类型而不是 Prisma 生成类型
 *
 * 端口在这里被**实现**，所以实现可以知道 Prisma；但端口签名里的
 * `RecordWriteValues` 只含数据列（`RecordRow` 的列名），这里在入口处做一次
 * 收敛 cast。好处是应用层永远不需要 import `@prisma/client`，
 * `ddd-application-no-direct-prisma` 不需要豁免。
 *
 * ## ALS 事务语义
 *
 * `transaction()` 借助 `AsyncLocalStorage` 检测嵌套事务并告警：Prisma 的嵌套
 * `$transaction` 会**静默**退化成独立连接（丢掉原子性），这是最贵的静默失败之一。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '#generated/prisma/client.js';
import { nonDeleted } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import type { RecordRow } from '../../domain/record/record-row.js';
import {
  DailyRecords,
  type AttachmentWriteValues,
  type RecordListFilter,
  type RecordOwnershipRow,
  type RecordPage,
  type RecordPageResult,
  type RecordWriteValues,
} from '../../domain/record/records.js';
import {
  recordWithAttachments,
  toDbAttachmentKind,
  toDbKind,
  toRecordRow,
} from './record-mapper.js';

type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class PrismaRecords implements DailyRecords {
  private readonly logger = new Logger(PrismaRecords.name);

  /**
   * 当前 async 上下文是否已经在 `transaction()` 里。用来发现嵌套事务。
   */
  private static readonly transactionAls = new AsyncLocalStorage<boolean>();

  /** 事务内实例只带 `tx`，其余字段留空（构造器重载保证不会用它做非事务操作）。 */
  private readonly tx: TransactionClient | null;

  constructor(
    private readonly prisma: PrismaService,
    tx?: TransactionClient,
  ) {
    this.tx = tx ?? null;
  }

  /**
   * 取本次操作该用的客户端：事务内是 `tx`，事务外是全局 client。
   *
   * 返回的结构只暴露本端口实际用到的两张表，避免不小心在事务里跑别的表。
   */
  private get db(): Pick<
    PrismaService | TransactionClient,
    'userDailyRecord' | 'userDailyRecordAttachment'
  > {
    return this.tx ?? this.prisma;
  }

  async listPage(
    filter: RecordListFilter,
    page: RecordPage,
  ): Promise<RecordPageResult> {
    const where: Prisma.UserDailyRecordWhereInput = {
      userId: filter.userId,
      occurredAt: filter.occurredAt,
      ...nonDeleted,
      ...(filter.kind != null ? { kind: toDbKind(filter.kind) } : {}),
    };

    const [rows, total] = await Promise.all([
      this.db.userDailyRecord.findMany({
        where,
        include: recordWithAttachments,
        orderBy: [
          { occurredTime: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.db.userDailyRecord.count({ where }),
    ]);

    return { items: rows.map(toRecordRow), total };
  }

  async listByDay(userId: string, occurredAt: Date): Promise<RecordRow[]> {
    const rows = await this.db.userDailyRecord.findMany({
      where: { userId, occurredAt, ...nonDeleted },
      include: recordWithAttachments,
      orderBy: [
        { occurredTime: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
    });
    return rows.map(toRecordRow);
  }

  async findById(id: string): Promise<RecordRow | null> {
    const row = await this.db.userDailyRecord.findFirst({
      where: { id, ...nonDeleted },
      include: recordWithAttachments,
    });
    return row == null ? null : toRecordRow(row);
  }

  async findOwnership(id: string): Promise<RecordOwnershipRow | null> {
    const row = await this.db.userDailyRecord.findFirst({
      where: { id, ...nonDeleted },
      select: { userId: true, kind: true, payload: true, occurredAt: true },
    });
    if (row == null) {
      return null;
    }
    return {
      userId: row.userId,
      kind: toDbKind(row.kind),
      payload: row.payload,
      occurredAt: row.occurredAt,
    };
  }

  async insert(values: RecordWriteValues): Promise<RecordRow> {
    const row = await this.db.userDailyRecord.create({
      data: values as Prisma.UserDailyRecordUncheckedCreateInput,
      include: recordWithAttachments,
    });
    return toRecordRow(row);
  }

  async update(id: string, values: RecordWriteValues): Promise<RecordRow> {
    const row = await this.db.userDailyRecord.update({
      where: { id },
      data: values,
      include: recordWithAttachments,
    });
    return toRecordRow(row);
  }

  async replaceAttachments(
    userId: string,
    recordId: string,
    attachments: AttachmentWriteValues[],
  ): Promise<void> {
    await this.db.userDailyRecordAttachment.deleteMany({
      where: { userId, recordId },
    });
    if (attachments.length === 0) {
      return;
    }
    await this.db.userDailyRecordAttachment.createMany({
      data: attachments.map((attachment) => ({
        ...attachment,
        kind: toDbAttachmentKind(attachment.kind),
      })),
    });
  }

  /**
   * 软删除。返回是否真的改了行：`false` 说明记录已不存在（并发删除），
   * 调用方按成功处理即可——目标状态已经成立。
   */
  async softDelete(id: string, deletedAt: Date): Promise<boolean> {
    const { count } = await this.db.userDailyRecord.updateMany({
      where: { id, ...nonDeleted },
      data: { deletedAt },
    });
    return count > 0;
  }

  async transaction<T>(fn: (tx: DailyRecords) => Promise<T>): Promise<T> {
    if (PrismaRecords.transactionAls.getStore() === true) {
      this.logger.warn(
        'Nested Prisma transaction detected — Prisma will silently degrade ' +
          'to an independent connection, losing atomicity. Move side effects ' +
          'outside the callback and ensure only DB writes that need atomicity ' +
          'are inside.',
      );
    }

    return this.prisma.$transaction((tx) =>
      PrismaRecords.transactionAls.run(true, () =>
        fn(new PrismaRecords(this.prisma, tx)),
      ),
    );
  }
}
