import { Injectable, Logger } from '@nestjs/common';

import {
  fromPromise,
  mapUnknownToDependencyFailure,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import {
  createDomainFailure,
  DomainFailureException,
} from '../../../../common/result/index.js';
import { PasswordReauthService } from '../../../auth/index.js';
import {
  DataExportRequests,
  type DataExportRequestRow,
} from '../ports/data-export-requests.js';
import type {
  CreateDataExportCommand,
  DataExportResult,
} from '../commands/create-data-export.js';
import { ObjectStorage } from '../ports/object-storage.js';
import { ExportQueue } from '../ports/export-queue.js';
import { ProcessExport } from './process-export.js';

const DEFAULT_EXPORT_RANGE = 'last_7_days';
const MONTHLY_EXPORT_RANGE = 'last_30_days';

/**
 * 创建导出请求并派发处理 —— 应用用例。
 *
 * ## 分层
 *
 * 它只编排：密码重验 → 建行 → 入队或回退同步处理 → 投影成响应。所有 IO
 * 走端口（`DataExportRequests` / `ObjectStorage` / `ExportQueue`），
 * **不 import Prisma、不 import infrastructure**（`arch:check` 会拦）。
 *
 * ## 名字的边界
 *
 * 尽管模块叫 `data-export`，这里**不导出原始用户数据**：它生成的是聚合报表
 * PDF（经 `ProcessExport` → reports 的 dashboard）。如果将来真要 GDPR 式的
 * 原始数据导出，那应该是一个独立模块，不是这条报表流水线。
 *
 * ## 两条降级路径（原行为，保留）
 *
 * - **存储未配置** → 落一行 `unavailable` 并正常返回（这是文档化契约，不是错误）；
 * - **队列不可用 / 入队被拒（Redis 断）** → 同步内联处理，任务不丢。
 *   内联失败会向上抛（处理器已写 `failed` 状态，语义是队列重试而非 HTTP 重试）。
 */
@Injectable()
export class CreateDataExportRequest {
  private readonly logger = new Logger(CreateDataExportRequest.name);

  constructor(
    private readonly requests: DataExportRequests,
    private readonly storage: ObjectStorage,
    private readonly queue: ExportQueue,
    private readonly processExport: ProcessExport,
    private readonly passwordReauthService: PasswordReauthService,
  ) {}

  execute(
    userId: string,
    dto: CreateDataExportCommand,
    language: string,
  ): ResultAsync<DataExportResult, DomainFailure> {
    return this.passwordReauthService
      .verify(userId, dto.password)
      .andThen(() => this.createAfterReauth(userId, dto, language));
  }

  /** 取该用户最近一条请求（`null` = 从未导出过）。 */
  latest(userId: string): ResultAsync<DataExportResult | null, DomainFailure> {
    return fromPromise(this.requests.findLatestByUser(userId), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load export'),
    ).andThen((row) => (row != null ? this.toDto(row) : okAsync(null)));
  }

  private createAfterReauth(
    userId: string,
    dto: CreateDataExportCommand,
    language: string,
  ): ResultAsync<DataExportResult, DomainFailure> {
    const kind = dto.kind ?? 'hospital';
    const format = dto.format ?? 'pdf';
    const requestedRange = dto.range ?? DEFAULT_EXPORT_RANGE;
    const effectiveRange =
      kind === 'monthly' ? MONTHLY_EXPORT_RANGE : requestedRange;

    if (!this.storage.isConfigured()) {
      return fromPromise(
        this.requests.create({
          userId,
          kind,
          format,
          range: effectiveRange,
          status: 'unavailable',
          errorMessage: 'Object storage is not configured',
        }),
        (error) =>
          mapUnknownToDependencyFailure(error, 'Failed to create export'),
      ).andThen((created) => this.toDto(created));
    }

    return fromPromise(
      this.requests.create({
        userId,
        kind,
        format,
        range: effectiveRange,
        status: 'pending',
      }),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to create export'),
    ).andThen((created) =>
      this.dispatchOrProcessInline(created, userId, language),
    );
  }

  /**
   * 入队；队列不可用或入队被拒时回退同步处理。
   *
   * 「入队被拒」是真实场景：Redis 配置了但连不上。回退保证任务不丢，
   * 代价是请求变慢——原实现就是这个取舍，保留。
   */
  private dispatchOrProcessInline(
    created: DataExportRequestRow,
    userId: string,
    language: string,
  ): ResultAsync<DataExportResult, DomainFailure> {
    if (!this.queue.isConfigured) {
      return this.processInline(created, userId, language);
    }

    const work = (async (): Promise<DataExportRequestRow> => {
      try {
        await this.queue.enqueue({
          exportRequestId: created.id,
          userId,
          language,
        });
        return created;
      } catch (error) {
        this.logger.error(
          `Failed to enqueue data export ${created.id}, processing inline: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.processExport.process({
          exportRequestId: created.id,
          userId,
          language,
        });
        return this.reloadOrThrow(created.id);
      }
    })();

    return fromPromise(work, (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to dispatch export'),
    ).andThen((row) => this.toDto(row));
  }

  /** 同步内联处理（队列不可用时的兜底）。 */
  private processInline(
    created: DataExportRequestRow,
    userId: string,
    language: string,
  ): ResultAsync<DataExportResult, DomainFailure> {
    const work = (async (): Promise<DataExportRequestRow> => {
      await this.processExport.process({
        exportRequestId: created.id,
        userId,
        language,
      });
      return this.reloadOrThrow(created.id);
    })();

    return fromPromise(work, (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to process export inline'),
    ).andThen((row) => this.toDto(row));
  }

  private async reloadOrThrow(id: string): Promise<DataExportRequestRow> {
    const row = await this.requests.findById(id);
    if (row === null) {
      // 行在派发与回读之间消失（保留任务清理）——依赖故障，不是业务失败。
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
          detail: 'Export request disappeared before reload',
        }),
      );
    }
    return row;
  }

  private toDto(
    row: DataExportRequestRow,
  ): ResultAsync<DataExportResult, DomainFailure> {
    const downloadUrlResult =
      row.downloadUrl != null
        ? okAsync<string | null, DomainFailure>(row.downloadUrl)
        : this.storage.createDownloadUrl(row.objectKey);

    return downloadUrlResult.map(
      (downloadUrl) =>
        ({
          id: row.id,
          kind: row.kind,
          format: row.format,
          range: row.range,
          status: row.status,
          requestedAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          downloadUrl,
          fileName: row.fileName,
          fileSizeBytes: row.fileSizeBytes,
          errorMessage: row.errorMessage,
        }) satisfies DataExportResult,
    );
  }
}
