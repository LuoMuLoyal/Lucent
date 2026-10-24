import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';

import { now } from '../../../../common/index.js';
import {
  createDomainFailure,
  errAsync,
  fromPromise,
  mapUnknownToDependencyFailure,
  mapUnknownToInternalFailure,
  type DomainFailure,
  type ResultAsync,
} from '../../../../common/result/index.js';
import { AccessTokens } from '../ports/access-tokens.js';
import { SessionLifetime } from '../ports/session-lifetime.js';
import type { RequestOrigin } from '../ports/request-origin.js';
import {
  hashRefreshToken,
  refreshTokenDigestPrefix,
} from '../../domain/session/refresh-token.js';
import {
  decideRefresh,
  refreshLogEntry,
  type RefreshDecision,
} from '../../domain/session/session.js';
import { Sessions } from '../../domain/session/sessions.js';

/**
 * 一次会话建立后的 token 对。
 *
 * 有效期以 ISO 字符串给出：投递层要用它算 `Max-Age` 与 `expiresIn`，
 * 而它们都是「剩余秒数」——由投递层从 ISO 反算，避免两处各算一遍时区。
 */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

/** 会话归属人（签发 token 的输入）。 */
export interface SessionSubject {
  userId: string;
  email: string | null;
  /** 账户状态。写进 token 让守卫能拒绝已停用的会话。 */
  status: string;
}

/** refresh token 的明文字节数。32 字节 = 256 位，远高于可暴力搜索的门槛。 */
const REFRESH_TOKEN_BYTES = 32;

/** 秒 → 毫秒。TTL 端口按秒给出（JWT 与 `Max-Age` 都用秒），落库要毫秒。 */
const MS_PER_SECOND = 1000;

/** 内部使用的会话行形状（仅本类需要的字段）。 */
interface ISessionRow {
  id: string;
  owner: SessionSubject;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
}

/**
 * 签发会话令牌 —— 会话聚合的**应用服务**。
 *
 * ## 它做编排，不做判定
 *
 * 「这条 refresh token 还能不能换」的规则在 `domain/session/session.ts`；
 * 这里依次做：查行 → 领域判定 → 原子认领 → 撤销整族（若盗用）→ 签发新的一对。
 * 判定分支因此可以被领域层纯单测覆盖，本类只测编排顺序与错误映射。
 *
 * ## 为什么先写会话行、后签 JWT
 *
 * 反过来的顺序（先签再写行）一旦写行失败，用户手里会有一个能过守卫的 access
 * token，却没有 refresh 记录——只能等 access 过期后被踢回登录页。当前顺序里
 * 签名失败留下的是一条孤儿会话行：refresh token 从未返回给任何人，它只是
 * 等 TTL 到期，无害。
 *
 * ## 族根
 *
 * 全新登录：新会话的 id **就是**族根（`familyId = id`）。
 * 轮换：新会话加入被替换会话的族。这让撤销能覆盖盗用者可能拿到的全部会话。
 */
@Injectable()
export class SessionTokens {
  private readonly logger = new Logger(SessionTokens.name);

  constructor(
    private readonly sessions: Sessions,
    private readonly accessTokens: AccessTokens,
    private readonly lifetime: SessionLifetime,
  ) {}

  /**
   * 为一个已认证主体签发 token 对并落库会话行。
   *
   * @param subject 会话归属人。
   * @param origin 请求元数据（IP / UA），记录在会话行上供设备清单展示。
   * @param familyId 要加入的 token 族。省略 = 全新登录，新会话自成一族。
   */
  issue(
    subject: SessionSubject,
    origin?: RequestOrigin,
    familyId?: string,
  ): ResultAsync<TokenPair, DomainFailure> {
    const ttl = this.lifetime.resolve();

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const issuedAt = Date.now();
    const sessionId = randomUUID();

    return fromPromise(
      this.sessions.create({
        id: sessionId,
        userId: subject.userId,
        refreshTokenHash,
        expiresAt: new Date(issuedAt + ttl.refreshTtlSeconds * MS_PER_SECOND),
        lastUsedAt: new Date(issuedAt),
        familyId: familyId ?? sessionId,
        ...(origin === undefined ? {} : { context: origin }),
      }),
      (error) => mapUnknownToInternalFailure(error, 'Failed to create session'),
    )
      .andThen(() =>
        fromPromise(
          this.accessTokens.sign({ subject, ttlSeconds: ttl.accessTtlSeconds }),
          (error) => {
            this.logger.error(
              `Access token signing failed for user ${subject.userId} after session creation: ${error instanceof Error ? error.message : String(error)}`,
              error instanceof Error ? error.stack : undefined,
            );
            return mapUnknownToInternalFailure(
              error,
              'Token signing failed after session creation',
            );
          },
        ),
      )
      .map((accessToken) => ({
        accessToken,
        refreshToken,
        accessTokenExpiresAt: new Date(
          issuedAt + ttl.accessTtlSeconds * MS_PER_SECOND,
        ).toISOString(),
        refreshTokenExpiresAt: new Date(
          issuedAt + ttl.refreshTtlSeconds * MS_PER_SECOND,
        ).toISOString(),
      }));
  }

  /**
   * 轮换一个 refresh token。
   *
   * 返回新的一对 token 与**谁的**会话：调用方拿到的是归属人，不需要再解一次
   * JWT 或再查一次用户。
   *
   * ## 四种结局
   *
   * | 情境 | 结果 |
   * | --- | --- |
   * | 查不到 / 已过期 / 已吊销 | `AUTH_REFRESH_TOKEN_INVALID`，日志记原因 |
   * | 已轮换，在宽限窗口内 | `AUTH_REFRESH_TOKEN_INVALID`，**不动**会话（并发竞态） |
   * | 已轮换，过了宽限窗口 | 撤销整族 + `AUTH_REFRESH_TOKEN_INVALID`（盗用） |
   * | 未轮换 | 认领成功后签发新的一对，加入同一族 |
   */
  rotate(
    refreshToken: string,
    origin?: RequestOrigin,
  ): ResultAsync<
    { userId: string; status: string; tokens: TokenPair },
    DomainFailure
  > {
    const refreshTokenHash = hashRefreshToken(refreshToken);

    return this.loadSession(refreshTokenHash).andThen((session) => {
      if (session === null) {
        this.logRefreshTokenInvalid(refreshTokenHash, 'not-found');
        return this.refreshTokenInvalid();
      }

      const decision = decideRefresh(
        {
          id: session.id,
          userId: session.owner.userId,
          refreshTokenHash,
          familyId: session.familyId,
          expiresAt: session.expiresAt,
          revokedAt: session.revokedAt,
          rotatedAt: session.rotatedAt,
        },
        now(),
      );

      switch (decision.kind) {
        case 'invalid':
          this.logDecision(refreshTokenHash, decision);
          return this.refreshTokenInvalid();
        case 'concurrent-race':
          this.logDecision(refreshTokenHash, decision);
          return this.refreshTokenInvalid();
        case 'reuse-detected':
          return this.revokeFamilyThenReject(
            decision,
            refreshTokenHash,
            session.owner.userId,
          );
        case 'rotate':
          return this.claimAndRotate(session, refreshTokenHash, origin);
      }
    });
  }

  /** 登出：删掉这条 refresh token 对应的会话行。 */
  revoke(
    userId: string,
    refreshToken: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(
      this.sessions.deleteByUserIdAndHash(
        userId,
        hashRefreshToken(refreshToken),
      ),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Session revocation failed'),
    );
  }

  /**
   * 强制下线：删掉该用户的全部会话行。
   *
   * 改密、重置密码、删号都会调用它——凭证换过之后，旧的 refresh token 一律作废。
   */
  revokeAll(userId: string): ResultAsync<void, DomainFailure> {
    return fromPromise(this.sessions.deleteAllForUser(userId), (error) =>
      mapUnknownToDependencyFailure(error, 'Session revocation failed'),
    );
  }

  /**
   * 吊销指定会话（用户自助或运营强制下线）。
   *
   * 归属校验在应用层：别的用户的会话 id 不是秘密（它只出现在那个人自己的清单里），
   * 但对当前用户而言那是「无权」。区分 404 与 403 不会泄露他人的会话内容，
   * 却能让客户端正确地提示。
   */
  revokeById(
    userId: string,
    sessionId: string,
  ): ResultAsync<void, DomainFailure> {
    return fromPromise(this.sessions.findById(sessionId), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load session'),
    ).andThen((session) => {
      if (session === null) {
        return errAsync(
          createDomainFailure({
            kind: 'authentication',
            code: 'AUTH_SESSION_NOT_FOUND',
          }),
        );
      }
      if (session.userId !== userId) {
        return errAsync(
          createDomainFailure({
            kind: 'authorization',
            code: 'AUTH_SESSION_ACCESS_DENIED',
          }),
        );
      }
      return fromPromise(this.sessions.revokeById(sessionId, now()), (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to revoke session'),
      );
    });
  }

  /** 当前用户仍在生效的会话清单（轮换掉的 tombstone 已由仓储排除）。 */
  list(userId: string): ResultAsync<
    Array<{
      id: string;
      deviceType: string | null;
      deviceName: string | null;
      platform: string | null;
      lastUsedAt: string | null;
      createdAt: string;
      expiresAt: string;
      isCurrent: boolean;
    }>,
    DomainFailure
  > {
    return fromPromise(this.sessions.listActive(userId), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to list sessions'),
    ).map((rows) =>
      rows.map((row) => ({
        id: row.id,
        deviceType: row.deviceType,
        deviceName: row.deviceName,
        platform: row.platform,
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        isCurrent: false,
      })),
    );
  }

  // ── 内部步骤 ─────────────────────────────────────────────────

  /**
   * 按指纹读会话行，并把行上的 `userId` 折成归属人。
   *
   * `status` 暂时留空：refresh 不需要重新判定账户状态——token 里的 `status`
   * 由守卫读，而被停用的账户即便刷新出新 token 也过不了守卫。这一点让
   * 「refresh 不必查用户表」成立，也避免刷新路径多一次往返。
   */
  private loadSession(
    refreshTokenHash: string,
  ): ResultAsync<ISessionRow | null, DomainFailure> {
    return fromPromise(
      this.sessions.findByRefreshTokenHash(refreshTokenHash),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Failed to load session by refresh token',
        ),
    ).map((record) =>
      record === null
        ? null
        : {
            id: record.id,
            owner: { userId: record.userId, email: null, status: 'active' },
            familyId: record.familyId,
            expiresAt: record.expiresAt,
            revokedAt: record.revokedAt,
            rotatedAt: record.rotatedAt,
          },
    );
  }

  /**
   * 认领轮换并签发新的一对。
   *
   * 认领落败有两种可能：别人先认领了（竞态/盗用，走同一套领域判定），或者行
   * 在认领与重读之间消失了（保留任务清理）。后者对外一律视作 token 无效——
   * 绝不把内部的「会话不存在」泄露到 refresh 的响应里。
   */
  private claimAndRotate(
    session: ISessionRow,
    refreshTokenHash: string,
    origin?: RequestOrigin,
  ): ResultAsync<
    { userId: string; status: string; tokens: TokenPair },
    DomainFailure
  > {
    return fromPromise(
      this.sessions.claimForRefresh(session.id, now()),
      (error) =>
        mapUnknownToDependencyFailure(error, 'Failed to claim session'),
    ).andThen((claimed) => {
      if (!claimed) {
        return this.resolveLostClaim(session, refreshTokenHash);
      }
      // 轮换出来的会话加入同一族：之后任何一条被重放，都能撤销整条链。
      return this.issue(session.owner, origin, session.familyId).map(
        (tokens) => ({
          userId: session.owner.userId,
          status: session.owner.status,
          tokens,
        }),
      );
    });
  }

  /** 认领落败：重读该行，再走一遍领域判定（区分竞态与盗用）。 */
  private resolveLostClaim(
    session: ISessionRow,
    refreshTokenHash: string,
  ): ResultAsync<never, DomainFailure> {
    return fromPromise(this.sessions.findById(session.id), (error) =>
      mapUnknownToDependencyFailure(error, 'Failed to load session'),
    ).andThen((reloaded) => {
      if (reloaded === null) {
        this.logger.warn(
          'Session vanished while resolving a lost refresh claim',
          {
            code: 'AUTH_REFRESH_TOKEN_INVALID',
            reason: 'vanished-during-claim',
            userId: session.owner.userId,
          },
        );
        return this.refreshTokenInvalid();
      }

      const decision = decideRefresh(
        {
          id: reloaded.id,
          userId: reloaded.userId,
          refreshTokenHash,
          familyId: reloaded.familyId,
          expiresAt: reloaded.expiresAt,
          revokedAt: reloaded.revokedAt,
          rotatedAt: reloaded.rotatedAt,
        },
        now(),
      );

      if (decision.kind === 'reuse-detected') {
        return this.revokeFamilyThenReject(
          decision,
          refreshTokenHash,
          reloaded.userId,
        );
      }
      this.logDecision(refreshTokenHash, decision);
      return this.refreshTokenInvalid();
    });
  }

  /**
   * 判定为盗用：先撤销整族，再返回统一失败。
   *
   * 撤销失败不掩盖原判定——盗用仍然是盗用。这里把撤销错误抛出，让运维能在
   * 指标上看到「检测到盗用但撤销失败」（那是比盗用本身更需要人工介入的状态）。
   */
  private revokeFamilyThenReject(
    decision: RefreshDecision,
    refreshTokenHash: string,
    userId: string,
  ): ResultAsync<never, DomainFailure> {
    if (decision.kind !== 'reuse-detected') {
      return this.refreshTokenInvalid();
    }
    return fromPromise(
      this.sessions.revokeFamily(userId, decision.familyId, now()),
      (error) =>
        mapUnknownToDependencyFailure(
          error,
          'Session family revocation failed',
        ),
    ).andThen((revoked) => {
      const entry = refreshLogEntry(decision, refreshTokenHash, revoked);
      this.logger.error(
        'Refresh token reuse detected, session family revoked',
        {
          code: 'AUTH_REFRESH_TOKEN_INVALID',
          ...entry,
        },
      );
      return this.refreshTokenInvalid();
    });
  }

  private logDecision(
    refreshTokenHash: string,
    decision: RefreshDecision,
  ): void {
    const entry = refreshLogEntry(decision, refreshTokenHash);
    if (entry === null) return;
    this.logger.warn(
      entry.reason === 'concurrent-refresh'
        ? 'Refresh token replayed inside the concurrency grace'
        : 'Refresh token invalid',
      { code: 'AUTH_REFRESH_TOKEN_INVALID', ...entry },
    );
  }

  /**
   * 结构化 warn：无效 / 过期 / 已吊销 / 已认领的 refresh token。
   *
   * 永不记录原始 token，指纹也只留前缀。
   */
  private logRefreshTokenInvalid(
    refreshTokenHash: string,
    reason: 'not-found' | 'expired' | 'revoked',
  ): void {
    this.logger.warn('Refresh token invalid', {
      code: 'AUTH_REFRESH_TOKEN_INVALID',
      reason,
      refreshTokenHash: refreshTokenDigestPrefix(refreshTokenHash),
    });
  }

  /**
   * refresh 失败的统一出口。
   *
   * 对外只有一个码：查不到、过期、已吊销、竞态、盗用全部是
   * `AUTH_REFRESH_TOKEN_INVALID`。区分它们会让攻击者拿到「这个 token 存在过」
   * 的信号。
   */
  private refreshTokenInvalid(): ResultAsync<never, DomainFailure> {
    return errAsync(
      createDomainFailure({
        kind: 'authentication',
        code: 'AUTH_REFRESH_TOKEN_INVALID',
      }),
    );
  }
}
