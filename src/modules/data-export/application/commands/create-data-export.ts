/**
 * 创建导出请求的**应用层命令** —— 不复用 HTTP 层的 zod 输出类型。
 *
 * `application/` 不得依赖 `adapters/`（`arch:check` 的
 * `ddd-application-no-infra-or-adapters` 会拦）。投递层把校验过的请求体映射成
 * 这个形状；字段一致是**当前需求的巧合**，不是耦合的借口。
 */
export interface CreateDataExportCommand {
  /** 二次确认凭据（敏感操作要求重验密码）。 */
  password: string;
  /** 报表类型：`hospital`（默认）/ `monthly` / `print`。 */
  kind?: string;
  /** 文件格式，目前只有 `pdf`。 */
  format?: string;
  /** 时间范围：`last_7_days`（默认）/ `last_30_days`。 */
  range?: string;
}

/** 导出请求的响应形状（应用层投影，投递层再序列化）。 */
export interface DataExportResult {
  id: string;
  kind: string;
  format: string;
  range: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  downloadUrl: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
}
