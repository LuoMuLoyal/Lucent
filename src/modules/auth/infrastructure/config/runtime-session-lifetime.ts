import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ConfigKey } from '../../../../config/env/config-keys.enum.js';
import { EnvKey } from '../../../../config/env/env-keys.enum.js';
import { RuntimeConfigService } from '../../../../config/runtime/runtime-config.service.js';
import type { RuntimeConfigPort } from '../../../../config/runtime/runtime-config.types.js';
import { SessionLifetime } from '../../application/ports/session-lifetime.js';

interface JwtTtlShape {
  accessTtl: number;
  refreshTtl: number;
}

/**
 * `SessionLifetime` 端口的实现：环境变量基线 + 运行期快照覆盖。
 *
 * ## 为什么每次签发都重新解析
 *
 * 运行期发布的新 TTL 应当作用于**之后**签发的 token；已经签出的 token 带的是
 * 写死在 `exp` 里的值，改配置不会让它们立即失效（否则一次配置发布等于把所有
 * 在线用户踢下线）。所以这里是「读快照」而不是「构造时缓存」。
 *
 * secrets 不在此列：密钥只来自环境变量，运行期改不了。
 */
@Injectable()
export class RuntimeSessionLifetime extends SessionLifetime {
  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(RuntimeConfigService)
    private readonly runtimeConfig?: RuntimeConfigPort,
  ) {
    super();
  }

  resolve(): { accessTtlSeconds: number; refreshTtlSeconds: number } {
    const base = this.configService.getOrThrow<JwtTtlShape>(ConfigKey.Jwt);
    const values = this.runtimeConfig?.getSnapshot().values;
    return {
      accessTtlSeconds: values?.[EnvKey.JWT_ACCESS_TTL] ?? base.accessTtl,
      refreshTtlSeconds: values?.[EnvKey.JWT_REFRESH_TTL] ?? base.refreshTtl,
    };
  }
}
