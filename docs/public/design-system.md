---
title: '全局设计规范'
tags:
  - design
  - tokens
created: 2026-05-29
updated: 2026-05-29
---

# Luminous 全局设计规范

> 基于 Airbnb 设计语言（参考 DESIGN.md），统一管理颜色、间距、字号、圆角、阴影。
> 所有组件必须引用 token 常量，禁止写魔数。

---

## 颜色系统

### 主色（跟随主题切换，定义在 `AppThemeSpec`）

| Token            | 默认值(softGlow) | 用途                 |
| ---------------- | ---------------- | -------------------- |
| `lightPrimary`   | `#66BB6A` 柔和绿 | 主 CTA、链接、选中态 |
| `lightSecondary` | `#A5D6A7` 薄荷绿 | 辅助强调、装饰       |
| `lightTertiary`  | `#FFD54F` 暖金   | 第三强调、标签       |
| `darkPrimary`    | `#A5D6A7` 浅绿   | 暗色模式主色         |
| `darkSurface`    | `#14231A` 绿黑   | 暗色卡片背景         |

### 固定色（`AppUiConstants`，不随主题变）

| Token                  | 值        | 用途                        |
| ---------------------- | --------- | --------------------------- |
| `PAGE_BACKGROUND`      | `#FFFFFF` | 亮色页面背景（Canvas）      |
| `PAGE_BACKGROUND_DARK` | `#0B1A0E` | 暗色页面背景                |
| `TAB_INACTIVE`         | `#6A6A6A` | 未选中 Tab（Muted）         |
| `TEXT_PRIMARY`         | `#222222` | 主要文字（Ink，近黑）       |
| `TEXT_SECONDARY`       | `#3F3F3F` | 次要文字（Body）            |
| `TEXT_MUTED`           | `#929292` | 辅助/禁用文字（Muted Soft） |
| `TEXT_PRIMARY_DARK`    | `#F2F6F2` | 暗色主要文字                |
| `DIVIDER`              | `#DDDDDD` | 分割线（Hairline）          |
| `BORDER`               | `#DDDDDD` | 卡片描边（Hairline）        |
| `BORDER_SOFT`          | `#EBEBEB` | 较柔和描边（Hairline Soft） |
| `BORDER_STRONG`        | `#C1C1C1` | 较强描边（Border Strong）   |
| `BORDER_DARK`          | `#324432` | 暗色描边                    |
| `SUCCESS`              | `#66BB6A` | 成功                        |
| `WARNING`              | `#FFA726` | 警告                        |
| `ERROR`                | `#C13515` | 错误（Primary Error Text）  |
| `ERROR_HOVER`          | `#B32505` | 错误悬停                    |
| `INFO`                 | `#428BFF` | 信息（Legal Link Blue）     |

### 使用原则

- 仅 `AppThemeSpec` 中的颜色随主题切换
- `AppUiConstants` 中的颜色全局固定
- 语义色（SUCCESS/WARNING/ERROR/INFO）不随主题变

---

## 间距系统（`AppSpacing`，4px 网格）

基于 DESIGN.md Airbnb 间距系统。

| Token     | 值   | 用途                                            |
| --------- | ---- | ----------------------------------------------- |
| `xxs`     | 2px  | 极小间距（图标与文字间距、密集型元素）          |
| `xs`      | 4px  | 小间距（组件内元素间、category-strip dividers） |
| `sm`      | 8px  | 中间距（caption/date-row gutters、卡片内容）    |
| `md`      | 12px | 中大间距（列表项内、卡片内边距）                |
| `base`    | 16px | 页面边距（property-card meta、卡片间 gutter）   |
| `lg`      | 24px | 大区块间距（host-card padding、footer gutters） |
| `xl`      | 32px | 页面级段落间距                                  |
| `xxl`     | 48px | 大段落间距                                      |
| `section` | 64px | 段落间距（major page bands）                    |
| `tile`    | 80px | 全宽 Tile（Apple 风格）                         |

### 预设 EdgeInsets

| Token          | 值              | 用途         |
| -------------- | --------------- | ------------ |
| `hPage`        | H:16            | 页面水平边距 |
| `allPage`      | 16              | 页面全向     |
| `allCard`      | 12              | 卡片全向     |
| `cardContent`  | L12 T10 R12 B12 | 卡片内容     |
| `inputContent` | H12 V14         | 输入框       |

### 预设 SizedBox

| Token                   | 用途     |
| ----------------------- | -------- |
| `gapXxs` ~ `gapSection` | 垂直间距 |
| `gapWXxs` ~ `gapWBase`  | 水平间距 |

---

## 字号系统（`AppTypography`）

基于 DESIGN.md Airbnb 字号系统，字重适度，display 以 500–600 为主。

| Token          | 值     | 用途                                  |
| -------------- | ------ | ------------------------------------- |
| `microTag`     | 8px    | 微型标签（uppercase-tag / NEW badge） |
| `badge`        | 11px   | 徽章文字（guest-favorite-badge）      |
| `tab`          | 12px   | Tab 标签、脚注、micro-label           |
| `caption`      | 13px   | 副标题、chip 文字                     |
| `bodySmall`    | 14px   | 次要正文（body-sm）                   |
| `body`         | 16px   | 正文（body-md、button-md、title-md）  |
| `bodyLarge`    | 17px   | 主正文（Apple 标准）                  |
| `button`       | 18px   | 按钮                                  |
| `titleLg`      | 20px   | 子区块标题（display-sm）              |
| `tagline`      | 21px   | 标题副文案（display-md）              |
| `display`      | 22px   | 列表详情标题（display-lg）            |
| `lead`         | 24px   | 引导文字                              |
| `displayLarge` | 28px   | 首页大标题（display-xl）              |
| `hero`         | 64px   | 评分展示（rating-display）            |
| `cardTitle`    | 13.8px | 卡片产品名                            |
| `cardMeta`     | 12.2px | 卡片规格信息                          |

---

## 圆角系统（`AppRadius`）

基于 DESIGN.md Airbnb 圆角系统：所有交互元素圆润，仅 body grid 保留硬角。

| Token  | 值     | 用途                           |
| ------ | ------ | ------------------------------ |
| `none` | 0px    | 全宽 Tile、无圆角              |
| `xs`   | 4px    | 紧凑型元素                     |
| `sm`   | 8px    | 小按钮、内嵌图片（rounded.sm） |
| `chip` | 12px   | chip                           |
| `md`   | 14px   | 卡片圆角（rounded.md）         |
| `lg`   | 20px   | 大卡片（rounded.lg）           |
| `xl`   | 32px   | category-strip corners         |
| `full` | 9999px | 胶囊按钮、pill（rounded.full） |

### 预设 BorderRadius

| Token             | 等于                          |
| ----------------- | ----------------------------- |
| `tightRadius`     | `BorderRadius.circular(8)`    |
| `smRadius`        | `BorderRadius.circular(8)`    |
| `chipRadius`      | `BorderRadius.circular(12)`   |
| `mdRadius`        | `BorderRadius.circular(14)`   |
| `inputRadius`     | `BorderRadius.circular(16)`   |
| `cardRadius`      | `BorderRadius.circular(14)`   |
| `lgRadius`        | `BorderRadius.circular(20)`   |
| `xlRadius`        | `BorderRadius.circular(32)`   |
| `containerRadius` | `BorderRadius.circular(32)`   |
| `pillRadius`      | `BorderRadius.circular(9999)` |

---

## 阴影系统（`AppShadow`）

基于 DESIGN.md Airbnb 设计语言。系统本质上只有**一个阴影层级**。

| Token              | 效果                   | 用途                                 |
| ------------------ | ---------------------- | ------------------------------------ |
| `card`             | 三层叠加阴影组合       | 卡片悬浮、搜索栏、下拉菜单           |
| `cardBorder`       | 1px 描边模拟           | card 组合第一层                      |
| `cardMid`          | 0 2px 6px 浅层浮起     | card 组合第二层                      |
| `cardDeep`         | 0 4px 8px 主要投影     | card 组合第三层                      |
| `product`          | `0x38000000` 30px 3,5  | 产品图阴影（Apple 唯一 drop-shadow） |
| `surface`          | `0x33000000` 18px 0,10 | Toast、浮层                          |
| `bottomBar(color)` | 动态                   | 底部导航                             |
| `authCard`         | `0x100F172A` 12px 0,6  | 登录卡                               |

---

## 代码引用示例

```dart
import 'package:luminous/shared/design_tokens/app_spacing.dart';
import 'package:luminous/shared/design_tokens/app_radius.dart';
import 'package:luminous/shared/design_tokens/app_shadow.dart';
import 'package:luminous/shared/design_tokens/app_typography.dart';
import 'package:luminous/constants/app_ui_constants.dart';

// ❌ 禁止
Container(
  padding: EdgeInsets.fromLTRB(16, 12, 16, 12),
  decoration: BoxDecoration(
    borderRadius: BorderRadius.circular(20),
    color: Color(0xFFF5FAF5),
  ),
  child: Text('...', style: TextStyle(fontSize: 15)),
);

// ✅ 正确
Container(
  padding: AppSpacing.allCard,
  decoration: BoxDecoration(
    borderRadius: AppRadius.cardRadius,
    color: AppUiConstants.PAGE_BACKGROUND,
    boxShadow: AppShadow.card, // Airbnb 三层叠加阴影
  ),
  child: Text('...', style: TextStyle(fontSize: AppTypography.body)),
);
```

---

## 今日页组件库（`lib/shared/widgets/today/`）

> 2026-05-29 新增，供今日页及后续健康模块复用。

| 组件                 | 文件                        | 用途                                                        |
| -------------------- | --------------------------- | ----------------------------------------------------------- |
| `TodayProgressRing`  | `today_progress_ring.dart`  | 圆形进度环（CustomPainter），支持自定义颜色/尺寸/中心子组件 |
| `TodayStatCard`      | `today_stat_card.dart`      | 健康指标卡片（图标 + 数值 + 单位 + 标签）                   |
| `TodaySectionHeader` | `today_section_header.dart` | 区块标题行（左侧标题 + 右侧操作按钮）                       |
| `TodayEnvChip`       | `today_env_chip.dart`       | 环境指标标签（基于 TintedStatusChip）                       |

### 全局常量（`lib/constants/today_constants.dart`）

所有 UI 尺寸、默认值、Mock 数据、语义颜色均在 `TodayConstants` 中统一管理，禁止在 widget 代码中使用魔法数字。

关键常量分组：

- **喝水追踪**：`defaultWaterGoal`(8)、`waterRingSize`(80)、`waterRingStrokeWidth`(8)
- **健康指标**：心率/血压/睡眠正常范围阈值
- **环境等级**：花粉/紫外线指数分级阈值
- **Mock 数据**：`mockWaterIntake`、`mockHeartRate` 等
- **语义颜色**：`waterPrimaryColor`、`heartRateColor`、`bloodPressureColor` 等

### 使用规范

```dart
// ✅ 正确 — 引用常量 + 可复用组件
TodayProgressRing(
  progress: current / TodayConstants.defaultWaterGoal,
  center: Text('$current'),
)

// ❌ 禁止 — 魔法数字 + 硬编码样式
SizedBox(
  width: 80,
  height: 80,
  child: CircularProgressIndicator(value: 5 / 8),
)
```

---

## UI 依赖清单

> 2026-05-29 新增，基于 UI 实现计划三阶段需求引入。

| 包                     | 用途                   | 使用场景                                 |
| ---------------------- | ---------------------- | ---------------------------------------- |
| `fluttertoast`         | 原生风格 Toast         | 替换自研 `ToastUtils`，全局操作反馈      |
| `fl_chart`             | 折线图 / 柱状图 / 饼图 | 血压趋势、服药率、周报告、健康指标可视化 |
| `table_calendar`       | 日历组件               | 记录页月视图、经期标记、打卡日历         |
| `timeline_tile`        | 时间线组件             | 记录页按时间展示当日记录                 |
| `cached_network_image` | 网络图片缓存           | AI 食物识别结果、药品图片、相册缩略图    |
| `shimmer`              | 骨架屏加载             | 所有列表/卡片的 loading 占位             |
| `flutter_animate`      | 声明式动画             | 页面进入淡入滑入、卡片展开、列表项动画   |
| `lottie`               | Lottie 动画            | 空状态页、数据加载中、引导页插图         |
