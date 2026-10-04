import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Thrown when an LLM-backed feature is requested but the deployment has no
 * model configured for the role that feature needs.
 *
 * This is deliberately *not* a plain `ServiceUnavailableException`. Both share
 * HTTP 503, but they mean opposite things to a caller:
 *
 * - `DEPENDENCY_UNAVAILABLE` — a configured dependency failed at runtime (rate
 *   limit, upstream 5xx, circuit breaker open). Retrying later may work.
 * - `LLM_NOT_CONFIGURED` — this deployment never had the model for that role.
 *   Retrying can never work; an operator has to configure it.
 *
 * Before this class existed, both arrived as `DEPENDENCY_UNAVAILABLE`, so a
 * client could only say "service unavailable" for a permanent configuration
 * gap — see `docs/TODO.md`「AI 未配置与运行时失败不可区分」.
 *
 * Two deliberate choices about the payload:
 *
 * - The `code` is what `ApiExceptionFilter.resolveCode` reads; it adopts an
 *   explicit code only when it is registered and its status matches.
 * - **No `message` is set.** `resolveDetail` falls back to `raw.message`, so a
 *   diagnostic sentence here would be sent to the client verbatim, bypassing
 *   the registered bilingual copy. The role stays in `cause` for logs only.
 */
export class LlmNotConfiguredException extends ServiceUnavailableException {
  constructor(role: string, cause?: unknown) {
    super({ statusCode: 503, code: 'LLM_NOT_CONFIGURED' });
    this.cause = `LLM role "${role}" is not configured`;
    if (cause !== undefined) {
      this.cause = { reason: this.cause, cause };
    }
  }
}
