import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import { buildProblemDetails, type ProblemDetails } from './problem-details';

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
  AUTH_ELEVATION_REQUIRED: {
    status: 403,
    titleKey: 'common.problem_auth_elevation_required_title',
    detailKey: 'common.problem_auth_elevation_required_detail',
    retryable: false,
  },
  AUTH_ELEVATION_TOKEN_INVALID: {
    status: 403,
    titleKey: 'common.problem_auth_elevation_token_invalid_title',
    detailKey: 'common.problem_auth_elevation_token_invalid_detail',
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
    return Object.prototype.hasOwnProperty.call(definitions, code);
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
