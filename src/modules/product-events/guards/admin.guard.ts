import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeCompare } from '../../../common';
import { EnvKey } from '../../../config/env/env-keys.enum';
import type { UserPayload } from '../../auth';

/**
 * Internal-admin guard for the product measurement funnel endpoint.
 *
 * The repo has no role column and no API admin guard — the only admin identity
 * is the `ADMIN_EMAIL` env credential shared with the AdminJS panel
 * (`src/admin`). This guard reuses exactly that identity: a valid JWT whose
 * email constant-time matches `ADMIN_EMAIL` is treated as the internal admin.
 *
 * Must run AFTER `JwtAuthGuard` (registered as a global APP_GUARD) so
 * `request.user` is populated: missing user → 401, non-admin email → 403.
 * The guarded surface never exposes per-user event lists — aggregation only.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: UserPayload }>();
    const user = request.user;
    if (user == null) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Admin access requires an authenticated user',
      });
    }

    const adminEmail = this.configService.get<string>(EnvKey.ADMIN_EMAIL);
    if (
      adminEmail == null ||
      user.email == null ||
      !safeCompare(user.email, adminEmail)
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return true;
  }
}
