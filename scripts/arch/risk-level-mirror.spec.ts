import { RISK_LEVELS } from '../../src/common/risk/risk-level.js';
import { MEDICINE_RISK_LEVELS } from '../../src/modules/medicines/domain/services/risk-model.js';

/**
 * 风险等级阶梯有两份定义，这条测试锁住它们不漂移。
 *
 * 为什么必须有两份：`common/risk/risk-level.ts` 是共享内核的真源（事件契约、
 * 通知、看板都用它），而 `medicines/domain/services/risk-model.ts` 的
 * `MedicineRiskLevel` 供领域层使用 —— `ddd-domain-purity` 只允许 `domain/**`
 * 引用同 domain 树内的文件，领域层**不能** import `src/common/`。
 *
 * 为什么守卫放在 `scripts/` 而不是 `src/common/`：`common-no-module-imports`
 * 的 `from: ^src/common/` 覆盖该目录下所有文件（含 `*.spec.ts`），放在
 * `src/common/` 里的守卫自己就会把 arch 基线顶上去。`depcruise` 只扫 `src`，
 * `scripts/` 下的测试可以自由跨层 import。
 */
describe('risk level mirror', () => {
  it('declares the same ladder as medicines', () => {
    expect([...RISK_LEVELS]).toEqual([...MEDICINE_RISK_LEVELS]);
  });

  it('is not accidentally empty', () => {
    // A typo that emptied either array would make the equality above trivially
    // true; pin the shape so the guard cannot pass vacuously.
    expect(RISK_LEVELS.length).toBeGreaterThan(0);
    expect(MEDICINE_RISK_LEVELS.length).toBeGreaterThan(0);
  });

  it('orders levels from least to most severe', () => {
    // Order is part of the contract: consumers compare index positions to
    // decide "worse than". A reordering must fail here, not silently flip a
    // comparison somewhere downstream.
    expect([...RISK_LEVELS]).toEqual(['safe', 'caution', 'risk', 'danger']);
  });
});
