import { Injectable } from '@nestjs/common';

import type { Prisma } from '#generated/prisma/client.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { PrismaService } from '../../../../prisma/index.js';
import {
  DataExportRequests,
  type DataExportCompletion,
  type DataExportRequestRow,
  type NewDataExportRequest,
} from '../../application/ports/data-export-requests.js';

/** 读侧固定选取的列。与端点的响应字段一一对应。 */
const ROW_SELECT = {
  id: true,
  kind: true,
  format: true,
  range: true,
  status: true,
  createdAt: true,
  completedAt: true,
  downloadUrl: true,
  objectKey: true,
  fileName: true,
  fileSizeBytes: true,
  errorMessage: true,
} satisfies Prisma.DataExportRequestSelect;

/**
 * `DataExportRequests` 端口的 Prisma 实现。
 *
 * ## 只做映射
 *
 * 状态机（`pending` → `processing` → `completed`/`failed`）不在这里判定——
 * 由用例决定写什么。本类只保证两件事：
 * - 查不到返回 `null`（不是错误）；
 * - Prisma 异常折成 `DEPENDENCY_UNAVAILABLE`（依赖故障，不是业务失败）。
 */
@Injectable()
export class PrismaDataExportRequests extends DataExportRequests {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async create(input: NewDataExportRequest): Promise<DataExportRequestRow> {
    try {
      return await this.prisma.dataExportRequest.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          format: input.format,
          range: input.range,
          status: input.status,
          ...(input.errorMessage !== undefined && {
            errorMessage: input.errorMessage,
          }),
        },
        select: ROW_SELECT,
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to create data export request');
    }
  }

  async findById(id: string): Promise<DataExportRequestRow | null> {
    try {
      return await this.prisma.dataExportRequest.findUnique({
        where: { id },
        select: ROW_SELECT,
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to load data export request');
    }
  }

  async findLatestByUser(userId: string): Promise<DataExportRequestRow | null> {
    try {
      return await this.prisma.dataExportRequest.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: ROW_SELECT,
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to load latest data export request');
    }
  }

  async markProcessing(id: string): Promise<void> {
    try {
      await this.prisma.dataExportRequest.update({
        where: { id },
        data: { status: 'processing', errorMessage: null },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to mark export as processing');
    }
  }

  async complete(id: string, patch: DataExportCompletion): Promise<void> {
    try {
      await this.prisma.dataExportRequest.update({
        where: { id },
        data: {
          status: patch.status,
          ...(patch.objectKey !== undefined && { objectKey: patch.objectKey }),
          ...(patch.fileName !== undefined && { fileName: patch.fileName }),
          ...(patch.fileSizeBytes !== undefined && {
            fileSizeBytes: patch.fileSizeBytes,
          }),
          ...(patch.errorMessage !== undefined && {
            errorMessage: patch.errorMessage,
          }),
          ...(patch.completedAt !== undefined && {
            completedAt: patch.completedAt,
          }),
        },
      });
    } catch (error) {
      throw infraFailure(error, 'Failed to complete data export request');
    }
  }
}

/**
 * 把 Prisma 故障折成**真实的 Error** 抛出。
 *
 * 端口返回 Promise：失败要在应用层被 `fromPromise` + mapper 抬进 Result 通道。
 */
function infraFailure(error: unknown, context: string): Error {
  return new DomainFailureException(
    createDomainFailure({
      kind: 'dependency',
      code: 'DEPENDENCY_UNAVAILABLE',
      detail: context,
      cause: error,
    }),
  );
}
