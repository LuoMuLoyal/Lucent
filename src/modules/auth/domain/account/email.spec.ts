import { describe, expect, it } from 'vitest';

import { canonicalizeEmail, isEmailShaped } from './email.js';

describe('canonicalizeEmail', () => {
  it('去首尾空白并转小写', () => {
    expect(canonicalizeEmail('  Test@Example.COM  ')).toBe('test@example.com');
  });

  it('不折叠点号，也不拆 + 后缀', () => {
    // 那些是 Gmail 的语义，套到所有地址上会把两个真实不同的账号合并成一个。
    expect(canonicalizeEmail('a.b+tag@example.com')).toBe(
      'a.b+tag@example.com',
    );
  });

  it('是幂等的', () => {
    const once = canonicalizeEmail('  A@B.COM ');
    expect(canonicalizeEmail(once)).toBe(once);
  });
});

describe('isEmailShaped', () => {
  it('接受常规地址', () => {
    expect(isEmailShaped('a@b.com')).toBe(true);
    expect(isEmailShaped('  A@B.CO  ')).toBe(true);
  });

  it('拒绝缺 @、缺本地部分、缺域名', () => {
    expect(isEmailShaped('not-an-email')).toBe(false);
    expect(isEmailShaped('@b.com')).toBe(false);
    expect(isEmailShaped('a@')).toBe(false);
  });

  it('拒绝多个 @', () => {
    expect(isEmailShaped('a@b@c.com')).toBe(false);
  });

  it('拒绝域名里的空段与无点域名', () => {
    expect(isEmailShaped('a@.com')).toBe(false);
    expect(isEmailShaped('a@b.')).toBe(false);
    expect(isEmailShaped('a@localhost')).toBe(false);
  });
});
