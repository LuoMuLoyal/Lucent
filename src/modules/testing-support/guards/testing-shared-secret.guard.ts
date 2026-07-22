import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import { safeCompare } from '../../../common/helpers/crypto.utils';
import { EnvKey } from '../../../config/env-keys.enum';

/**
 * Guards testing-only endpoints with a shared secret header.
 *
 * Requires `TESTING_SHARED_SECRET` env var to be set. The client must send
 * the secret in the `x-testing-secret` header. Comparison uses
 * `timingSafeEqual` to prevent timing side-channels.
 *
 * This guard should always be used alongside `JwtAuthGuard` so that
 * testing endpoints require both authentication and the shared secret.
 */
@Injectable()
export class TestingSharedSecretGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    private readonly i18n: I18nService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>(
      EnvKey.TESTING_SHARED_SECRET,
    );
    if (!expected) {
      throw new ForbiddenException(
        this.i18n.t('common.invalid_testing_secret'),
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = request.headers['x-testing-secret'];

    if (typeof provided !== 'string' || !provided) {
      throw new ForbiddenException(
        this.i18n.t('common.invalid_testing_secret'),
      );
    }

    if (!safeCompare(provided, expected)) {
      throw new ForbiddenException(
        this.i18n.t('common.invalid_testing_secret'),
      );
    }

    return true;
  }
}
