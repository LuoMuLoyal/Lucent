import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { ConfigKey } from '../../../config/env/config-keys.enum.js';

interface JwtConfigShape {
  accessSecret: string;
  issuer: string;
  audience: string;
}

/** Access token 里我们关心的字段。 */
export interface AccessTokenPayload {
  sub: string;
}

/**
 * 校验**本服务自己刚签发的** access token 并取出 `sub`。
 *
 * ## 这不是一个鉴权入口
 *
 * 鉴权由 `JwtAccessStrategy`（passport）负责，覆盖所有需要 `Authorization`
 * 或 session cookie 的端点。这里存在的唯一理由是：
 * **cookie 会话的 refresh 端点在轮换后需要知道「这次会话属于谁」**，
 * 而它手上只有新签发的 token 串。
 *
 * 之所以不做成 `refreshToken → user` 的映射，是因为 refresh token 在
 * `AuthTokenService.generateTokenPair` 里是 `randomBytes(32).hex` —— **不透明随机串，
 * 不是 JWT**。access token 才是 JWT，解它的 `sub` 是拿到用户 id 最直接的方式。
 *
 * 验签是防御性的：token 刚由本进程签发，不验也不影响正确性；但验一次能把
 * 「载荷结构不符合预期」变成明确失败，而不是静默返回错数据。
 */
@Injectable()
export class AccessTokenReader {
  private readonly logger = new Logger(AccessTokenReader.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * @param token access token（JWT）。
   * @returns 验签通过且带 `sub` 时的载荷；否则 `null`。
   */
  read(token: string): AccessTokenPayload | null {
    const config = this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);

    try {
      const payload = this.jwtService.verify<AccessTokenPayload>(token, {
        secret: config.accessSecret,
        algorithms: ['HS512'],
        issuer: config.issuer,
        audience: config.audience,
      });

      if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
        this.logger.warn('Access token payload is missing a usable `sub`');
        return null;
      }

      return { sub: payload.sub };
    } catch (error) {
      // 过期、篡改、密钥轮换都走这里。统一返回 null，由调用方映射成
      // AUTH_REFRESH_TOKEN_INVALID —— 区分「过期」与「伪造」对外没有用处。
      //
      // 这里**只**记原因不记 token：它虽由本进程签发，但仍是凭据。
      this.logger.warn(
        `Access token failed verification after rotation: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
