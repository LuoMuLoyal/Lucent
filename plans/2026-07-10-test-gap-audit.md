# Lucent 测试缺口审查与补充计划

> 创建日期：2026-07-10
> 范围：`Lucent/src` 全部模块 + `Lucent/test` E2E

## 一、审查方法

- 枚举 `src/modules/**/*.service.ts`、`*.controller.ts`、`*.repository.ts`、`*.provider.ts`、`*.guard.ts`
- 枚举 `src/common/**/*.ts` 非 index/纯类型文件
- 枚举 `src/config/**/*.ts`、`src/admin/**/*.ts`
- 与已有 `*.spec.ts`（121 个）和 `*.e2e-spec.ts`（17 个）做配对比对
- E2E 覆盖按模块级 `test/e2e/<module>/` 目录存在性判定

## 二、全局统计

| 维度                        | 数量                                             |
| --------------------------- | ------------------------------------------------ |
| 单元测试文件 `.spec.ts`     | 121 → 139（P0）→ 149（P1）→ 173（P2）→ 186（P3） |
| E2E 测试文件 `.e2e-spec.ts` | 17 → 19（P1 后）                                 |
| 源 Service 文件（modules）  | 109                                              |
| 源 Service 文件（common）   | 7                                                |
| 源 Controller 文件          | 21                                               |
| 源 Repository 文件          | 8                                                |
| 源 Provider 文件            | 5                                                |
| 源 Guard 文件               | 2                                                |
| Jest 覆盖率阈值             | branches 50%, functions/lines/statements 60%     |

## 三、后续优先级

- 覆盖率阈值逐步提升至 branches 70% / functions+lines+statements 80%
