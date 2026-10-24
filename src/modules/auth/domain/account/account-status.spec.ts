import { describe, expect, it } from 'vitest';

import {
  isLoginAllowed,
  isSessionBearing,
  releasesEmail,
  toAccountStatus,
} from './account-status.js';

describe('toAccountStatus', () => {
  it('识别四个已知状态', () => {
    expect(toAccountStatus('active')).toBe('active');
    expect(toAccountStatus('suspended')).toBe('suspended');
    expect(toAccountStatus('deleted')).toBe('deleted');
    expect(toAccountStatus('pending')).toBe('pending');
  });

  it('未知取值收敛成 suspended（失败方向是拒绝）', () => {
    // 数据里出现意外状态值时，当成「可以登录」会让本该被挡住的账号通过。
    expect(toAccountStatus('ACTIVE')).toBe('suspended');
    expect(toAccountStatus('')).toBe('suspended');
    expect(toAccountStatus('whatever')).toBe('suspended');
  });
});

describe('isSessionBearing', () => {
  it('只有 active 持有有效会话', () => {
    // 这就是「停用即时失效」的判据：守卫只看 token 里的 status，不查库。
    expect(isSessionBearing('active')).toBe(true);
    expect(isSessionBearing('suspended')).toBe(false);
    expect(isSessionBearing('deleted')).toBe(false);
    expect(isSessionBearing('pending')).toBe(false);
  });
});

describe('isLoginAllowed', () => {
  it('目前与 isSessionBearing 同值', () => {
    expect(isLoginAllowed('active')).toBe(true);
    expect(isLoginAllowed('suspended')).toBe(false);
  });
});

describe('releasesEmail', () => {
  it('软删除的账号释放邮箱，可被新账号复用', () => {
    expect(releasesEmail('deleted')).toBe(true);
    expect(releasesEmail('active')).toBe(false);
    expect(releasesEmail('suspended')).toBe(false);
  });
});
