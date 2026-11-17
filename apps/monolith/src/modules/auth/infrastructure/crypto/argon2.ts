import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { ARGON2_OPTIONS } from '../../config/argon2-options.js';
import {
  isVerifiableHash,
  type PasswordHash,
} from '../../domain/account/password-hash.js';
import {
  PasswordHasher,
  type PlainPassword,
} from '../../application/ports/password-hasher.js';

/**
 * `PasswordHasher` 端口的 Argon2 实现。
 *
 * ## 为什么放在 infrastructure 而不是 application
 *
 * Argon2 是**外部库 + CPU/内存消耗**，是典型的基础设施关注点。应用层只需要
 * 「哈希」与「比对」两个动作；参数与库的选择在这里收敛成一处。
 *
 * ## 未知哈希格式必须抛，不能返回 `false`
 *
 * `verify` 先检查 `isVerifiableHash`。一个被写坏的哈希（不是 Argon2 编码串）
 * 若返回 `false`，调用方会把它报成「密码错」——用户于是去重置一个本来没问题的
 * 密码。这里抛出去，由应用层映射成 `DEPENDENCY_UNAVAILABLE`（不变量 #2）。
 *
 * Argon2 自身对格式错误会抛 `Error`，行为一致，无需额外包装。
 */
@Injectable()
export class Argon2PasswordHasher extends PasswordHasher {
  async hash(password: PlainPassword): Promise<PasswordHash> {
    const encoded = await argon2.hash(password, ARGON2_OPTIONS);
    return { encoded };
  }

  async verify(hash: PasswordHash, password: PlainPassword): Promise<boolean> {
    if (!isVerifiableHash(hash)) {
      // 抛而不是 `false`：格式错误不是「密码不对」，见类注释。
      throw new UnverifiablePasswordHashError(hash.encoded);
    }
    return await argon2.verify(hash.encoded, password, ARGON2_OPTIONS);
  }
}

/**
 * 库里的密码哈希不是本系统能验证的形式。
 *
 * 这是一个**数据/依赖**故障，不是凭据失败。日志里只留前缀——完整哈希是
 * 可离线爆破的材料，不该进日志。
 */
export class UnverifiablePasswordHashError extends Error {
  constructor(encoded: string) {
    super(
      `Stored password hash is not Argon2: ${encoded.slice(0, HASH_LOG_PREFIX_LENGTH)}…`,
    );
    this.name = 'UnverifiablePasswordHashError';
  }
}

/** 日志里保留的哈希前缀长度：够定位格式问题，不足以作为爆破材料。 */
const HASH_LOG_PREFIX_LENGTH = 10;
