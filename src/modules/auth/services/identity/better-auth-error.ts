import {
  createDomainFailure,
  fromPromise,
  mapUnknownToDependencyFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';

/**
 * Shared mapping layer between Better Auth (`auth.api.*`) errors and Lucent
 * Problem Details DomainFailures.
 *
 * Both `CredentialAuthService` and `PasswordManagementService` wrap Better Auth
 * calls, and both must map response codes identically. Home any new Better Auth
 * error code here so a single mapping block can never drift between the two
 * consumers.
 *
 * ## Business invariant (anti-enumeration)
 *
 * Credential-level failures MUST stay inside the anti-enumeration bucket
 * (`createDomainFailure` of `kind: 'authentication'` / `AUTH_WRONG_PASSWORD`) and
 * MUST NOT reveal whether an account exists, whether it has a password, or
 * whether a supplied code was valid. By contrast, unknown 5xx responses are
 * **not** credentials failures — they are dependency outages and are mapped to
 * `DEPENDENCY_UNAVAILABLE`. This split is a security guarantee, not a taste
 * preference: never fold unknown 5xx into the anti-enumeration bucket, and
 * never leak an unknown 4xx as anything but the generic credential failure.
 */

/** Narrow subset of Better Auth / better-call API errors we intentionally map. */
export interface BetterAuthAPIError {
  statusCode: number;
  body?: {
    code?: string;
    message?: string;
  };
}

export function isBetterAuthAPIError(
  error: unknown,
): error is BetterAuthAPIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  );
}

/**
 * Maps Better Auth API error codes to Lucent Problem Details DomainFailures.
 *
 * Known codes are handled explicitly; unknown 4xx responses fold into the
 * anti-enumeration bucket (`credentialsInvalidFailure`), unknown 5xx responses
 * become `DEPENDENCY_UNAVAILABLE` (see the business invariant above).
 */
export function mapBetterAuthError(error: BetterAuthAPIError): DomainFailure {
  const code = error.body?.code;
  switch (code) {
    // Anti-enumeration bucket: never reveal whether the account exists,
    // whether it has a password, or whether the email is registered.
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'USER_NOT_FOUND':
    case 'INVALID_PASSWORD':
    case 'INVALID_EMAIL':
    case 'USER_EMAIL_NOT_FOUND':
    case 'ACCOUNT_NOT_FOUND':
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
    case 'EMAIL_NOT_VERIFIED':
      return credentialsInvalidFailure();
    case 'USER_ALREADY_HAS_PASSWORD':
    case 'PASSWORD_ALREADY_SET':
      return createDomainFailure({
        kind: 'conflict',
        code: 'RESOURCE_CONFLICT',
      });
    case 'EMAIL_CAN_NOT_BE_UPDATED':
    case 'CHANGE_EMAIL_DISABLED':
      return createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
      });
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return createDomainFailure({
        kind: 'authentication',
        code: 'AUTH_VERIFICATION_CODE_EXPIRED',
      });
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG':
    case 'VALIDATION_ERROR':
    case 'MISSING_FIELD':
      return createDomainFailure({
        kind: 'validation',
        code: 'VALIDATION_FAILED',
      });
    // Configuration/disabled errors: the method is unavailable, not an
    // internal crash. Map to a non-500 dependency failure.
    case 'EMAIL_PASSWORD_SIGN_UP_DISABLED':
    case 'EMAIL_PASSWORD_DISABLED':
    case 'RESET_PASSWORD_DISABLED':
    case 'VERIFICATION_EMAIL_NOT_ENABLED':
      return createDomainFailure({
        kind: 'dependency',
        code: 'AUTH_METHOD_DISABLED',
      });
    default:
      if (error.statusCode >= 500) {
        return createDomainFailure({
          kind: 'dependency',
          code: 'DEPENDENCY_UNAVAILABLE',
        });
      }
      return credentialsInvalidFailure();
  }
}

/** Unified anti-enumeration failure shared by every credential flow. */
export function credentialsInvalidFailure(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_WRONG_PASSWORD',
  });
}

/**
 * Wraps a Better Auth `auth.api.*` promise into a `ResultAsync` and maps every
 * Better Auth API error to a Lucent `DomainFailure`.  Non-Better Auth
 * exceptions (e.g. DB/network) are mapped to `DEPENDENCY_UNAVAILABLE` so they
 * surface through the Result instead of becoming unhandled rejections.
 *
 * @param context - Human-readable operation name used as the `detail` when a
 *   non-Better-Auth dependency failure is produced (e.g. `'Better Auth call
 *   failed'`). Passed in by the caller so the source stays unambiguous.
 */
export function fromBetterAuth<T>(
  promise: Promise<T>,
  context: string,
): ResultAsync<T, DomainFailure> {
  return fromPromise(promise, (error) => {
    if (isBetterAuthAPIError(error)) {
      return mapBetterAuthError(error);
    }
    return mapUnknownToDependencyFailure(error, context);
  });
}
