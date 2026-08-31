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
- `PATCH profile` — 更新档案（locale/timezone/unitSystem/birthDate/
  sexAtBirth/heightCm/bloodType/onboardingCompleted/extras 扩展字段）。
- `POST/PATCH/DELETE allergies|conditions|current-medicines`（:id）—
  三类记录的增改与软删（deactivate/resolve）；跨用户归属返回 403，
  不存在返回 404。每个写端点都返回更新后的完整聚合资源。

## Profile extras 扩展字段（JSONB 提升）

`UserProfile.extras` JSONB 存稀疏扩展，映射到 DTO 顶层属性：

| 字段           | extras key              | DTO 位置                         | 约束                    |
| -------------- | ----------------------- | -------------------------------- | ----------------------- |
| 体重 kg        | `weightKg`              | `profile.weightKg`               | 1–500 整数；`null` 清除 |
| 紧急联系人姓名 | `emergencyContactName`  | `profile.emergencyContact.name`  | ≤50 字符；null/空清除   |
| 紧急联系人电话 | `emergencyContactPhone` | `profile.emergencyContact.phone` | ≤20 字符；null/空清除   |

- 写路径：`ProfileWriteService` **深合并** —— 先读现有 extras，只 set/delete
  指定 key 后整体写回，不碰无关 extras key（全部清空时写 `DbNull`）。
- 读路径：`UserHealthContextMapperService.toResponse` 以类型守卫提取提升
  为顶层属性；原始 `extras` 对象仍随响应返回（前向兼容）。

## 内部结构（services/）

- `health-context.service.ts` — 聚合读取与写入口编排（实现
  `IUserHealthContextReader`）。
- `writes/profile-write.service.ts` — 档案 upsert + extras 深合并。
- `writes/allergy-write.service.ts` / `condition-write.service.ts` /
  `medicine-write.service.ts` — 三类记录写服务。
- `ownership.service.ts` — 活跃用户存在性与记录归属判定。
- `mapper.service.ts` — Prisma 行 → DTO（date-only 格式化、age 计算、summary）。
- `repositories/health-context.repository.ts` — 经 `UserHealthContextRepositoryPort`
  注册（useExisting）。

## Dependencies

- 引用：Prisma；无跨模块 import。
- 被引用：`assistant`（经 `IUserHealthContextReader` port 读档案/过敏/
  病史/在服药品，受 assistantContext 设置门禁）。Barrel 导出
  `UserHealthContextService` 与 `IUserHealthContextReader`。

## Tests

`user-health-context.controller.spec.ts`、`services/health-context.service.spec.ts`、
`services/ownership.service.spec.ts`、`services/mapper.service.spec.ts`、
`services/writes/*.spec.ts`、`repositories/health-context.repository.spec.ts`。
