import { Injectable } from '@nestjs/common';

import { unwrapResult } from '../../../../common/result/index.js';
import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import type { DeleteAccountDto } from '../../dto/shared/delete-account.dto.js';
import { SessionTokens } from '../services/session-tokens.js';
import { AuthAccountService } from '../../services/account.service.js';

/**
 * 删号 —— 本模块唯一**真有编排**的账号自助用例。
 *
 * ## 它为什么是一个用例（而不是转发）
 *
 * 判据不是「几行代码」，而是**有没有跨聚合的顺序依赖**。这里有：
 *
 * 1. **撤销该用户全部会话**（`SessionTokens`，Session 聚合）
 * 2. **软删除用户**（`AuthAccountService`，Account 聚合）
 *
 * 两个聚合、**有顺序**，而且顺序不可交换：
 *
 * - 先撤会话再删号 → 删号期间和之后，任何持有旧 token 的请求都过不了守卫；
 * - 反过来的话，删号成功后到撤会话之间有一个窗口，旧 access token 仍然有效
 *   （守卫只读 token 里的 `status`，而那个 `status` 是签发时的快照）——
 *   一个刚被注销的账号还能继续调接口。
 *
 * 所以这两步必须在一个用例里、按这个顺序执行。**把顺序写在这里而不是留给
 * 调用方**，是因为调用方（controller）不该知道「删号要先撤会话」这种领域顺序。
 *
 * ## 依赖故障语义
 *
 * 撤销会话失败 → 整个删号失败（`DEPENDENCY_UNAVAILABLE`），**不做部分成功**：
 * 撤会话失败却继续删号，会留下「账号没了但 token 还能用」的最坏状态。
 *
 * ## 跨上下文的同步调用
 *
 * `account`（User Profile）调用本用例是 partnership 关系的同步调用
 * （同进程、同数据库、「删号必须立刻返回结果」）。不是分布式单体——
 * ADR-0024 §3 的「跨上下文写经命令/提案」是**服务拆出去之后**的规则。
 */
@Injectable()
export class DeleteAccount {
  constructor(
    private readonly sessionTokens: SessionTokens,
    private readonly authAccountService: AuthAccountService,
  ) {}

  /**
   * 删号。
   *
   * @param userId 已认证用户（来自 access token，不由请求体提供）。
   * @param dto 二次确认凭据（密码或验证码二选一）。
   */
  execute(
    userId: string,
    dto: DeleteAccountDto,
  ): ResultAsync<void, DomainFailure> {
    // 顺序不可交换：先撤会话，再删号。见类注释。
    return this.sessionTokens
      .revokeAll(userId)
      .andThen(() => this.authAccountService.deleteAccount(userId, dto));
  }

  /** 供 controller 直接 await 的形态（抛 `DomainFailureException`）。 */
  async run(userId: string, dto: DeleteAccountDto): Promise<void> {
    await unwrapResult(this.execute(userId, dto));
  }
}
