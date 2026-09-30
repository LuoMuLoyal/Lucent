import {
  createDomainFailure,
  type DomainFailure,
} from '../../../../common/result/index.js';

/**
 * Unified anti-enumeration failure shared by every credential flow.
 *
 * ## Business invariant (anti-enumeration)
 *
 * Credential-level failures MUST stay inside this bucket (`kind:
 * 'authentication'` / `AUTH_WRONG_PASSWORD`) and MUST NOT reveal whether an
 * account exists, whether it has a password, or whether a supplied code was
 * valid. By contrast, dependency outages are mapped to `DEPENDENCY_UNAVAILABLE`
 * by their callers. This split is a security guarantee, not a taste
 * preference: never fold an outage into the anti-enumeration bucket, and never
 * leak anything other than this generic failure for a credential mismatch.
 */
export function credentialsInvalidFailure(): DomainFailure {
  return createDomainFailure({
    kind: 'authentication',
    code: 'AUTH_WRONG_PASSWORD',
  });
}
