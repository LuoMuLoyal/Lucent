import { unauthorized } from '../../../common/utils/api-errors';
import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ConfigKey } from '../../../config/config-keys.enum';
import { UserPayload } from '../auth.service';

interface JwtConfigShape {
  accessSecret: string;
  accessTtl: number;
  refreshSecret: string;
  refreshTtl: number;
}

/**
 * JWT Access Token 策略
 * 从 Authorization: Bearer <token> 头提取 JWT，
 * 使用 accessSecret + HS512 验签。
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    const jwtConfig = configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtConfig.accessSecret,
      algorithms: ['HS512'],
    });
  }

  /**
   * Passport 验签成功后调用。
   * 返回值会挂载到 request.user。
   */
  validate(payload: UserPayload): UserPayload {
    if (!payload.sub) {
      unauthorized('无效的 access token');
    }
    return payload;
  }
}
