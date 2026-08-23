import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SecurityPinService } from '../services/pin.service';
import { REQUIRE_SECURITY_ELEVATION_KEY } from '../decorators/require-elevation.decorator';
import { createDomainFailure, unwrapResult } from '../../../common/result';
import { DomainFailureException } from '../../../common/result/unwrap-result';
import type { UserPayload } from '../../auth';
import type { SecurityElevationPayload } from '../types/elevation.types';

interface ElevatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user: UserPayload;
  securityElevation?: SecurityElevationPayload;
}

/**
 * Enforces a recent Security PIN verification for routes marked with
 * @RequireSecurityElevation(). The elevation token is read from the
 * x-security-elevation header as a Bearer token.
 *
 * This guard is an HTTP transport boundary: it folds the pin service's
 * `ResultAsync` and throws a `DomainFailureException` (internal bridge only)
 * that the global filter renders as Problem Details. No Result is returned to
 * the Nest guard pipeline. Missing token / missing user stay transport-level
 * `AUTH_ELEVATION_TOKEN_INVALID` / `AUTH_REQUIRED`; unknown service errors
 * (DB, signing, config) propagate unchanged instead of being disguised as an
 * elevation failure.
 */
@Injectable()
export class SecurityElevationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly securityPinService: SecurityPinService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_SECURITY_ELEVATION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<ElevatedRequest>();
    const user = request.user;
    if (!user.sub) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_REQUIRED',
        }),
      );
    }

    const token = this.extractBearerToken(
      request.headers['x-security-elevation'],
    );
    if (!token) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_ELEVATION_TOKEN_INVALID',
        }),
      );
    }

    request.securityElevation = await unwrapResult(
      this.securityPinService.verifyElevationToken(token, user.sub),
    );
    return true;
  }

  private extractBearerToken(
    header: string | string[] | undefined,
  ): string | null {
    if (typeof header !== 'string') {
      return null;
    }
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1] ?? null;
  }
}
