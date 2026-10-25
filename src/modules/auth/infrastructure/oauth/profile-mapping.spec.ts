import { describe, expect, it } from 'vitest';

import { toOAuthIdentity } from './profile-mapping.js';
import type { OAuthProviderProfile } from '../../application/ports/oauth-provider.js';

/**
 * ACL 翻译的单测。
 *
 * 只验证「字段怎么搬」，不验证「能不能自动关联」——后者是
 * `domain/account/oauth-identity.spec.ts` 的职责。这一层不读受信名单、
 * 不判断邮箱是否已验证，所以这里也不该出现那类断言。
 */
function profile(
  overrides: Partial<OAuthProviderProfile> = {},
): OAuthProviderProfile {
  return {
    provider: 'google',
    providerUserId: 'provider-user-1',
    ...overrides,
  };
}

describe('toOAuthIdentity', () => {
  it('搬运必需字段', () => {
    expect(toOAuthIdentity(profile())).toEqual({
      provider: 'google',
      providerUserId: 'provider-user-1',
    });
  });

  it('搬运全部可选字段', () => {
    const verifiedAt = new Date('2026-10-01T00:00:00.000Z');
    expect(
      toOAuthIdentity(
        profile({
          unionId: 'union-1',
          email: 'Who@Example.COM',
          emailVerifiedAt: verifiedAt,
          nickname: 'Nick',
          avatar: 'https://example.com/a.png',
          rawProfile: { sub: 'x' },
        }),
      ),
    ).toEqual({
      provider: 'google',
      providerUserId: 'provider-user-1',
      unionId: 'union-1',
      email: 'Who@Example.COM',
      emailVerifiedAt: verifiedAt,
      nickname: 'Nick',
      avatar: 'https://example.com/a.png',
    });
  });

  it('缺失的可选字段不带键（而不是带 undefined）', () => {
    // 统一收敛成「有值才带键」，让下游判据只有一种写法。
    const identity = toOAuthIdentity(profile());
    expect(Object.keys(identity).sort()).toEqual([
      'provider',
      'providerUserId',
    ]);
  });

  it('email 为 null 时**保留** null（与「缺席」不同）', () => {
    // `email: null` 表示「提供商明确说没有邮箱」；缺席表示「提供商没提」。
    // 两者在归属判定里等价，但保留 null 让数据来源可追溯。
    const identity = toOAuthIdentity(profile({ email: null }));
    expect(identity.email).toBeNull();
    expect('email' in identity).toBe(true);
  });

  it('emailVerifiedAt 为 null 时保留 null（不自动关联）', () => {
    const identity = toOAuthIdentity(profile({ emailVerifiedAt: null }));
    expect(identity.emailVerifiedAt).toBeNull();
  });

  it('**丢弃** rawProfile —— 它不是领域身份的一部分', () => {
    // rawProfile 是审计留档材料，属持久化关切。它不该进入领域值对象：
    // 领域层不需要原始响应，而一旦带进去就会一路传到判定逻辑旁边。
    const identity = toOAuthIdentity(
      profile({ rawProfile: { openid: 'wx-1', headimgurl: 'https://x' } }),
    );
    expect(identity).not.toHaveProperty('rawProfile');
    expect(JSON.stringify(identity)).not.toContain('openid');
  });

  it('不规范化邮箱（那是领域层的规则）', () => {
    // 「怎么算同一个邮箱」只有一处：`domain/account/email.ts`。
    const identity = toOAuthIdentity(profile({ email: '  Who@Example.COM ' }));
    expect(identity.email).toBe('  Who@Example.COM ');
  });
});
