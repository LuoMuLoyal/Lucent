import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { I18nContext } from 'nestjs-i18n';

import { SecurityPinService } from '../services/pin.service';
import { REQUIRE_SECURITY_ELEVATION_KEY } from '../decorators/require-elevation.decorator';
import type { UserPayload } from '../../auth/services/auth.service';
import type { SecurityElevationPayload } from '../types/elevation.types';
import { ResultCode } from '../../../common/api';

interface ElevatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user: UserPayload;
  securityElevation?: SecurityElevationPayload;
}

/**
 * Enforces a recent Security PIN verification for routes marked with
 * @RequireSecurityElevation(). The elevation token is read from the
 * x-security-elevation header as a Bearer token.
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
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.t('auth.access_token_invalid'),
      });
    }

    const token = this.extractBearerToken(
      request.headers['x-security-elevation'],
    );
    if (!token) {
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message: this.t('security_pin.elevation_token_invalid'),
      });
    }

    const payload = await this.securityPinService.verifyElevationToken(
      token,
      user.sub,
    );
    request.securityElevation = payload;
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

  private t(key: string): string {
    return I18nContext.current()?.t(key) ?? key;
  }
}
