---
status: active
owner: backend
---

# user-health-context

用户健康上下文聚合：健康档案（profile）、过敏史（allergies）、病史
（conditions）、在服药品（current-medicines）。只服务「上下文」读取与
CRUD，不含通知偏好（notification-preferences）与设置开关（user-settings）。

## Endpoints（挂 `/user` 前缀，事实源 = openapi.json）

- `GET /api/v1/user/health-context` — 返回聚合资源：`summary`
  （age、onboardingCompleted、各类计数、missingCoreProfileFields）、
  `profile`、`allergies`、`conditions`、`currentMedicines`。
- `PATCH /api/v1/user/health-context/profile` — 更新档案（locale/timezone/
  unitSystem/activityLevel/birthDate/sexAtBirth/heightCm/dietaryPreferences/
  weightKg/onboardingCompleted；bloodType 与紧急联系人已移除）。`onboardingCompleted`
  是入参，出参只有 `profile.onboardingCompletedAt`：置 `true` 时仅在缺失时补
  `completedAt`，置 `false` 清空。`null` 表示清除字段，空串由写服务
  `normalizeNullableText` 归一为 `null`。
- `POST/PATCH/DELETE allergies|conditions|current-medicines`（`:id`）—
  三类记录的增改与软删：DELETE allergy 落 `isActive=false`；DELETE condition
  落 `status='resolved'` + `resolvedAt=今天`；DELETE current-medicine 落
  `isCurrent=false`，`endedAt` 已有值则保留、否则补今天。跨用户归属返回 403，
  不存在返回 404。每个写端点都返回更新后的完整聚合资源，并在成功写入后发
  `health-context.changed`（best-effort，失败只记日志，不回滚写入，也不会让
  写请求失败）。
- 集合只返回「活跃」子集：allergies 过滤 `isActive=true`、currentMedicines
  过滤 `isCurrent=true`（`types/health-context.types.ts` 的
  `userHealthContextInclude`），conditions 不过滤——已解决病史仍会随聚合返回。

## Profile extras 扩展字段（JSONB 提升）

`UserProfile.extras` JSONB 存稀疏扩展，映射到 DTO 顶层属性：

| 字段     | extras key           | DTO 位置                     | 约束                                                             |
| -------- | -------------------- | ---------------------------- | ---------------------------------------------------------------- |
| 体重 kg  | `weightKg`           | `profile.weightKg`           | 1–500 整数；`null` 清除                                          |
| 饮食偏好 | `dietaryPreferences` | `profile.dietaryPreferences` | 白名单枚举数组 ≤5 项（`DIETARY_PREFERENCE_VALUES`）；`null` 清除 |

- 写路径：`ProfileWriteService` **深合并** —— 先读现有 extras，只 set/delete
  指定 key 后整体写回，不碰无关 extras key（全部清空时写 `DbNull`）。
- 读路径：`UserHealthContextMapperService.toResponse` 以类型守卫提取提升
  为顶层属性；原始 `extras` 对象仍随响应返回（前向兼容）。

## 内部结构（services/）

- `health-context.service.ts` — 聚合读取与写入口编排（实现
  `IUserHealthContextReader`；每次写成功后 `getForUser` 回读，保证响应是聚合）。
- `writes/profile-write.service.ts` — 档案 upsert + extras 深合并。
- `writes/allergy-write.service.ts` / `condition-write.service.ts` /
  `medicine-write.service.ts` — 三类记录写服务。
- `ownership.service.ts` — 活跃用户存在性与记录归属判定。
- `mapper.service.ts` — Prisma 行 → DTO（date-only 格式化、age 计算、summary）。
- `repositories/health-context.repository.ts` — 经 `UserHealthContextRepositoryPort`
  注册（useExisting）。

## Dependencies

- 引用：Prisma；跨模块只经 barrel 取 `@CurrentUser()`/`UserPayload`（auth），
  不 import 其他业务模块的 repositories/dto。
- 被引用：`assistant`（`tools/read/read.service.ts` 经 `IUserHealthContextReader`
  读档案/过敏/病史/在服药品，受 assistantContext 设置门禁；读失败降级为空档案
  而不是中断该轮）。Barrel 只导出 `UserHealthContextService` 与
  `IUserHealthContextReader`——外部要读数据请用后者。

## Tests

`user-health-context.controller.spec.ts`、`services/health-context.service.spec.ts`、
`services/ownership.service.spec.ts`、`services/mapper.service.spec.ts`、
`services/writes/*.spec.ts`、`repositories/health-context.repository.spec.ts`。
