import { describe, expect, it } from 'vitest';

import {
  canAutoLinkByEmail,
  canExplicitlyLink,
  decideOAuthAccount,
  normalizedIdentityEmail,
  type OAuthAccountFacts,
  type OAuthIdentity,
} from './oauth-identity.js';

/**
 * OAuth 账号归属规则的**纯单测**。
 *
 * 自动关联是「别人能登进你的账号」的唯一合法路径，所以每个条件都单独钉住。
 * 不建 DI 容器、不 mock Prisma——规则本身与存储无关。
 */

function identity(overrides: Partial<OAuthIdentity> = {}): OAuthIdentity {
  return {
    provider: 'google',
    providerUserId: 'provider-user-1',
    email: 'who@example.com',
    emailVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  };
}

function facts(overrides: Partial<OAuthAccountFacts> = {}): OAuthAccountFacts {
  return {
    linkedUserId: null,
    unionUserId: null,
    emailUserId: null,
    ...overrides,
  };
}

describe('decideOAuthAccount — 已有身份行优先', () => {
  it('已有身份行 → link-existing(identity-already-linked)', () => {
    expect(
      decideOAuthAccount(identity(), facts({ linkedUserId: 'user-1' })),
    ).toEqual({
      kind: 'link-existing',
      userId: 'user-1',
      reason: 'identity-already-linked',
    });
  });

  it('已有身份行优先于邮箱命中', () => {
    // 老用户再次登录时必须命中自己的账号，而不是按邮箱另找一个。
    const decision = decideOAuthAccount(
      identity(),
      facts({ linkedUserId: 'user-1', emailUserId: 'user-2' }),
    );

    expect(decision).toEqual({
      kind: 'link-existing',
      userId: 'user-1',
      reason: 'identity-already-linked',
    });
  });
});

describe('decideOAuthAccount — unionId 命中', () => {
  it('unionId 命中 → link-existing(matched-by-union-id)', () => {
    const decision = decideOAuthAccount(
      identity({ provider: 'wechat_web', unionId: 'union-1' }),
      facts({ unionUserId: 'user-9' }),
    );

    expect(decision).toEqual({
      kind: 'link-existing',
      userId: 'user-9',
      reason: 'matched-by-union-id',
    });
  });

  it('没有 unionId 时该分支不生效', () => {
    const decision = decideOAuthAccount(
      identity({ provider: 'wechat_web' }),
      facts({ unionUserId: 'user-9' }),
    );

    expect(decision).toEqual({ kind: 'create-new' });
  });

  it('unionId 命中优先于邮箱命中', () => {
    // unionId 由提供商保证唯一，比邮箱更精确。
    const decision = decideOAuthAccount(
      identity({ provider: 'wechat_web', unionId: 'union-1' }),
      facts({ unionUserId: 'user-9', emailUserId: 'user-2' }),
    );

    expect(decision).toMatchObject({ userId: 'user-9' });
  });
});

describe('decideOAuthAccount — 按邮箱自动关联（受信提供商）', () => {
  it('【条件 3】受信 + 已验证 + 邮箱命中 → link-existing', () => {
    for (const provider of ['apple', 'google'] as const) {
      expect(
        decideOAuthAccount(
          identity({ provider }),
          facts({ emailUserId: 'user-1' }),
        ),
      ).toEqual({
        kind: 'link-existing',
        userId: 'user-1',
        reason: 'matched-by-trusted-email',
      });
    }
  });

  it('【条件 1】非受信提供商 → 不自动关联，哪怕邮箱已验证', () => {
    // 这是最关键的一条：微信/QQ 的邮箱可能未经核实，拿它自动关联等于
    // 允许「注册一个微信账号、把邮箱填成受害者地址」来接管账号。
    for (const provider of ['wechat_web', 'wechat_mobile', 'qq'] as const) {
      expect(
        decideOAuthAccount(
          identity({ provider }),
          facts({ emailUserId: 'user-1' }),
        ),
      ).toEqual({ kind: 'create-new' });
    }
  });

  it('【条件 2】受信提供商但邮箱未验证 → 不自动关联', () => {
    for (const provider of ['apple', 'google'] as const) {
      expect(
        decideOAuthAccount(
          identity({ provider, emailVerifiedAt: null }),
          facts({ emailUserId: 'user-1' }),
        ),
      ).toEqual({ kind: 'create-new' });
    }
  });

  it('受信提供商但邮箱为 null → 不自动关联', () => {
    expect(
      decideOAuthAccount(
        identity({ provider: 'google', email: null }),
        facts({ emailUserId: 'user-1' }),
      ),
    ).toEqual({ kind: 'create-new' });
  });

  it('受信提供商但邮箱为空串 → 不自动关联', () => {
    expect(
      decideOAuthAccount(
        identity({ provider: 'google', email: '' }),
        facts({ emailUserId: 'user-1' }),
      ),
    ).toEqual({ kind: 'create-new' });
  });

  it('【条件 4】受信 + 已验证 + 邮箱不匹配任何账号 → create-new', () => {
    expect(
      decideOAuthAccount(identity({ provider: 'google' }), facts()),
    ).toEqual({ kind: 'create-new' });
  });
});

describe('decideOAuthAccount — 条件 5：邮箱匹配到多个账号', () => {
  it('类型上不可能表达「多个」——邮箱命中是一个确定值而不是列表', () => {
    // `users.email` 是 @unique（prisma/models/user.prisma:66），且软删除的行
    // 仍占用唯一键，所以「同一邮箱两个活跃账号」在数据库层不可能出现。
    // 这条测试把那个前提钉在类型上：`emailUserId` 是 `string | null`，
    // 若哪天变成数组，这里的类型检查会失败。
    const single: OAuthAccountFacts = facts({ emailUserId: 'user-1' });
    expect(typeof single.emailUserId).toBe('string');
  });

  it('已注销账号的邮箱不会被自动关联（走建新账号）', () => {
    // 软删除行仍占唯一键，但 `findByEmail` 走 nonDeleted 过滤后查不到
    // → emailUserId 为 null → create-new。注销过的邮箱不该让原主人的
    // OAuth 身份复活到一个旧账号上。
    expect(
      decideOAuthAccount(
        identity({ provider: 'google' }),
        facts({ emailUserId: null }),
      ),
    ).toEqual({ kind: 'create-new' });
  });
});

describe('canAutoLinkByEmail', () => {
  it('只有受信 + 有邮箱 + 已验证 三者齐备才为真', () => {
    expect(canAutoLinkByEmail(identity({ provider: 'google' }))).toBe(true);
    expect(
      canAutoLinkByEmail(
        identity({ provider: 'google', emailVerifiedAt: null }),
      ),
    ).toBe(false);
    expect(canAutoLinkByEmail(identity({ provider: 'wechat_web' }))).toBe(
      false,
    );
  });

  it('未知提供商一律不为真（失败方向是拒绝）', () => {
    expect(canAutoLinkByEmail(identity({ provider: 'github' }))).toBe(false);
    expect(canAutoLinkByEmail(identity({ provider: '' }))).toBe(false);
  });
});

describe('canExplicitlyLink', () => {
  it('受信提供商不允许显式链接（走登录自动关联）', () => {
    for (const provider of ['apple', 'google'] as const) {
      expect(canExplicitlyLink(identity({ provider }), null, 'user-1')).toBe(
        false,
      );
    }
  });

  it('非受信提供商且身份未被占用 → 允许链接', () => {
    expect(
      canExplicitlyLink(identity({ provider: 'wechat_web' }), null, 'user-1'),
    ).toBe(true);
  });

  it('身份已被别人占用 → 拒绝', () => {
    expect(
      canExplicitlyLink(
        identity({ provider: 'wechat_web' }),
        'user-2',
        'user-1',
      ),
    ).toBe(false);
  });

  it('身份本来就属于自己 → 幂等成功', () => {
    expect(
      canExplicitlyLink(
        identity({ provider: 'wechat_web' }),
        'user-1',
        'user-1',
      ),
    ).toBe(true);
  });
});

describe('normalizedIdentityEmail', () => {
  it('规范化大小写与空白', () => {
    expect(
      normalizedIdentityEmail(identity({ email: '  Who@Example.COM ' })),
    ).toBe('who@example.com');
  });

  it('null 与空串都返回 null', () => {
    expect(normalizedIdentityEmail(identity({ email: null }))).toBeNull();
    expect(normalizedIdentityEmail(identity({ email: '' }))).toBeNull();
  });
});
