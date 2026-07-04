import { unauthorized } from '../../../common/helpers/api-errors';
import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { I18nContext } from 'nestjs-i18n';
import { ResultCode } from '../../../common/api-envelope';
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

  override handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: { name?: string } | undefined,
  ): TUser {
    const i18n = I18nContext.current();

    if (info?.name === 'TokenExpiredError') {
      throw new UnauthorizedException({
        code: ResultCode.TOKEN_EXPIRED,
        message: i18n?.t('auth.access_token_expired') ?? 'Access token expired',
      });
    }

    if (err || !user) {
      unauthorized(
        i18n?.t('auth.access_token_invalid') ??
          'Invalid or missing access token',
      );
    }

    return user;
  }
}
