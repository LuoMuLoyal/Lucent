# Lucent 文件命名重构计划

> 创建日期：2026-07-12
> 状态：待执行
> 涉及仓库：Lucent

---

## 一、命名原则

### 核心规则

```
目录 = 命名空间（说明模块/层级）
文件名 = 具体职责（说明"做什么"，不说明"在哪里"）
```

### NestJS 特殊考虑

与 Flutter 不同，NestJS 有框架级文件名约定：

- `.service.ts`、`.controller.ts`、`.module.ts`、`.dto.ts` 是**框架约定的后缀**，由 NestJS CLI 生成，装饰器和工具链期望这些后缀
- 这些后缀**保留**，它们不是"重复目录的类型词"，而是 NestJS 的文件类型标识

因此 Lucent 的问题不在后缀，而在**前缀**：

- 模块名前缀在子目录中冗余：`legal-documents/services/legal-documents.service.ts` — `legal-documents` 前缀重复了模块目录
- 但 `.service.ts` 后缀保留

### 命名质量层级（NestJS 版）

| 层级     | 示例（在 `legal-documents/services/` 下） | 问题                                |
| -------- | ----------------------------------------- | ----------------------------------- |
| 冗余     | `legal-documents.service.ts`              | 前缀重复模块目录                    |
| **最佳** | `documents.service.ts`                    | 前缀 = 职责，后缀 = 框架约定        |
| 过度简化 | `service.ts`                              | 零职责信息（多 service 时无法区分） |

### 判断流程

```
文件名中有没有业务词（非模块名）？
├─ 否（如 service.ts, types.ts, constants.ts）→ 必须加上业务词
└─ 是（如 legal-documents.service.ts）
   └─ 前缀是否等于上级模块目录名？
      ├─ 是 → 替换为更具体的职责词
      └─ 否 → 已经是最佳，不改
```

---

## 二、问题清单

### 2.1 spec 文件与实现文件名称不匹配（3 处，最高优先级）

测试文件名对不上被测文件名，导致测试定位困难：

| spec 文件（根目录）                                       | 实际实现文件（子目录）               | 问题           | 建议                                           |
| --------------------------------------------------------- | ------------------------------------ | -------------- | ---------------------------------------------- |
| `daily-records/daily-records.service.spec.ts`             | `services/records.service.ts`        | **名称不匹配** | 移入 `services/records.service.spec.ts`        |
| `medicine-reminders/medicine-reminders.service.spec.ts`   | `services/reminders.service.ts`      | **名称不匹配** | 移入 `services/reminders.service.spec.ts`      |
| `user-health-context/user-health-context.service.spec.ts` | `services/health-context.service.ts` | **名称不匹配** | 移入 `services/health-context.service.spec.ts` |

### 2.2 spec 文件放置位置不一致（9 处）

spec 文件放在模块根目录，但实现文件在 `services/` 子目录中（名称匹配但位置错）：

| spec 文件（根目录）                                     | 实现文件（子目录）                       | 建议             |
| ------------------------------------------------------- | ---------------------------------------- | ---------------- |
| `legal-documents/legal-documents.service.spec.ts`       | `services/legal-documents.service.ts`    | 移入 `services/` |
| `medicine-dose-logs/medicine-dose-logs.service.spec.ts` | `services/medicine-dose-logs.service.ts` | 移入 `services/` |
| `testing-support/testing-support.service.spec.ts`       | `services/testing-support.service.ts`    | 移入 `services/` |
| `medicines/medicines.service.spec.ts`                   | `services/medicines.service.ts`          | 移入 `services/` |
| `notifications/notifications.service.spec.ts`           | `services/notifications.service.ts`      | 移入 `services/` |
| `environment/environment.service.spec.ts`               | `services/environment.service.ts`        | 移入 `services/` |
| `user-settings/user-settings.service.spec.ts`           | `services/user-settings.service.ts`      | 移入 `services/` |
| `account/account.service.spec.ts`                       | `services/account.service.ts`            | 移入 `services/` |
| `user/user.service.spec.ts`                             | `services/user.service.ts`               | 移入 `services/` |

> 对比 `today-suggestion/services/suggestion.service.spec.ts` — spec 与实现同级，是正确做法。

### 2.3 模块名前缀在 `services/` 子目录中冗余（12 个文件）

模块目录已说明所属模块，文件名中的模块名前缀冗余。保留 `.service.ts` 后缀，替换前缀为更具体的职责词：

| 当前文件                                 | 所在模块目录           | 建议改为                             | 职责说明                             |
| ---------------------------------------- | ---------------------- | ------------------------------------ | ------------------------------------ |
| `services/legal-documents.service.ts`    | `legal-documents/`     | `services/documents.service.ts`      | 管理法律文档                         |
| `services/testing-support.service.ts`    | `testing-support/`     | `services/fixtures.service.ts`       | 管理测试夹具                         |
| `services/support-resources.service.ts`  | `support-resources/`   | `services/resources.service.ts`      | 管理支持资源                         |
| `services/environment.service.ts`        | `environment/`         | `services/snapshot.service.ts`       | 环境快照查询                         |
| `services/user-settings.service.ts`      | `user-settings/`       | `services/settings.service.ts`       | 用户设置读写                         |
| `services/notifications.service.ts`      | `notifications/`       | `services/notifications.service.ts`  | 保留（notifications 本身就是职责词） |
| `services/account.service.ts`            | `account/`             | `services/account.service.ts`        | 保留（account 本身就是职责词）       |
| `services/user.service.ts`               | `user/`                | `services/user.service.ts`           | 保留（user 本身就是职责词）          |
| `services/files.service.ts`              | `files/`               | `services/files.service.ts`          | 保留（files 本身就是职责词）         |
| `services/medicines.service.ts`          | `medicines/`           | `services/medicines.service.ts`      | 保留（medicines 本身就是职责词）     |
| `services/medicine-dose-logs.service.ts` | `medicine-dose-logs/`  | `services/dose-logs.service.ts`      | 服药记录管理                         |
| `services/health-context.service.ts`     | `user-health-context/` | `services/health-context.service.ts` | 保留（health-context 是职责词）      |

> 需要改的：**5 个**（legal-documents、testing-support、support-resources、environment、medicine-dose-logs）。
> 保留的：7 个（模块名本身就是职责词，不是冗余）。
> 已做对的范例：`today-suggestion/services/suggestion.service.ts`、`daily-records/services/records.service.ts`、`medicine-reminders/services/reminders.service.ts`。

### 2.4 模块名前缀在 `dto/` 子目录中冗余（16 个文件）

| 当前文件                                   | 建议改为                    | 职责说明 |
| ------------------------------------------ | --------------------------- | -------- |
| `dto/legal-document-query.dto.ts`          | `dto/query.dto.ts`          | 查询参数 |
| `dto/legal-document-response.dto.ts`       | `dto/response.dto.ts`       | 响应体   |
| `dto/health-context-response.dto.ts`       | `dto/response.dto.ts`       | 响应体   |
| `dto/update-health-context-profile.dto.ts` | `dto/update-profile.dto.ts` | 更新档案 |
| `dto/create-medicine-reminder.dto.ts`      | `dto/create.dto.ts`         | 创建     |
| `dto/medicine-reminder-response.dto.ts`    | `dto/response.dto.ts`       | 响应体   |
| `dto/update-medicine-reminder.dto.ts`      | `dto/update.dto.ts`         | 更新     |
| `dto/support-resources-query.dto.ts`       | `dto/query.dto.ts`          | 查询参数 |
| `dto/support-resources-response.dto.ts`    | `dto/response.dto.ts`       | 响应体   |
| `dto/environment-snapshot-query.dto.ts`    | `dto/snapshot-query.dto.ts` | 快照查询 |
| `dto/environment-snapshot.dto.ts`          | `dto/snapshot.dto.ts`       | 快照体   |
| `dto/user-settings-response.dto.ts`        | `dto/response.dto.ts`       | 响应体   |
| `dto/update-user-settings.dto.ts`          | `dto/update.dto.ts`         | 更新     |
| `dto/notifications-response.dto.ts`        | `dto/response.dto.ts`       | 响应体   |
| `dto/account-response.dto.ts`              | `dto/response.dto.ts`       | 响应体   |
| `dto/update-account.dto.ts`                | `dto/update.dto.ts`         | 更新     |

> 已做对的范例：`medicine-dose-logs/dto/create-dose-log.dto.ts`、`daily-records/dto/create-record.dto.ts`。

### 2.5 模块名前缀在 `constants/` 和 `types/` 子目录中冗余（4 个文件）

| 当前文件                                                 | 建议改为       |
| -------------------------------------------------------- | -------------- |
| `legal-documents/constants/legal-documents.constants.ts` | `constants.ts` |
| `user-settings/constants/user-settings.constants.ts`     | `constants.ts` |
| `user-health-context/types/health-context.types.ts`      | `types.ts`     |
| `daily-records/types/daily-records.types.ts`             | `types.ts`     |

> 对比 `daily-records/constants/meal-analysis.constants.ts` — 保留前缀是对的（`meal-analysis` 是子主题不是模块名）。
> 对比 `daily-records/types/meal-analysis.types.ts` — 同理，保留。

### 2.6 模块名前缀在 `config/` 子目录中冗余（1 个文件）

| 当前文件                                      | 建议改为       |
| --------------------------------------------- | -------------- |
| `environment/config/environment-reference.ts` | `reference.ts` |

### 2.7 子目录名前缀在深层嵌套中冗余（8 个文件）

模块内部子分组目录名又重复到文件名上：

| 目录                                     | 当前文件                           | 建议改为               |
| ---------------------------------------- | ---------------------------------- | ---------------------- |
| `today-suggestion/services/explanation/` | `explanation-queue.service.ts`     | `queue.service.ts`     |
|                                          | `explanation.service.ts`           | `service.ts`           |
|                                          | `explanation-generator.service.ts` | `generator.service.ts` |
| `today-suggestion/services/feedback/`    | `feedback.service.ts`              | `service.ts`           |
|                                          | `feedback-stats.service.ts`        | `stats.service.ts`     |
| `today-suggestion/services/lifecycle/`   | `lifecycle.service.ts`             | `service.ts`           |
| `today-suggestion/services/arbitration/` | `arbitration.service.ts`           | `service.ts`           |
| `daily-records/services/candidates/`     | `candidates.service.ts`            | `service.ts`           |

> 对比同目录下的 `scoring.service.ts`、`suppression.service.ts`、`generator.service.ts`、`copy.service.ts` — 这些短名是正确做法。
> `service.ts` 在子目录中只有单一 service 时是可接受的——目录名（如 `explanation/`）已经是职责词。

### 2.8 `common/helpers/` 命名后缀不一致

同一目录下混用 `.helper.ts`、`.helpers.ts`、`.utils.ts` 三种后缀：

| 当前文件                     | 后缀风格              | 建议改为                    |
| ---------------------------- | --------------------- | --------------------------- |
| `prisma-ownership.helper.ts` | `.helper.ts`（单数）  | `prisma-ownership.utils.ts` |
| `prisma.helpers.ts`          | `.helpers.ts`（复数） | `prisma.utils.ts`           |

> 其余 `.utils.ts` 文件（8 个）和无后缀文件（4 个）保持不变。统一为 `.utils.ts` 风格。

### 2.9 `common/constants/` 后缀不一致

| 当前文件                 | 后缀风格               | 建议改为        |
| ------------------------ | ---------------------- | --------------- |
| `mime-types.constant.ts` | `.constant.ts`（单数） | `mime-types.ts` |

> 目录名 `constants/`（复数），文件用 `.constant.ts`（单数），不一致。与 `user-setting-keys.ts`（无后缀）统一。

---

## 三、统计

| 类别                               | 文件数  |
| ---------------------------------- | ------- |
| spec 与实现名称不匹配              | 3       |
| spec 放置位置不一致                | 9       |
| 模块名前缀在 services/ 冗余        | 5       |
| 模块名前缀在 dto/ 冗余             | 16      |
| 模块名前缀在 constants/types/ 冗余 | 4       |
| 模块名前缀在 config/ 冗余          | 1       |
| 子目录名前缀冗余                   | 8       |
| common/helpers 后缀不一致          | 2       |
| common/constants 后缀不一致        | 1       |
| **合计**                           | **~49** |

---

## 四、实施计划

### Phase 1：spec 名称不匹配修复（3 个文件，最高优先级）

测试文件名对不上被测文件名，是 bug 级别问题。

| 步骤 | 内容                                                                                                 | 工作量 |
| ---- | ---------------------------------------------------------------------------------------------------- | ------ |
| 1    | `daily-records.service.spec.ts` → 移入 `services/` 并重命名为 `records.service.spec.ts`              | 0.25h  |
| 2    | `medicine-reminders.service.spec.ts` → 移入 `services/` 并重命名为 `reminders.service.spec.ts`       | 0.25h  |
| 3    | `user-health-context.service.spec.ts` → 移入 `services/` 并重命名为 `health-context.service.spec.ts` | 0.25h  |
| 4    | 修复 spec 文件内部 import 路径                                                                       | 0.25h  |
| 5    | `pnpm test` 验证                                                                                     | 0.25h  |

### Phase 2：spec 放置位置统一（9 个文件）

| 步骤 | 内容                                               | 工作量 |
| ---- | -------------------------------------------------- | ------ |
| 1    | 将 9 个根目录 spec 文件移入各自 `services/` 子目录 | 0.5h   |
| 2    | 修复 spec 文件内部 import 路径                     | 0.5h   |
| 3    | `pnpm test` 验证                                   | 0.25h  |

### Phase 3：dto/ 模块名前缀清理（16 个文件）

| 步骤 | 内容                            | 工作量 |
| ---- | ------------------------------- | ------ |
| 1    | 重命名 16 个 dto 文件           | 0.5h   |
| 2    | 全局搜索替换 import 路径        | 1h     |
| 3    | `pnpm build` + `pnpm test` 验证 | 0.5h   |

### Phase 4：services/ 模块名前缀清理（5 个文件）

| 步骤 | 内容                               | 工作量 |
| ---- | ---------------------------------- | ------ |
| 1    | 重命名 5 个 service 文件           | 0.25h  |
| 2    | 全局搜索替换 import 路径 + DI 引用 | 0.5h   |
| 3    | `pnpm build` + `pnpm test` 验证    | 0.25h  |

> 注意：class 名保持不变（如 `LegalDocumentsService`），只改文件名。NestJS DI 基于 class 名而非文件名。

### Phase 5：子目录名前缀 + constants/types/config 清理（13 个文件）

| 步骤 | 内容                                                                     | 工作量 |
| ---- | ------------------------------------------------------------------------ | ------ |
| 1    | 重命名 8 个子目录前缀文件 + 4 个 constants/types 文件 + 1 个 config 文件 | 0.5h   |
| 2    | 全局搜索替换 import 路径                                                 | 0.5h   |
| 3    | `pnpm build` + `pnpm test` 验证                                          | 0.25h  |

### Phase 6：common/ 后缀统一（3 个文件）

| 步骤 | 内容                                                       | 工作量 |
| ---- | ---------------------------------------------------------- | ------ |
| 1    | `prisma-ownership.helper.ts` → `prisma-ownership.utils.ts` | 0.1h   |
| 2    | `prisma.helpers.ts` → `prisma.utils.ts`                    | 0.1h   |
| 3    | `mime-types.constant.ts` → `mime-types.ts`                 | 0.1h   |
| 4    | 全局搜索替换 import 路径                                   | 0.25h  |
| 5    | `pnpm lint:check` + `pnpm build` + `pnpm test` 验证        | 0.25h  |

---

## 五、注意事项

### 5.1 NestJS 文件后缀是框架约定

`.service.ts`、`.controller.ts`、`.module.ts`、`.dto.ts` 后缀由 NestJS CLI 生成，框架工具链期望这些后缀。这些**不是**"重复目录的类型词"，而是 NestJS 的文件类型标识，**保留**。

与 Flutter 的区别：Flutter 的 `_provider`、`_page` 后缀是社区习惯，不是框架要求；NestJS 的 `.service.ts` 后缀是框架约定。

### 5.2 class 名与文件名

NestJS DI 基于 class 名（如 `LegalDocumentsService`），不基于文件名。重命名文件时 class 名可保持不变。但如果文件名与 class 名差异过大（如 `documents.service.ts` 中的 `LegalDocumentsService`），可考虑同步调整 class 名——这需要更新所有 DI 引用，风险较高，建议分两步走：先改文件名，后续再考虑 class 名。

### 5.3 spec 文件移入 services/ 的约定

Vitest 默认匹配 `**/*.spec.ts`，spec 文件移入 `services/` 子目录后无需改配置。这与 `today-suggestion/services/suggestion.service.spec.ts` 的现有模式一致。

### 5.4 分批提交

- `fix(test): 修复 spec 文件与实现文件名称不匹配`
- `refactor(test): 统一 spec 文件放置到 services/ 子目录`
- `refactor(naming): 清理 dto/ 模块名前缀冗余`
- `refactor(naming): 清理 services/ 模块名前缀冗余`
- `refactor(naming): 清理子目录名前缀和 constants/types 冗余`
- `refactor(naming): 统一 common/ 后缀命名风格`

### 5.5 不改动的部分

- 模块根文件（`xxx.controller.ts`、`xxx.module.ts`）— 保留模块名前缀是 NestJS 约定
- `.service.ts` / `.controller.ts` / `.module.ts` / `.dto.ts` 后缀 — 框架约定
- 子主题文件（如 `meal-analysis.constants.ts`、`meal-analysis.types.ts`）— 前缀表达子主题不是模块名
- `src/app.module.ts`、`src/app.controller.ts` — 根模块文件
- `src/config/*.config.ts` — 领域短名，非模块名
- `common/helpers/` 下无后缀文件（`api-errors.ts`、`client-ip.ts` 等）— 单一功能模块，无后缀合理

---

## 六、验证清单

- [ ] `pnpm lint:check` 零警告
- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm build` 成功
- [ ] `pnpm test` 全部通过
- [ ] 3 个名称不匹配的 spec 文件已修复
- [ ] 所有 service spec 文件与被测实现文件同级放置
- [ ] git diff 中只有 rename + import 路径变更，无逻辑改动
