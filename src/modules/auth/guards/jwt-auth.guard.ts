import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { createDomainFailure } from '../../../common/result';
import { DomainFailureException } from '../../../common/result/unwrap-result';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * JWT Access Token Guard
 *
 * 使用方式：
 *  @UseGuards(JwtAuthGuard)
 *  @Controller('protected')
 *  class ProtectedController {}
 *
 * 验证通过后，request.user 将包含 { sub, email }。
 *
 * 使用 @Public() 装饰器可跳过认证：
 *  @Public()
 *  @Get('public-route')
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }

  /**
   * Transport boundary: no token, expired token and signature failures are
   * converted into a `DomainFailureException` (internal bridge only, not a
   * public error type) that the global filter renders as `AUTH_REQUIRED` or
   * `AUTH_TOKEN_EXPIRED` Problem Details. No Result is returned to Passport.
   */
  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: { name?: string } | undefined,
  ): TUser {
    if (info?.name === 'TokenExpiredError') {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_TOKEN_EXPIRED',
        }),
      );
    }

    if (err || !user) {
      throw new DomainFailureException(
        createDomainFailure({
          kind: 'authentication',
          code: 'AUTH_REQUIRED',
        }),
      );
    }

    return user;
  }
}
