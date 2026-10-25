/**
 * 领域失败 / 基础设施失败的构造器（应用层共用）。
 *
 * 应用层对外只返回 `ResultAsync<T, DomainFailure>`（ADR-0012）：可预期的失败
 * （未找到、越权、校验不过、依赖不可用）都在这里收敛成稳定的 `code`，
 * 让 `ProblemCatalog` 与客户端 l10n 拿到的是码而不是异常文本。
 */
import {
  createDomainFailure,
  type DomainFailure,
} from '../../../../common/result/index.js';

/** 记录不存在。**也用于「存在但属于别人」**：不泄漏记录是否存在（IDOR）。 */
export function recordNotFound(): DomainFailure {
  return createDomainFailure({ kind: 'not_found', code: 'RESOURCE_NOT_FOUND' });
}

/** 校验失败（payload 形状 / 终态不合法）。 */
export function validationFailed(): DomainFailure {
  return createDomainFailure({ kind: 'validation', code: 'VALIDATION_FAILED' });
}

/** 依赖不可用（存储、模型、队列配置缺失）。 */
export function dependencyUnavailable(): DomainFailure {
  return createDomainFailure({
    kind: 'dependency',
    code: 'DEPENDENCY_UNAVAILABLE',
  });
}

/**
 * 归属校验失败（越权）。
 *
 * 写路径**不**把这条直接回给客户端：`RESOURCE_NOT_FOUND` 与 `FORBIDDEN` 的差异
 * 本身就是一次存在性探测。只有健康事件关联校验沿用上游 façade 的既有语义
 * （403），因为那里泄漏的是「事件存在但属于别人」，不是记录本身。
 */
export function forbidden(): DomainFailure {
  return createDomainFailure({ kind: 'authorization', code: 'FORBIDDEN' });
}
