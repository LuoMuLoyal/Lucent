import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { describe, expect, it, beforeEach, vi } from 'vitest';

import type {
  DomainFailure,
  ResultAsync,
} from '../../../../common/result/index.js';
import { SessionTokens } from './session-tokens.js';
import type { AccessTokens } from '../ports/access-tokens.js';
import type { SessionLifetime } from '../ports/session-lifetime.js';
import {
  Sessions,
  type ActiveSessionRow,
  type NewSessionInput,
  type SessionForRefresh,
} from '../../domain/session/sessions.js';
import { REFRESH_REUSE_GRACE_MS } from '../../domain/session/refresh-token.js';

/**
 * 会话令牌签发的编排测试。
 *
 * ## 这里测什么，不测什么
 *
 * 「宽限窗口内是竞态、窗口外是盗用」的判定本身由
 * `domain/session/session.spec.ts` 纯单测钉住。本文件测**编排顺序**：
 * 撤销整族是否真的被调用、认领是否发生在签发之前、落败方是否重读。
 *
 * 仓储与 JWT 都是手写替身（不用 Prisma、不建 DI 容器）——它们只是记录调用，
 * 不携带任何业务判断。
 */
function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function collect<T>(
  result: ResultAsync<T, DomainFailure>,
): Promise<{ ok: true; value: T } | { ok: false; error: DomainFailure }> {
  return result.match(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

class FakeSessions extends Sessions {
  readonly created: NewSessionInput[] = [];
  readonly revokedFamilies: { userId: string; familyId: string; at: Date }[] =
    [];
  readonly claimed: string[] = [];
  readonly revoked: string[] = [];
  readonly deletedHashes: string[] = [];
  readonly deletedAll: string[] = [];

  byHash: SessionForRefresh | null = null;
  byId: SessionForRefresh | null = null;
  claimSucceeds = true;
  /** 让 `create` 失败，用来验证依赖故障不被折叠成反枚举桶。 */
  createError: unknown = null;

  create(input: NewSessionInput): Promise<void> {
    if (this.createError instanceof Error) {
      return Promise.reject(this.createError);
    }
    this.created.push(input);
    return Promise.resolve();
  }

  findByRefreshTokenHash(): Promise<SessionForRefresh | null> {
    return Promise.resolve(this.byHash);
  }

  findById(id: string): Promise<SessionForRefresh | null> {
    return Promise.resolve(
      this.byId ?? (this.byHash?.id === id ? this.byHash : null),
    );
  }

  claimForRefresh(id: string): Promise<boolean> {
    this.claimed.push(id);
    return Promise.resolve(this.claimSucceeds);
  }

  revokeFamily(userId: string, familyId: string, at: Date): Promise<number> {
    this.revokedFamilies.push({ userId, familyId, at });
    return Promise.resolve(2);
  }

  revokeById(id: string): Promise<void> {
    this.revoked.push(id);
    return Promise.resolve();
  }

  deleteByUserIdAndHash(
    _userId: string,
    refreshTokenHash: string,
  ): Promise<void> {
    this.deletedHashes.push(refreshTokenHash);
    return Promise.resolve();
  }

  deleteAllForUser(userId: string): Promise<void> {
    this.deletedAll.push(userId);
    return Promise.resolve();
  }

  listActive(): Promise<ActiveSessionRow[]> {
    return Promise.resolve([]);
  }
}

const SUBJECT = {
  userId: 'user-1',
  email: 'who@example.com',
  status: 'active',
};

function liveSession(
  overrides: Partial<SessionForRefresh> = {},
): SessionForRefresh {
  return {
    id: 'session-1',
    userId: 'user-1',
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    rotatedAt: null,
    ...overrides,
  };
}

describe('SessionTokens', () => {
  let sessions: FakeSessions;
  let accessTokens: {
    signed: number;
    fail: unknown;
    sign: AccessTokens['sign'];
  };
  let service: SessionTokens;
  const token = 'refresh-token-plaintext';

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    sessions = new FakeSessions();
    accessTokens = {
      signed: 0,
      fail: null,
      sign: () => {
        accessTokens.signed += 1;
        return accessTokens.fail instanceof Error
          ? Promise.reject(accessTokens.fail)
          : Promise.resolve('signed-access-token');
      },
    };

    const lifetime: SessionLifetime = {
      resolve: () => ({ accessTtlSeconds: 900, refreshTtlSeconds: 604_800 }),
    };

    service = new SessionTokens(
      sessions,
      accessTokens as AccessTokens,
      lifetime,
    );
  });

  describe('issue', () => {
    it('先写会话行再签 token，且全新会话的族根就是自己的 id', async () => {
      const outcome = await collect(service.issue(SUBJECT));

      expect(outcome.ok).toBe(true);
      expect(sessions.created).toHaveLength(1);
      const created = sessions.created[0]!;
      expect(created.familyId).toBe(created.id);
      expect(created.refreshTokenHash).toBe(
        hash(outcome.ok ? outcome.value.refreshToken : ''),
      );
    });

    it('轮换时新会话加入被替换会话的族', async () => {
      await collect(service.issue(SUBJECT, undefined, 'family-keep'));
      expect(sessions.created[0]?.familyId).toBe('family-keep');
    });

    it('请求元数据写进会话行', async () => {
      await collect(
        service.issue(SUBJECT, { ipAddress: '1.2.3.4', userAgent: 'UA/1' }),
      );
      expect(sessions.created[0]?.context).toEqual({
        ipAddress: '1.2.3.4',
        userAgent: 'UA/1',
      });
    });

    it('签名失败映射为 INTERNAL_ERROR，不折叠成凭据失败', async () => {
      accessTokens.fail = new Error('signing backend down');

      const outcome = await collect(service.issue(SUBJECT));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('INTERNAL_ERROR');
      expect(outcome.error.kind).toBe('internal');
    });

    it('写会话行失败映射为 INTERNAL_ERROR，不折叠成凭据失败', async () => {
      sessions.createError = new Error('db connection lost');

      const outcome = await collect(service.issue(SUBJECT));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('rotate', () => {
    it('未知 token → AUTH_REFRESH_TOKEN_INVALID，且不认领不签发', async () => {
      sessions.byHash = null;

      const outcome = await collect(service.rotate('unknown'));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_REFRESH_TOKEN_INVALID');
      expect(sessions.claimed).toHaveLength(0);
      expect(accessTokens.signed).toBe(0);
    });

    it('可轮换时先原子认领，再用同一族签发', async () => {
      sessions.byHash = liveSession();

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(true);
      expect(sessions.claimed).toEqual(['session-1']);
      expect(sessions.created[0]?.familyId).toBe('family-1');
      expect(accessTokens.signed).toBe(1);
    });

    it('宽限窗口内的重放只拒绝，不撤销整族', async () => {
      sessions.byHash = liveSession({
        rotatedAt: new Date(Date.now() - 2_000),
      });

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_REFRESH_TOKEN_INVALID');
      expect(sessions.revokedFamilies).toHaveLength(0);
      expect(sessions.claimed).toHaveLength(0);
    });

    it('窗口外的重放撤销整族后才返回失败（RFC 9700 §4.13.2）', async () => {
      sessions.byHash = liveSession({
        rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 60_000),
      });

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_REFRESH_TOKEN_INVALID');
      expect(sessions.revokedFamilies).toEqual([
        expect.objectContaining({ userId: 'user-1', familyId: 'family-1' }),
      ]);
      expect(accessTokens.signed).toBe(0);
    });

    it('已吊销的会话一律无效，并优先于轮换判定', async () => {
      sessions.byHash = liveSession({
        revokedAt: new Date(),
        rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 60_000),
      });

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      expect(sessions.revokedFamilies).toHaveLength(0);
    });

    it('认领落败且行仍在（已被并发轮换）→ 走同一套重放分类', async () => {
      sessions.claimSucceeds = false;
      sessions.byHash = liveSession();
      sessions.byId = liveSession({
        rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 60_000),
      });

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      expect(sessions.revokedFamilies).toHaveLength(1);
    });

    it('认领落败且行已消失 → token 无效，绝不泄露内部不存在码', async () => {
      sessions.claimSucceeds = false;
      sessions.byHash = liveSession();
      sessions.byId = null;
      // `findById` 的兜底会回落到 `byHash`，这里显式覆盖为「查不到」。
      sessions.findById = () => Promise.resolve(null);

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_REFRESH_TOKEN_INVALID');
    });

    it('仓储故障映射为 DEPENDENCY_UNAVAILABLE，而不是 AUTH_REFRESH_TOKEN_INVALID', async () => {
      sessions.findByRefreshTokenHash = () =>
        Promise.reject(new Error('db connection lost'));

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(outcome.error.kind).toBe('dependency');
    });

    it('撤销整族失败时上抛依赖故障，不谎称 token 无效', async () => {
      // 检测到盗用却撤销失败，比盗用本身更需要人工介入：必须暴露出来。
      sessions.byHash = liveSession({
        rotatedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 60_000),
      });
      sessions.revokeFamily = () =>
        Promise.reject(new Error('db connection lost'));

      const outcome = await collect(service.rotate(token));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('DEPENDENCY_UNAVAILABLE');
    });
  });

  describe('revokeById', () => {
    it('别人的会话 → AUTH_SESSION_ACCESS_DENIED，不写入', async () => {
      sessions.byId = liveSession({ userId: 'user-2' });

      const outcome = await collect(service.revokeById('user-1', 'session-1'));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_SESSION_ACCESS_DENIED');
      expect(sessions.revoked).toHaveLength(0);
    });

    it('不存在的会话 → AUTH_SESSION_NOT_FOUND', async () => {
      sessions.findById = () => Promise.resolve(null);

      const outcome = await collect(service.revokeById('user-1', 'nope'));

      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('expected failure');
      expect(outcome.error.code).toBe('AUTH_SESSION_NOT_FOUND');
    });

    it('自己的会话 → 打时间戳', async () => {
      sessions.byId = liveSession();

      const outcome = await collect(service.revokeById('user-1', 'session-1'));

      expect(outcome.ok).toBe(true);
      expect(sessions.revoked).toEqual(['session-1']);
    });
  });

  describe('revoke / revokeAll', () => {
    it('登出按指纹删行，不落库存明文', async () => {
      await collect(service.revoke('user-1', token));
      expect(sessions.deletedHashes).toEqual([hash(token)]);
    });

    it('改密强制下线删除该用户全部会话', async () => {
      await collect(service.revokeAll('user-1'));
      expect(sessions.deletedAll).toEqual(['user-1']);
    });
  });

  describe('refresh 失败的统一出口', () => {
    it('所有 refresh 失败路径对外都是同一个码', async () => {
      const failures: DomainFailure[] = [];

      for (const byHash of [
        null,
        liveSession({ expiresAt: new Date(Date.now() - 1) }),
        liveSession({ revokedAt: new Date() }),
        liveSession({ rotatedAt: new Date(Date.now() - 1_000) }),
      ]) {
        sessions.byHash = byHash;
        const outcome = await collect(service.rotate(token));
        if (outcome.ok) throw new Error('expected failure');
        failures.push(outcome.error);
      }

      expect(new Set(failures.map((f) => f.code))).toEqual(
        new Set(['AUTH_REFRESH_TOKEN_INVALID']),
      );
      expect(new Set(failures.map((f) => f.kind))).toEqual(
        new Set(['authentication']),
      );
    });
  });
});
