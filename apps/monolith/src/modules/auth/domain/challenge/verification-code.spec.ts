import { describe, expect, it } from 'vitest';

import {
  clampCodeLength,
  codeHashesMatch,
  deriveCodeHash,
  generateCode,
  MAX_CODE_LENGTH,
  MIN_CODE_LENGTH,
} from './verification-code.js';

/**
 * 验证码纯函数的单测。
 *
 * 不建 DI 容器、不碰缓存、不 mock 任何东西——这里验证的是三条安全性质本身
 * （绑定场景与邮箱、定时比对、密码学随机源），与存储无关。
 */
describe('generateCode', () => {
  it('生成指定位数的十进制码', () => {
    const code = generateCode(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('保留前导零（不是数字而是定长串）', () => {
    // 若实现成「随机整数再 toString」，`000123` 会变成 `123`，
    // 比对时长度不同直接失败——这是真实的线上故障形态。
    for (let i = 0; i < 200; i += 1) {
      expect(generateCode(6)).toHaveLength(6);
    }
  });

  it('位数被夹进合法范围', () => {
    expect(generateCode(1)).toHaveLength(MIN_CODE_LENGTH);
    expect(generateCode(0)).toHaveLength(MIN_CODE_LENGTH);
    expect(generateCode(-5)).toHaveLength(MIN_CODE_LENGTH);
    expect(generateCode(999)).toHaveLength(MAX_CODE_LENGTH);
  });

  it('位数下限足以抵抗暴力', () => {
    // 3 位只有 1000 种，配合有限的尝试窗口不够。
    expect(MIN_CODE_LENGTH).toBeGreaterThanOrEqual(4);
  });

  it('大量生成不重复（随机源不是常数）', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateCode(6)));
    // 6 位空间 10^6，500 次抽样几乎不可能有太多碰撞；要求至少 400 个不同值。
    expect(codes.size).toBeGreaterThan(400);
  });

  it('覆盖到 0 附近的取值（边界不偏向高端）', () => {
    // 5000 次抽样里，落在最小 1% 区间的期望是 50 次；若实现有偏（例如
    // 忘记下界），这里会明显偏低。用一个宽松阈值避免偶发失败。
    const hits = Array.from({ length: 5000 }, () => generateCode(6)).filter(
      (code) => Number(code) < 10_000,
    );
    expect(hits.length).toBeGreaterThan(10);
  });
});

describe('clampCodeLength', () => {
  it('非有限值退回下限', () => {
    expect(clampCodeLength(Number.NaN)).toBe(MIN_CODE_LENGTH);
    expect(clampCodeLength(Number.POSITIVE_INFINITY)).toBe(MIN_CODE_LENGTH);
  });

  it('小数被截断', () => {
    expect(clampCodeLength(6.9)).toBe(6);
  });

  it('范围内原样返回', () => {
    expect(clampCodeLength(6)).toBe(6);
    expect(clampCodeLength(MIN_CODE_LENGTH)).toBe(MIN_CODE_LENGTH);
    expect(clampCodeLength(MAX_CODE_LENGTH)).toBe(MAX_CODE_LENGTH);
  });
});

describe('deriveCodeHash', () => {
  it('是 64 位十六进制摘要', () => {
    expect(deriveCodeHash('123456', 'login', 'a@b.com')).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('【核心】同一个码在不同场景得到不同指纹', () => {
    // 指纹绑定场景，所以为 register 签发的码不能用于 login。
    expect(deriveCodeHash('123456', 'register', 'a@b.com')).not.toBe(
      deriveCodeHash('123456', 'login', 'a@b.com'),
    );
  });

  it('【核心】同一个码对不同邮箱得到不同指纹', () => {
    // 一个邮箱的码不能用于另一个邮箱——这是「邮箱所有权证明」的基础。
    expect(deriveCodeHash('123456', 'login', 'a@b.com')).not.toBe(
      deriveCodeHash('123456', 'login', 'c@d.com'),
    );
  });

  it('【核心】指纹不是只对码本身取摘要', () => {
    // 若指纹只含码，6 位数字的哈希空间只有 10^6，拿到存储值即可离线枚举。
    // 这里断言「同样的码 + 不同上下文 → 不同指纹」，即上下文确实参与了派生。
    const bare = deriveCodeHash('123456', '', '');
    const bound = deriveCodeHash('123456', 'login', 'a@b.com');
    expect(bound).not.toBe(bare);
  });

  it('是确定性的', () => {
    const a = deriveCodeHash('123456', 'login', 'a@b.com');
    const b = deriveCodeHash('123456', 'login', 'a@b.com');
    expect(a).toBe(b);
  });
});

describe('codeHashesMatch', () => {
  it('相同指纹匹配', () => {
    const hash = deriveCodeHash('123456', 'login', 'a@b.com');
    expect(codeHashesMatch(hash, hash)).toBe(true);
  });

  it('不同指纹不匹配', () => {
    const a = deriveCodeHash('123456', 'login', 'a@b.com');
    const b = deriveCodeHash('654321', 'login', 'a@b.com');
    expect(codeHashesMatch(a, b)).toBe(false);
  });

  it('长度不同不抛异常，返回 false', () => {
    // timingSafeEqual 对不等长入参会抛；这里必须自己先挡住。
    expect(codeHashesMatch('abc', 'abcdef')).toBe(false);
    expect(codeHashesMatch('', 'abc')).toBe(false);
  });
});
