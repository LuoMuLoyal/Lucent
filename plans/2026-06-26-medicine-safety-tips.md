# Medicine 安全提示"换一批"实施计划

## 背景与目标

Luminous `Medicine` 页面当前的安全提示区（`_SafetyTipsSection`）硬编码 4 条提示，"换一批"按钮仅触发 Toast。本计划目标：

1. 在 Lucent 后端新建 `GET /api/v1/medicines/safety-tips` API。
2. 提示内容持久化到数据库，并通过 AdminJS 可运营。
3. Luminous 前端移除硬编码，改为真实调用 API 并支持"换一批"。
4. 两次相邻刷新结果不重复。

## 已确认边界

| 边界     | 决策                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| API 路径 | `GET /api/v1/medicines/safety-tips`，复用现有 `MedicinesController`                      |
| 数据源   | 数据库持久化 + AdminJS 管理                                                              |
| 多语言   | 后端根据 `Accept-Language` 返回对应语言文本，前端保留图标/颜色映射                       |
| 渲染字段 | 后端返回：id、text、category；前端按 category 映射图标与颜色                             |
| 交互     | 每次点击"换一批"请求后端，后端随机返回 4 条                                              |
| 去重范围 | 仅排除**上一次**返回的 4 条 id，保证相邻两次不重复；更早历史不保证                       |
| 提示数量 | 初始 12 条通用提示（中英双语）                                                           |
| Category | 8 个初始 category：alcohol、caffeine、timing、storage、food、pregnancy、allergy、driving |

## 推荐方案

### 后端（Lucent）

#### 1. Prisma 模型

在 `schema.prisma` 新增：

```prisma
model MedicineSafetyTip {
  id          String   @id @default(cuid())
  contentZh   String
  contentEn   String
  category    String   // alcohol|caffeine|timing|storage|food|pregnancy|allergy|driving
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([isActive, sortOrder])
  @@map("medicine_safety_tips")
}
```

#### 2. Migration 与 Seed

- 生成 Prisma migration。
- 在 `prisma/seed.ts`（或新建 `prisma/seeds/medicine-safety-tips.seed.ts`）中写入 12 条初始数据。
- Seed 脚本需在开发环境跑一次，生产部署时跑一次。

#### 3. DTO

新增 `src/modules/medicines/dto/medicine-safety-tip-response.dto.ts`：

```ts
export class MedicineSafetyTipResponseDto {
  id: string;
  text: string;
  category: string;
}
```

#### 4. Controller Endpoint

在 `MedicinesController` 新增：

```ts
@Get('safety-tips')
@ApiOperation({ summary: '随机返回用药安全提示' })
@ApiQuery({ name: 'exclude', required: false, isArray: true, type: String })
@ApiResponse({ status: 200, type: [MedicineSafetyTipResponseDto] })
async getSafetyTips(
  @Query('exclude') exclude?: string | string[],
  @I18nLang() lang?: string,
) {
  const tips = await this.medicinesService.getRandomSafetyTips(
    Array.isArray(exclude) ? exclude : exclude ? [exclude] : [],
    lang,
  );
  return successEnvelope(tips);
}
```

注意：`@I18nLang()` 的使用方式需符合项目现有 i18n 约定。

#### 5. Service 逻辑

在 `MedicinesService` 新增 `getRandomSafetyTips(excludeIds: string[], lang?: string)`：

1. 查询 `isActive = true` 且 `id NOT IN excludeIds` 的记录。
2. 使用数据库随机排序（PostgreSQL `ORDER BY RANDOM()`）取前 4 条。
3. 如果结果不足 4 条且 `excludeIds` 非空，则清空 exclude 重新查询前 4 条（兜底，保证至少返回 4 条）。
4. 根据 `lang` 选择 `contentZh` 或 `contentEn` 作为 `text`。
5. 映射为 `MedicineSafetyTipResponseDto`。

#### 6. AdminJS 资源

在 `admin/adminjs.setup.ts` 中注册 `MedicineSafetyTip` 资源，支持 CRUD：

- 列表/编辑字段：`contentZh`、`contentEn`、`category`、`sortOrder`、`isActive`
- `category` 使用下拉枚举：alcohol、caffeine、timing、storage、food、pregnancy、allergy、driving
- `sortOrder` 数字输入
- `isActive` 布尔开关

#### 7. OpenAPI 导出

实现后运行 `pnpm export:openapi`，更新 `Lucent/docs/openapi.json`。

#### 8. 测试

- `medicines.controller.spec.ts`：新增 endpoint 测试，覆盖正常返回、exclude 去重、兜底逻辑。
- `medicines.service.spec.ts`：新增 service 测试，覆盖随机选择、语言选择、不足 4 条兜底。

### 前端（Luminous）

#### 1. 生成 OpenAPI Client

```bash
cd Luminous
dart run tool/regenerate_lucent_openapi.dart
```

确认生成后的 `MedicinesApi` 包含 `medicinesControllerGetSafetyTipsV1` 方法。

#### 2. 数据层

- 在 `lib/core/network/` 或对应 medicine feature 下新增 remote data source 方法。
- 在 `lib/features/medicine/data/repositories/` 新增/扩展 repository，暴露：

```dart
Future<List<MedicineSafetyTip>> getSafetyTips({List<String>? excludeIds});
```

- 新增 entity：`MedicineSafetyTip { id, text, category }`。
- Mock repository 也同步实现，用于测试。

#### 3. Provider

新增 provider：

```dart
final medicineSafetyTipsProvider = FutureProvider.autoDispose
    .family<List<MedicineSafetyTip>, List<String>>(
  (ref, excludeIds) async => ref.watch(...).getSafetyTips(excludeIds: excludeIds),
);
```

新增状态 notifier 或直接在 widget 中管理当前提示列表和上一次 id 列表。

#### 4. Category → 图标/颜色映射

在 `lib/features/medicine/presentation/` 新增 `medicine_safety_tip_style.dart`：

```dart
IconData safetyTipIcon(String category) => switch (category) { ... };
Color safetyTipColor(String category, AppThemeSurface surface) => switch (category) { ... };
```

映射表：

| category  | icon                   | color               |
| --------- | ---------------------- | ------------------- |
| alcohol   | local_drink_outlined   | surface.link        |
| caffeine  | coffee_rounded         | surface.warningDeep |
| timing    | schedule_rounded       | surface.link        |
| storage   | thermostat_rounded     | surface.teal        |
| food      | restaurant_rounded     | surface.success     |
| pregnancy | pregnant_woman_rounded | surface.warning     |
| allergy   | healing_rounded        | surface.error       |
| driving   | drive_eta_rounded      | surface.info        |

#### 5. UI 替换

修改 `medicine_mobile_reference_section.dart`：

- 将 `_SafetyTipsSection` 改为 `ConsumerWidget` 或包一层 `Consumer`。
- 移除硬编码 4 条提示。
- 初始加载时请求 API（exclude 为空）。
- 点击"换一批"时，用当前 4 条 id 作为 exclude 重新请求。
- 加载状态使用 `AppStateSkeletonView` 或 `AppInlineSkeletonBlock`。
- 错误状态使用 `AppStateErrorView` 带重试按钮。

#### 6. ARB 清理

前端不再硬编码文案，但保留以下 ARB key：

- `medicineSafetyTipsTitle`
- `medicineSafetyTipsRefreshAction`

删除以下 key（前端不再使用）：

- `medicineSafetyTipSpacing`
- `medicineSafetyTipCoffee`
- `medicineSafetyTipTiming`
- `medicineSafetyTipStorage`

运行 `flutter gen-l10n` 重新生成本地化文件。

#### 7. 测试

- 更新 `test/medicine/medicine_page_test.dart`：安全提示区不再断言硬编码文本，改为断言列表存在和"换一批"行为。
- 新增 widget test：模拟 provider，验证点击"换一批"会触发新请求。
- 新增 repository/data source 测试（如项目已有对应测试模式）。

### 文档更新

- `Lucent/docs/README.md`：如有 API 列表，补充 safety-tips endpoint。
- `Luminous/docs/migration-log/2026-06-26.md`：记录本次改动。
- `Luminous/docs/Next_Plan.md`：移除 deferred 项 "Medicine safety-tip '换一批'..."。
- `Luminous/docs/Current_State.md`：更新 Medicine 页面状态，说明安全提示已接入后端 API。
- 计划文件归档：本计划完成后，如不再需要，可删除项目 `Lucent/plans/` 与 `Luminous/plans/` 中的副本。

### 验证步骤

后端：

```bash
cd Lucent
pnpm lint:check
pnpm build
pnpm test:ci
pnpm export:openapi
```

前端：

```bash
cd Luminous
dart run tool/regenerate_lucent_openapi.dart
flutter pub get
flutter gen-l10n
dart run build_runner build --delete-conflicting-outputs
flutter analyze
flutter test
```

## TODOs（后续可扩展）

1. 丰富提示库：12 条只是起步，后续可扩展至 20+ 条，覆盖更多用药场景。
2. 用户画像关联：未来可根据用户年龄、过敏史、当前用药等返回更相关的提示。
3. 点击率统计：如需要，可在后端记录每条提示被展示/点击的次数。
4. 多语言扩展：当前只支持中英，后续如需可支持更多语言。

## 实施顺序建议

1. Lucent：schema + migration + seed + DTO + service + controller
2. Lucent：AdminJS 资源 + controller/service 测试 + OpenAPI 导出
3. Luminous：regenerate client + entity + repository + provider
4. Luminous：替换 UI + 清理 ARB + widget 测试
5. 文档更新 + 全量验证
