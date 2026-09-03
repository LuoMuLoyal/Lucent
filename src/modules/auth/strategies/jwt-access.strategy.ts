import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { ConfigKey } from '../../../config/env/config-keys.enum.js';
import { createDomainFailure } from '../../../common/result/index.js';
import { DomainFailureException } from '../../../common/result/unwrap-result.js';
import { UserPayload } from '../services/auth.service.js';

interface JwtConfigShape {
  accessSecret: string;
  accessTtl: number;
  refreshSecret: string;
  refreshTtl: number;
  issuer: string;
  audience: string;
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
      issuer: jwtConfig.issuer,
      audience: jwtConfig.audience,
    });
  }

  /**
   * Passport 验签成功后调用。
   * 返回值会挂载到 request.user。
   *
   * 安全检查：拒绝非 active 用户的 token（suspended / deleted）。
   * 失败在此 transport boundary 抛出 DomainFailureException（filter 内部桥接），
   * 由全局 filter 输出 AUTH_REQUIRED Problem Details。
   */
  validate(payload: UserPayload): UserPayload {
    if (!payload.sub) {
      throw this.authRequiredFailure();
    }
    if (payload.status !== 'active') {
      throw this.authRequiredFailure();
    }
    return payload;
  }

  private authRequiredFailure(): DomainFailureException {
    return new DomainFailureException(
      createDomainFailure({
        kind: 'authentication',
        code: 'AUTH_REQUIRED',
      }),
    );
  }
}
