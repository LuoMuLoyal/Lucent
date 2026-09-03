import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { buildProblemDetails, type ProblemDetails } from './problem-details.js';

/**
 * Machine-readable error-code registry (RFC 9457 Problem Details `code`).
 *
 * 本文件是全部稳定错误码的唯一事实源(与 ADR-0012 第 2 节对齐,该 ADR 定义传输契约,
 * 本文件落实现级注册表):
 * - code 一律 `SCREAMING_SNAKE_CASE`、不编码 HTTP status(允许多个 code 共享同一 status)。
 * - 每条目声明 HTTP status + i18n title/detail key + retryable 默认值;`build()` 是
 *   title/detail 的唯一 i18n 映射点(zh-CN / en 双语文案,支持 args 插值)。
 * - `ApiExceptionFilter` 的出站兜底语义:显式携带的 code 仅在「已登记且 status 匹配」
 *   (`matchesStatus`)时才采纳;否则按 status 回落默认码(400→VALIDATION_FAILED、
 *   401→AUTH_REQUIRED、403→FORBIDDEN、404→RESOURCE_NOT_FOUND、409→RESOURCE_CONFLICT、
 *   429→RATE_LIMITED、502/503/504→DEPENDENCY_*、其余→INTERNAL_ERROR)。未知异常一律
 *   INTERNAL_ERROR。行为断言见 `api-exception.target.spec.ts`。
 * - `DomainFailure`(common/result)的 `code` 与本注册表共用同一词汇;`toProblemDetails`
 *   对未登记 code 直接抛错(纯 helper 不变量),保证失败码未登记就无法出网。
 * - 新增码流程:本文件加条目 + `src/i18n/{zh-CN,en}/common.json` 补双语 key + 涉及 HTTP
 *   语义变化时 e2e 断言;删除或改 status 属 breaking change。
 *   (原 ADR-0017 追认内容并入此处:与 ADR-0012 对齐的注册表与回落规则属实现级约定,
 *   按代码同址裁决落本注释,不单独成 ADR。)
 */
const definitions = {
  AUTH_REQUIRED: {
    status: 401,
    titleKey: 'common.problem_auth_required_title',
    detailKey: 'common.problem_auth_required_detail',
    retryable: false,
  },
  AUTH_TOKEN_EXPIRED: {
    status: 401,
    titleKey: 'common.problem_auth_token_expired_title',
    detailKey: 'common.problem_auth_token_expired_detail',
    retryable: false,
  },
  AUTH_REFRESH_TOKEN_INVALID: {
    status: 401,
    titleKey: 'common.problem_auth_refresh_token_invalid_title',
    detailKey: 'common.problem_auth_refresh_token_invalid_detail',
    retryable: false,
  },
  AUTH_WRONG_PASSWORD: {
    status: 401,
    titleKey: 'common.problem_auth_wrong_password_title',
    detailKey: 'common.problem_auth_wrong_password_detail',
    retryable: false,
  },
  AUTH_PASSWORD_NOT_SET: {
    status: 401,
    titleKey: 'common.problem_auth_password_not_set_title',
    detailKey: 'common.problem_auth_password_not_set_detail',
    retryable: false,
  },
  AUTH_VERIFICATION_CODE_EXPIRED: {
    status: 400,
    titleKey: 'common.problem_auth_verification_code_expired_title',
    detailKey: 'common.problem_auth_verification_code_expired_detail',
    retryable: false,
  },
  AUTH_VERIFICATION_CODE_MISMATCH: {
    status: 400,
    titleKey: 'common.problem_auth_verification_code_mismatch_title',
    detailKey: 'common.problem_auth_verification_code_mismatch_detail',
    retryable: false,
  },
  AUTH_VERIFICATION_CODE_COOLDOWN: {
    status: 429,
    titleKey: 'common.problem_auth_verification_code_cooldown_title',
    detailKey: 'common.problem_auth_verification_code_cooldown_detail',
    retryable: true,
  },
  AUTH_OAUTH_STATE_INVALID: {
    status: 400,
    titleKey: 'common.problem_auth_oauth_state_invalid_title',
    detailKey: 'common.problem_auth_oauth_state_invalid_detail',
    retryable: false,
  },
  AUTH_OAUTH_FAILED: {
    status: 401,
    titleKey: 'common.problem_auth_oauth_failed_title',
    detailKey: 'common.problem_auth_oauth_failed_detail',
    retryable: false,
  },
  AUTH_METHOD_DISABLED: {
    status: 503,
    titleKey: 'common.problem_auth_method_disabled_title',
    detailKey: 'common.problem_auth_method_disabled_detail',
    retryable: true,
  },
  AUTH_SESSION_NOT_FOUND: {
    status: 404,
    titleKey: 'common.problem_auth_session_not_found_title',
    detailKey: 'common.problem_auth_session_not_found_detail',
    retryable: false,
  },
  AUTH_SESSION_ACCESS_DENIED: {
    status: 403,
    titleKey: 'common.problem_auth_session_access_denied_title',
    detailKey: 'common.problem_auth_session_access_denied_detail',
    retryable: false,
  },
  FORBIDDEN: {
    status: 403,
    titleKey: 'common.problem_forbidden_title',
    detailKey: 'common.problem_forbidden_detail',
    retryable: false,
  },
  VALIDATION_FAILED: {
    status: 400,
    titleKey: 'common.problem_validation_failed_title',
    detailKey: 'common.problem_validation_failed_detail',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    titleKey: 'common.problem_resource_not_found_title',
    detailKey: 'common.problem_resource_not_found_detail',
    retryable: false,
  },
  NOTIFICATION_NOT_FOUND: {
    status: 404,
    titleKey: 'common.problem_notification_not_found_title',
    detailKey: 'common.problem_notification_not_found_detail',
    retryable: false,
  },
  LEGAL_DOCUMENT_NOT_FOUND: {
    status: 404,
    titleKey: 'common.problem_legal_document_not_found_title',
    detailKey: 'common.problem_legal_document_not_found_detail',
    retryable: false,
  },
  SUGGESTION_NOT_FOUND: {
    status: 404,
    titleKey: 'common.problem_suggestion_not_found_title',
    detailKey: 'common.problem_suggestion_not_found_detail',
    retryable: false,
  },
  REPORT_SHARE_NOT_FOUND: {
    status: 404,
    titleKey: 'common.problem_report_share_not_found_title',
    detailKey: 'common.problem_report_share_not_found_detail',
    retryable: false,
  },
  RESOURCE_CONFLICT: {
    status: 409,
    titleKey: 'common.problem_resource_conflict_title',
    detailKey: 'common.problem_resource_conflict_detail',
    retryable: false,
  },
  RECORD_ALREADY_EXISTS: {
    status: 409,
    titleKey: 'common.problem_record_already_exists_title',
    detailKey: 'common.problem_record_already_exists_detail',
    retryable: false,
  },
  RATE_LIMITED: {
    status: 429,
    titleKey: 'common.problem_rate_limited_title',
    detailKey: 'common.problem_rate_limited_detail',
    retryable: true,
  },
  AUTH_LOGIN_RATE_LIMITED: {
    status: 429,
    titleKey: 'common.problem_auth_login_rate_limited_title',
    detailKey: 'common.problem_auth_login_rate_limited_detail',
    retryable: true,
  },
  AUTH_VERIFICATION_CODE_RATE_LIMITED: {
    status: 429,
    titleKey: 'common.problem_auth_verification_code_rate_limited_title',
    detailKey: 'common.problem_auth_verification_code_rate_limited_detail',
    retryable: true,
  },
  DEPENDENCY_UNAVAILABLE: {
    status: 503,
    titleKey: 'common.problem_dependency_unavailable_title',
    detailKey: 'common.problem_dependency_unavailable_detail',
    retryable: true,
  },
  DEPENDENCY_BAD_GATEWAY: {
    status: 502,
    titleKey: 'common.problem_dependency_bad_gateway_title',
    detailKey: 'common.problem_dependency_bad_gateway_detail',
    retryable: true,
  },
  DEPENDENCY_TIMEOUT: {
    status: 504,
    titleKey: 'common.problem_dependency_timeout_title',
    detailKey: 'common.problem_dependency_timeout_detail',
    retryable: true,
  },
  INTERNAL_ERROR: {
    status: 500,
    titleKey: 'common.problem_internal_error_title',
    detailKey: 'common.problem_internal_error_detail',
    retryable: false,
  },
  SERVER_SHUTDOWN: {
    status: 503,
    titleKey: 'common.problem_server_shutdown_title',
    detailKey: 'common.problem_server_shutdown_detail',
    retryable: true,
  },
  STREAM_CANCELLED: {
    status: 499,
    titleKey: 'common.problem_stream_cancelled_title',
    detailKey: 'common.problem_stream_cancelled_detail',
    retryable: false,
  },
} as const;

export type ProblemCode = keyof typeof definitions;

export interface ProblemCatalogOptions {
  lang: string;
  args?: Record<string, string | number>;
  title?: string;
  detail?: string;
  retryable?: boolean;
  errors?: Record<string, unknown>;
  retryAfter?: number;
  traceId?: string;
}

@Injectable()
export class ProblemCatalog {
  constructor(private readonly i18n: I18nService) {}

  isKnown(code: string): code is ProblemCode {
    return Object.hasOwn(definitions, code);
  }

  matchesStatus(code: string, status: number): code is ProblemCode {
    return this.isKnown(code) && definitions[code].status === status;
  }

  statusFor(code: string): number {
    if (!this.isKnown(code)) {
      throw new Error(`Unknown Problem Details code: ${code}`);
    }
    return definitions[code].status;
  }

  build(code: string, options: ProblemCatalogOptions): ProblemDetails {
    if (!this.isKnown(code)) {
      throw new Error(`Unknown Problem Details code: ${code}`);
    }
    const definition = definitions[code];

    const translate = (key: string): string => {
      const translateOptions =
        options.args == null
          ? { lang: options.lang }
          : { lang: options.lang, args: options.args };
      return this.i18n.t(key, translateOptions);
    };
    const retryable = options.retryable ?? definition.retryable;

    return buildProblemDetails({
      status: definition.status,
      code,
      title: options.title ?? translate(definition.titleKey),
      detail: options.detail ?? translate(definition.detailKey),
      retryable,
      ...(options.errors == null ? {} : { errors: options.errors }),
      ...(options.retryAfter == null ? {} : { retryAfter: options.retryAfter }),
      ...(options.traceId == null ? {} : { traceId: options.traceId }),
    });
  }
}
