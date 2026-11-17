/**
 * 风险等级阶梯 —— 共享内核里的值对象（ADR-0024 §3）。
 *
 * 它属于**发布语言**，不是某个上下文的私有知识：`medicines` 用它给一次评估
 * 定级，通知按它分级推送，看板按它排序。因此定义在这里由各上下文引用，
 * 而不是在某个上下文里定义、其它地方再复制一份。
 *
 * **它有一份必须保持一致的副本**：`medicines/domain/services/risk-model.ts`
 * 的 `MedicineRiskLevel`。领域层不能 import 本文件（`ddd-domain-purity` 只允许
 * `domain/**` 引用同 domain 树），所以那边保留自己的字面量联合，
 * 由 `scripts/arch/risk-level-mirror.spec.ts` 锁定两边一致 —— 改一边必须改另一边。
 *
 * 为什么 guard 在 `scripts/` 而不在 `src/common/`：`common-no-module-imports`
 * 的 `from: ^src/common/` 覆盖该目录下的**所有**文件（含 `*.spec.ts`），
 * 放在 `src/common/` 里的守卫自己就会把 arch 基线顶上去。`depcruise` 只扫
 * `src`，`scripts/` 下的测试可以自由跨层 import。
 */

export type RiskLevel = 'safe' | 'caution' | 'risk' | 'danger';

/** Iterable form of {@link RiskLevel}, for schema/enumeration loops. */
export const RISK_LEVELS = ['safe', 'caution', 'risk', 'danger'] as const;
