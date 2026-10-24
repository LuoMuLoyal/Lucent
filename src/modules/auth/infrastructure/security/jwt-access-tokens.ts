import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';

import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import {
  AccessTokens,
  type AccessTokenRequest,
} from '../../application/ports/access-tokens.js';

/** jti 的随机字节数。16 字节足够唯一，且不撑大 token。 */
const JWT_ID_BYTES = 16;

interface JwtConfigShape {
  accessSecret: string;
  issuer: string;
  audience: string;
}

/**
 * `AccessTokens` 端口的 JWT 实现。
 *
 * ## 配置与验证端必须同源
 *
 * `secret` / `issuer` / `audience` / 算法全部取自 `ConfigKey.Jwt`——
 * `JwtAccessStrategy` 读的是同一份配置。任何一侧单独改，token 立刻全班失效，
 * 这是刻意的：那种改动不可能「只生效一半」。
 *
 * ## TTL 由调用方给
 *
 * 端点本身不读 TTL：TTL 可能来自运行期快照（`RuntimeConfigService`），
 * 而那是应用层的决议。这里只负责「用你给的 TTL 签」。
 *
 * ## 失败语义
 *
 * 签名失败原样抛出，由调用方映射为 `INTERNAL_ERROR`——绝不折叠成凭据错误。
 */
@Injectable()
export class JwtAccessTokens extends AccessTokens {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async sign(request: AccessTokenRequest): Promise<string> {
    const config = this.configService.getOrThrow<JwtConfigShape>(ConfigKey.Jwt);
    return await this.jwtService.signAsync(
      {
        sub: request.subject.userId,
        email: request.subject.email,
        status: request.subject.status,
      },
      {
        secret: config.accessSecret,
        expiresIn: request.ttlSeconds,
        algorithm: 'HS512',
        jwtid: randomBytes(JWT_ID_BYTES).toString('hex'),
        issuer: config.issuer,
        audience: config.audience,
      },
    );
  }
}
