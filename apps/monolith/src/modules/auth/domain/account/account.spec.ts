import { describe, expect, it } from 'vitest';

import { Account, type AccountState } from './account.js';
import { toStoredPassword } from './password-hash.js';

function state(overrides: Partial<AccountState> = {}): AccountState {
  return {
    userId: 'user-1',
    email: 'Who@Example.COM',
    status: 'active',
    password: toStoredPassword('$argon2id$v=19$m=19456,t=2,p=1$salt$hash'),
    ...overrides,
  };
}

describe('Account', () => {
  it('邮箱以规范形式暴露', () => {
    expect(Account.from(state()).email).toBe('who@example.com');
  });

  it('没有邮箱时 email 为 null，hasEmail 为假', () => {
    const account = Account.from(state({ email: null }));
    expect(account.email).toBeNull();
    expect(account.hasEmail).toBe(false);
  });

  it('形状不对的邮箱不算「有邮箱」', () => {
    // 设密码要发验证码，形状不对的地址发不出去。
    expect(Account.from(state({ email: 'not-an-email' })).hasEmail).toBe(false);
  });

  it('有密码哈希时 hasPassword 为真，并能取到哈希', () => {
    const account = Account.from(state());
    expect(account.hasPassword).toBe(true);
    expect(account.passwordHash?.encoded).toContain('$argon2id$');
  });

  it('password 为 none 时 hasPassword 为假且取不到哈希', () => {
    const account = Account.from(state({ password: toStoredPassword(null) }));
    expect(account.hasPassword).toBe(false);
    expect(account.passwordHash).toBeNull();
  });

  it('空串密码哈希也算没有密码', () => {
    expect(
      Account.from(state({ password: toStoredPassword('') })).hasPassword,
    ).toBe(false);
  });

  it('未知状态被收敛成不能登录（失败方向是拒绝）', () => {
    const account = Account.from(state({ status: 'ACTIVE' }));
    expect(account.status).toBe('suspended');
    expect(account.canLogin()).toBe(false);
  });

  it('只有 active 能登录', () => {
    expect(Account.from(state({ status: 'active' })).canLogin()).toBe(true);
    for (const status of ['suspended', 'deleted', 'pending'] as const) {
      expect(Account.from(state({ status })).canLogin()).toBe(false);
    }
  });

  it('只有 deleted 释放邮箱', () => {
    expect(Account.from(state({ status: 'deleted' })).releasesEmail()).toBe(
      true,
    );
    expect(Account.from(state({ status: 'active' })).releasesEmail()).toBe(
      false,
    );
  });

  it('canSetPassword 要求既活跃又有邮箱', () => {
    expect(Account.from(state()).canSetPassword()).toBe(true);
    // 停用的账号不能通过「忘记密码」重新拿到可用凭据。
    expect(Account.from(state({ status: 'suspended' })).canSetPassword()).toBe(
      false,
    );
    // 没邮箱就收不到验证码。
    expect(Account.from(state({ email: null })).canSetPassword()).toBe(false);
  });
});
