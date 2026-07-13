import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
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
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.configService.get<string>(
      EnvKey.TESTING_SHARED_SECRET,
    );
    if (!expected) {
      throw new ForbiddenException(
        'TESTING_SHARED_SECRET is not configured; testing endpoints are disabled',
      );
    }

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const provided = request.headers['x-testing-secret'];

    if (typeof provided !== 'string' || !provided) {
      throw new ForbiddenException('Missing x-testing-secret header');
    }

    if (!safeCompare(provided, expected)) {
      throw new ForbiddenException('Invalid testing secret');
    }

    return true;
  }
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
