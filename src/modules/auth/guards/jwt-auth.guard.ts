import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { I18nContext } from 'nestjs-i18n';
import { ResultCode } from '../../../common/api-envelope';

/**
 * JWT Access Token Guard
 *
 * 使用方式：
 *  @UseGuards(JwtAuthGuard)
 *  @Controller('protected')
 *  class ProtectedController {}
 *
 * 验证通过后，request.user 将包含 { sub, email }。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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
      throw new UnauthorizedException({
        code: ResultCode.UNAUTHORIZED,
        message:
          i18n?.t('auth.access_token_invalid') ??
          'Invalid or missing access token',
      });
    }

    return user;
  }
}
