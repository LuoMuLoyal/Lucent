import { matchesScope } from './notification.js';

/**
 * 作用域匹配 —— 幂等替换的唯一依据。
 *
 * 这个函数决定「这条通知要不要被替换掉」。写错的两个方向都有害：
 * - **太宽**：不同来源/日期的通知互相覆盖，用户丢掉本该看到的提醒；
 * - **太窄**：同一条通知反复堆叠，通知中心被同一件事刷满。
 */
describe('matchesScope', () => {
  const scope = { source: 'today-suggestion', date: '2026-10-25' };

  it('单个对象 payload：source 与 date 都相同才算同作用域', () => {
    expect(
      matchesScope({ source: 'today-suggestion', date: '2026-10-25' }, scope),
    ).toBe(true);
  });

  it('source 不同 → 不是同作用域', () => {
    expect(
      matchesScope({ source: 'today-analysis', date: '2026-10-25' }, scope),
    ).toBe(false);
  });

  it('date 不同 → 不是同作用域（同来源不同天是两条通知）', () => {
    expect(
      matchesScope({ source: 'today-suggestion', date: '2026-10-24' }, scope),
    ).toBe(false);
  });

  it('数组 payload：任一元素命中即算同作用域', () => {
    expect(
      matchesScope(
        [
          { source: 'other', date: '2026-10-25' },
          { source: 'today-suggestion', date: '2026-10-25' },
        ],
        scope,
      ),
    ).toBe(true);
  });

  it('数组 payload：全都不命中 → 不是同作用域', () => {
    expect(matchesScope([{ source: 'other', date: '2026-10-25' }], scope)).toBe(
      false,
    );
  });

  it('payload 为 null / undefined → 不是同作用域', () => {
    expect(matchesScope(null, scope)).toBe(false);
    expect(matchesScope(undefined, scope)).toBe(false);
  });

  it('payload 是标量 → 不是同作用域（历史列形状不确定）', () => {
    expect(matchesScope('today-suggestion', scope)).toBe(false);
    expect(matchesScope(42, scope)).toBe(false);
  });

  it('缺 source 或 date → 不是同作用域（不猜）', () => {
    expect(matchesScope({ source: 'today-suggestion' }, scope)).toBe(false);
    expect(matchesScope({ date: '2026-10-25' }, scope)).toBe(false);
  });

  it('嵌套数组元素不算（只认顶层平铺的对象）', () => {
    expect(
      matchesScope(
        [[{ source: 'today-suggestion', date: '2026-10-25' }]],
        scope,
      ),
    ).toBe(false);
  });
});
