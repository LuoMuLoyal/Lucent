/**
 * 读侧端口实现：跨上下文 reader port（ADR-0009）+ 餐食分析管线的载入端口。
 *
 * 三件事写在一个类里，理由：它们读的是同一张表、同一批投影列，拆成三个实现会
 * 让列选择复制三份，新增一列时必然漏掉某一份。
 *
 * 注意上限：
 * - `listFactsInRange` 最多 `MAX_READER_FACTS` 条（截断而非报错）；
 * - `listStaleAnalyzing` 单轮最多 `batchSize` 条。
 */
import { Injectable } from '@nestjs/common';
import { nonDeleted } from '../../../../common/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  DailyRecordReaderPort,
  MAX_READER_FACTS,
  type DailyRecordFact,
  type DailyRecordSummaryFact,
} from '../../application/ports/records-query.js';
import {
  toDailyRecordFactFromColumns,
  toDailyRecordSummaryFact,
} from '../../application/read_models/record-fact.js';
import { parseMealRecordPayload } from '../../domain/meal/meal-analysis.js';
import type {
  MealAnalysisCandidate,
  MealAnalyses,
  StaleMealAnalysisCandidate,
} from '../../domain/meal/meal-analyses.js';
import type { DailyRecordKind } from '../../domain/record/record-kind.js';
import {
  recordWithAttachments,
  toDbKind,
  toRecordRow,
} from './record-mapper.js';

/**
 * 事实列的显式选择：跨模块消费者**只**拿这些列。
 *
 * 为什么要显式列而不是 `include` 整行：reader port 是公共面，多带出去的列会被
 * 下游当成契约长期依赖；显式列表让「加一列给下游」变成有意识的决定。
 */
const factSelect = {
  id: true,
  kind: true,
  occurredAt: true,
  occurredTime: true,
  title: true,
  value: true,
  unit: true,
  note: true,
  payload: true,
  mealAnalysisStatus: true,
  mealAnalysisUpdatedAt: true,
  mealAnalysisFailureReason: true,
  mealHeadline: true,
  mealCalorieMin: true,
  mealCalorieMax: true,
  mealCalorieBucket: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaRecordQueries
  extends DailyRecordReaderPort
  implements Pick<MealAnalyses, 'findCandidate' | 'listStaleAnalyzing'>
{
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async listFactsInRange(
    userId: string,
    from: Date,
    to: Date,
    kinds?: DailyRecordKind[],
  ): Promise<DailyRecordFact[]> {
    const rows = await this.prisma.userDailyRecord.findMany({
      where: {
        userId,
        ...nonDeleted,
        occurredAt: { gte: from, lte: to },
        ...(kinds != null && kinds.length > 0
          ? { kind: { in: kinds.map(toDbKind) } }
          : {}),
      },
      select: factSelect,
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      take: MAX_READER_FACTS,
    });

    return rows.map(toDailyRecordFactFromColumns);
  }

  async countFactsInRange(
    userId: string,
    from: Date,
    to: Date,
    kinds?: DailyRecordKind[],
  ): Promise<number> {
    return this.prisma.userDailyRecord.count({
      where: {
        userId,
        ...nonDeleted,
        occurredAt: { gte: from, lte: to },
        ...(kinds != null && kinds.length > 0
          ? { kind: { in: kinds.map(toDbKind) } }
          : {}),
      },
    });
  }

  async findLatestCreatedAtInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<Date | null> {
    const row = await this.prisma.userDailyRecord.findFirst({
      where: { userId, ...nonDeleted, occurredAt: { gte: from, lte: to } },
      select: { createdAt: true },
      orderBy: [{ createdAt: 'desc' }],
    });
    return row?.createdAt ?? null;
  }

  async findById(
    userId: string,
    id: string,
  ): Promise<DailyRecordSummaryFact | null> {
    const row = await this.prisma.userDailyRecord.findFirst({
      where: { id, userId, ...nonDeleted },
      include: recordWithAttachments,
    });
    return row == null ? null : toDailyRecordSummaryFact(toRecordRow(row));
  }

  /**
   * 餐食分析管线的载入：一条记录 + 附件对象键 + 用户语言。
   *
   * 语言从用户的 profile 取（分析结果按它生成文案并随分析落库），所以这里一次
   * 查询带上 profile，而不是让应用层再发一次跨表查询。
   */
  async findCandidate(recordId: string): Promise<MealAnalysisCandidate | null> {
    const row = await this.prisma.userDailyRecord.findFirst({
      where: { id: recordId, kind: toDbKind('meal'), ...nonDeleted },
      include: {
        attachments: { orderBy: { createdAt: 'asc' } },
        user: { select: { profile: { select: { locale: true } } } },
      },
    });
    if (row == null) {
      return null;
    }

    const analysis = parseMealRecordPayload(row.payload).mealAnalysis ?? null;
    return {
      id: row.id,
      userId: row.userId,
      attachmentObjectKeys: row.attachments.map(
        (attachment) => attachment.objectKey,
      ),
      sourceRevision: row.mealSourceRevision,
      locale: row.user.profile?.locale ?? null,
      analysis,
    };
  }

  async listStaleAnalyzing(
    staleBefore: Date,
    batchSize: number,
  ): Promise<StaleMealAnalysisCandidate[]> {
    const rows = await this.prisma.userDailyRecord.findMany({
      where: {
        kind: toDbKind('meal'),
        ...nonDeleted,
        mealAnalysisStatus: 'analyzing',
        updatedAt: { lt: staleBefore },
      },
      select: { id: true, userId: true, payload: true },
      take: batchSize,
    });

    return rows.map((row) => {
      const analysis = parseMealRecordPayload(row.payload).mealAnalysis ?? null;
      return {
        id: row.id,
        userId: row.userId,
        sourceRevision: analysis?.sourceRevision ?? 0,
        locale: analysis?.locale ?? null,
      };
    });
  }
}
