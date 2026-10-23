import { Injectable } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { FastifyRequest } from 'fastify';

import { ConfigKey } from '../../../config/env/config-keys.enum.js';
import { SESSION_COOKIE_NAME } from '../domain/session/cookie_policy.js';
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
 * 从 `Authorization: Bearer <token>` **或** HttpOnly 会话 cookie 里取 access token。
 *
 * 两种来源并存是刻意的：
 * - 手机端（Luminous）发 Bearer，token 由客户端自己保管；
 * - Web / 桌面端（Lumine）走 httpOnly cookie，脚本读不到 token。
 *
 * 保留 Bearer 让既有客户端与调试手段（curl、Swagger）不必为了多一个客户端而改；
 * cookie 回退只在 Bearer 缺席时生效，不会覆盖显式的凭据。
 *
 * @param request 当前请求（Fastify）。
 */
function extractAccessToken(request: FastifyRequest): string | null {
  const header = ExtractJwt.fromAuthHeaderAsBearerToken()(request);
  if (header) return header;

  return request.cookies[SESSION_COOKIE_NAME] ?? null;
}

/**
 * JWT Access Token 策略
 * 从 Authorization 头或会话 cookie 提取 JWT，
 * 使用 accessSecret + HS512 验签。
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    const jwtConfig = configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
    super({
      jwtFromRequest: extractAccessToken,
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
