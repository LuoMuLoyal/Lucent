/**
 * 健康事件归属校验端口 → 应用层 Result 的适配。
 *
 * health-events 的 façade 目前**抛** `DomainFailureException`（仍是 Promise
 * 契约，reports / medicine-dose-logs 也依赖它）。本模块在边界处折回 Result，
 * 让用例内部保持不抛异常的形状。
 *
 * TODO(error): façade 改成 `ResultAsync` 后删掉这里的提取（见 docs/TODO.md
 * 「health-events ownership shim 的移除」）。
 */
import { Injectable } from '@nestjs/common';
import {
  fromPromise,
  okAsync,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { DomainFailureException } from '../../../../common/result/unwrap-result.js';
import { HealthEventOwnership } from '../ports/health-events.js';

@Injectable()
export class HealthEventLink {
  constructor(private readonly ownership: HealthEventOwnership) {}

  /** `null` 表示不关联健康事件，直接成功。 */
  requireActive(
    userId: string,
    eventId: string | null,
  ): ResultAsync<undefined, DomainFailure> {
    if (eventId == null) {
      return okAsync(undefined);
    }

    return fromPromise(
      this.ownership.ensureActive(userId, eventId),
      (error) => {
        if (error instanceof DomainFailureException) {
          return error.failure;
        }
        throw error;
      },
    ).map(() => undefined);
  }
}
