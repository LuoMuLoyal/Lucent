# Today 主动建议引擎后端架构规划（优化版）

> **目标**：把 Today 页「主/次建议卡」的生成逻辑从客户端硬编码迁移到后端统一裁决引擎，使其能够按 `Product_Tab_Component_Blueprint` 和 `Product_Insights` 支持五类卡片，具备双触发链、冷启动基线、卡片生命周期、反馈驱动抑制、信号组合、通知升级和 AI 解释层，同时保持规则可解释、可审计、AI 仅做解释层。
>
> **范围**：后端架构 + API 合同 + 与前端数据模型的对应关系；不涉及具体 UI 改动。
> **前置阅读**：`Product_Tab_Component_Blueprint.md`、`Product_AI_Design.md`、`Product_Insights.md`、`Product_Information_Architecture.md`、`docs/00-current/Active_UI_Today.md`、`Lucent/AGENTS.md`。

---

## 0. 原方案问题诊断

### 0.1 命名违规（违反 `AGENTS.md` 文件命名规则）

| 问题                   | 原方案                                                              | 规则要求                                         |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| 模块名与文件前缀不一致 | 模块名 `today/`，但文件用 `today-suggestion.*` 前缀                 | 模块名与根文件前缀必须一致                       |
| 子目录文件重复模块前缀 | `dto/today-suggestion.dto.ts`                                       | 子目录文件不得重复模块名前缀                     |
| 非法文件后缀           | `.rule.ts`、`.collector.ts`、`.arbitrator.ts`、`.policy.ts`         | 所有 `@Injectable()` 必须使用 `.service.ts` 后缀 |
| 非白名单子目录         | `rules/`、`signals/`、`arbitrators/`                                | 不在 AGENTS.md 模块子目录白名单内                |
| 接口文件放错位置       | `rule.interface.ts`、`signal-collector.interface.ts` 放在自定义目录 | 接口/类型应放在 `types/` 白名单目录              |
| 缺少 barrel 导出       | 未提及 `index.ts`                                                   | 每个子目录必须有 `index.ts` barrel 导出          |

### 0.2 架构局限（与 `Product_Insights` 要求的差距）

| 产品要求                             | 原方案状态                 | 差距                                                      |
| ------------------------------------ | -------------------------- | --------------------------------------------------------- |
| 五类卡片（风险/依从/趋势/行为/说明） | 只定义四类，缺少「说明卡」 | `Product_Insights` 明确列出 5 类                          |
| 双触发链（事件触发 + 定时触发）      | 未区分触发链               | 事件触发可立即出卡，定时触发需连续记录                    |
| 冷启动与个人基线                     | 完全缺失                   | 趋势/行为卡在基线建立前不应出现；基线必须按维度独立       |
| 卡片生命周期（生成→激活→消退→失效）  | 仅有 `expiresAt`           | 证据失效后卡片不能继续占据 Today                          |
| 反馈驱动抑制（4 种反馈影响后续出卡） | Phase 4 模糊提及           | `Product_Insights` 要求反馈必须真实影响后续出卡           |
| 信号组合（弱信号合成强卡）           | 未支持                     | 多个弱信号可按预定义规则组合成更强卡                      |
| 通知升级                             | 未设计                     | 只有高优先级、强时效卡可升级为通知                        |
| 建议持久化                           | 未设计                     | Report 需要历史建议回顾（已执行/未执行/被延后）           |
| 缓存策略                             | 未设计                     | 信号采集查询多数据源，需要缓存                            |
| AI 集成                              | Phase 3 才接入，架构未预留 | AI 解释应作为架构一等工作，即使初期不调用                 |
| 与现有 `today-analysis` 模块复用     | 创建平行信号采集器         | `TodayAnalysisContextService` 已采集水/药/记录/睡眠上下文 |

---

## 1. 现状与痛点

当前 Today 的 `priorityItems` 由 `LucentTodayRepository.fetchDashboard()` 在前端硬编码组装，只产出两类：

- `TodayPriorityItemType.medication` — 待服药提醒
- `TodayPriorityItemType.water` — 饮水目标缺口

后端已有的相关能力：

- `POST /api/v1/user/today-analysis/generate` — AI 每日总结（summary + bullets + action + confidenceNote）
- `GET /api/v1/user/today-analysis/recommendations` — 随机今日健康推荐（仅用于观察项 fallback）
- `TodayAnalysisContextService` — 已构建水/药/记录/睡眠/低风险上下文

**痛点**：

1. 蓝图要求 Today 主/次卡能表达五类建议，但前端只有 2 个枚举分支，无法扩展。
2. 复杂 inference（如「恶化趋势」「行为建议」）需要跨多天、跨记录类型聚合，客户端拉取全部历史数据不现实。
3. 规则逻辑散落在前端，难以复用给 Report 历史建议回顾、通知文案生成、用药安全解释等其他表面。
4. 医疗/健康建议必须可解释、可审计，前端硬编码无法满足安全审校要求。
5. 缺少冷启动保护，新用户可能收到无基线支撑的趋势卡。
6. 缺少反馈闭环，用户「不适用」或「不想再看到」的反馈不会影响后续出卡。

---

## 2. 设计原则

1. **规则优先，AI 仅解释**（对齐 `Product_AI_Design`）
   - 所有「是否出现建议」「优先级排序」由规则引擎决定。
   - LLM 只负责生成自然语言解释、证据摘要、边界文案，不参与医疗/安全判定。
2. **信号与裁决分离**
   - Signal：原始事实（记录、用药计划、风险检查结果、健康档案）。
   - Candidate：规则命中后的候选建议。
   - Suggestion：经仲裁后返回给 Today 的最终卡片。
3. **双触发链**（对齐 `Product_Insights`）
   - 事件触发：新增药物、命中用药规则、到时未确认服药、新记录直接触发明确风险。
   - 定时触发：当日总结、跨天趋势、连续饮水不足、睡眠下降、咖啡因累计偏高。
4. **冷启动与维度基线**（对齐 `Product_Insights`）
   - 趋势/行为卡在个人基线建立前不出卡。
   - 基线按维度独立：睡眠基线只看睡眠记录，饮水基线只看饮水记录，饮食/咖啡因基线只看相关摄入记录，用药依从按计划事件单独判断。
5. **卡片生命周期**（对齐 `Product_Insights`）
   - 每张卡必须经历：生成 → 激活 → 消退 → 失效。
   - 证据失效后卡片不能继续占据 Today；证据冲突时系统弃权不出卡。
6. **反馈真实影响出卡**（对齐 `Product_Insights`）
   - 接受并执行 → 提高同类卡后续积极度。
   - 稍后处理 → 短期延后。
   - 不适用 → 一段时间内降权。
   - 不想再看到这类建议 → 强抑制，除非出现更高严重度的新证据。
7. **可审计**
   - 每张卡片必须携带 `ruleId` / `ruleVersion` / `evidence` / `confidence` / `triggerType`。
8. **向后兼容**
   - 新增接口，不破坏现有 `/today-analysis/generate` 和 `/today-analysis/recommendations`。
9. **复用现有上下文**
   - 信号采集层复用 `TodayAnalysisContextService` 已有的上下文构建逻辑，避免平行采集。
10. **分阶段落地**
    - 先做规则引擎骨架 + 替换现有两类（用药/饮水），再逐步加入趋势/说明/反馈/通知升级。

---

## 3. 核心架构：四层流水线

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Today Suggestion Pipeline                             │
├──────────────────────────────────────────────────────────────────────────┤
│  Signal Layer（信号采集）                                                  │
│  ├── 复用 TodayAnalysisContextService 的上下文构建                        │
│  ├── 扩展采集：多日记录趋势、剂量日志历史、风险检查结果                    │
│  ├── 健康档案：allergies, conditions, profile                             │
│  ├── 上下文：timeOfDay, triggerType(event|timer), userFeedbackHistory    │
│  └── 信号封装为 SuggestionSignal，带 source/kind/recordedAt/payload       │
├──────────────────────────────────────────────────────────────────────────┤
│  Candidate Layer（规则引擎）                                               │
│  ├── RuleRegistry：每条规则 = match(signal) → Candidate                  │
│  ├── 触发链标记：每条规则声明 triggerType（event|timer）                  │
│  ├── 冷启动门控：趋势/行为规则检查 BaselineService 是否已建立基线          │
│  ├── 信号组合：弱信号按预定义规则合成更强 Candidate                       │
│  ├── 规则示例：                                                            │
│  │   • missed_dose_pending      → 依从卡（事件触发，立即出卡）            │
│  │   • confirmed_risk           → 风险卡（事件触发，立即出卡）            │
│  │   • deteriorating_trend      → 趋势卡（定时触发，需基线+连续记录）     │
│  │   • water_behind_target      → 行为建议卡（定时触发，需连续记录）      │
│  │   • coverage_explanation     → 说明卡（定时触发，覆盖范围/不确定性）   │
│  └── 每条 Candidate 含：type, priorityScore, confidence, evidence[]       │
│     triggerType, ruleId, ruleVersion, expiresAt, lifecycleState           │
├──────────────────────────────────────────────────────────────────────────┤
│  Arbitration Layer（仲裁器）                                               │
│  ├── 过滤：confidence < threshold 或用户已 dismiss/强抑制的 candidate     │
│  ├── 反馈抑制：FeedbackService 查询用户历史反馈，应用降权/延后/抑制       │
│  ├── 排序：urgency × confidence × userRelevance × feedbackAdjustment      │
│  ├── 去重/合并：同类 candidate 合并，避免重复提醒                          │
│  ├── 截断：1 张 primary + 最多 2 张 secondary，其余降级为 observation     │
│  └── 通知升级：高优先级 candidate 标记 notificationEligible               │
├──────────────────────────────────────────────────────────────────────────┤
│  Lifecycle & Persistence Layer（生命周期与持久化）                         │
│  ├── 持久化：每张最终 Suggestion 写入 DB，供 Report 历史回顾              │
│  ├── 生命周期管理：生成 → 激活 → 消退 → 失效                              │
│  ├── 证据失效检测：信号过期后自动标记卡片为 fading/expired                │
│  └── 通知升级：notificationEligible 的卡片触发 NotificationsService       │
├──────────────────────────────────────────────────────────────────────────┤
│  Presentation Layer（API Response）                                       │
│  └── TodaySuggestionsResponseDto + metadata + lifecycleInfo              │
├──────────────────────────────────────────────────────────────────────────┤
│  AI Explanation Layer（可选，按需触发）                                    │
│  ├── 对复杂 candidate 生成自然语言 reason 和 boundary 变体                │
│  ├── 基于 evidence[] 生成，禁止生成 evidence 之外的内容                    │
│  └── 不阻塞首屏：前端先拿到规则生成的卡片，AI 解释按需加载                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型

### 4.1 卡片类型（对齐 `Product_Insights` 五类）

```ts
enum SuggestionType {
  CONFIRMED_RISK = 'confirmed_risk', // 风险卡：明确规则、药物、症状风险
  COMPLIANCE = 'compliance', // 依从卡：漏服、未确认、计划未执行、关键记录缺失
  TREND = 'trend', // 趋势卡：睡眠下降、饮水持续不足、咖啡因上升等连续变化
  BEHAVIOR_ADVICE = 'behavior_advice', // 行为建议卡：低风险生活方式建议
  COVERAGE = 'coverage', // 说明卡：覆盖范围、不确定性、为什么出现这张卡
}
```

> **与原方案差异**：原方案将 `missed_dose` 作为独立类型，实际应归入更宽泛的 `compliance`（依从卡），涵盖漏服、未确认、计划未执行、关键记录缺失。新增 `coverage`（说明卡）。

### 4.2 触发类型

```ts
enum TriggerType {
  EVENT = 'event', // 事件触发：新增药物、命中用药规则、到时未确认服药、新记录直接触发明确风险
  TIMER = 'timer', // 定时触发：当日总结、跨天趋势、连续饮水不足、睡眠下降、咖啡因累计偏高
}
```

### 4.3 卡片生命周期状态

```ts
enum SuggestionLifecycleState {
  GENERATED = 'generated', // 规则命中，候选生成
  ACTIVE = 'active', // 通过仲裁，展示在 Today
  FADING = 'fading', // 证据开始失效，降级展示
  EXPIRED = 'expired', // 证据完全失效或用户已处理
  DISMISSED = 'dismissed', // 用户主动 dismiss
}
```

### 4.4 反馈类型

```ts
enum SuggestionFeedback {
  ACCEPTED = 'accepted', // 接受并执行
  LATER = 'later', // 稍后处理
  NOT_APPLICABLE = 'not_applicable', // 不适用
  SUPPRESS = 'suppress', // 不想再看到这类建议
}
```

### 4.5 信号封装（后端内部）

```ts
interface SuggestionSignal {
  signalId: string;
  source: 'medication' | 'record' | 'risk_check' | 'profile' | 'environment';
  kind: string; // 例如 'pending_dose', 'water_count', 'symptom_severity'
  recordedAt: Date;
  payload: Record<string, unknown>;
  userId: string;
  triggerType: TriggerType;
}
```

### 4.6 候选建议

```ts
interface SuggestionCandidate {
  candidateId: string;
  ruleId: string;
  ruleVersion: string;
  type: SuggestionType;
  triggerType: TriggerType;
  title: string;
  reason: string;
  evidence: EvidenceItem[];
  boundary: string;
  primaryAction: SuggestionAction;
  secondaryActions?: SuggestionAction[];
  priorityScore: number; // 0-1000
  confidence: 'high' | 'medium' | 'low';
  expiresAt?: Date;
  notificationEligible: boolean; // 是否可升级为通知
  composedFrom?: string[]; // 如果是信号组合产生，记录来源 signalId 列表
}

interface EvidenceItem {
  kind: 'record' | 'reminder' | 'risk_check' | 'trend' | 'profile' | 'baseline';
  label: string;
  value: string;
  recordId?: string;
  medicineId?: string;
}

interface SuggestionAction {
  actionId: string;
  label: string;
  route: string;
  authRequired: boolean;
}
```

### 4.7 API Response DTO（给前端）

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "generatedAt": "2026-07-09T12:30:00+08:00",
    "primary": {
      "id": "sug_xxx",
      "type": "compliance",
      "cardTone": "urgent",
      "icon": "pill",
      "title": "上午的阿托伐他汀尚未确认",
      "reason": "计划服药时间为 08:00，当前已超时 4 小时且未标记服用。",
      "evidence": [
        { "kind": "reminder", "label": "计划时间", "value": "08:00" },
        { "kind": "record", "label": "今日状态", "value": "未确认", "recordId": "..." }
      ],
      "boundary": "此提醒基于您的用药计划，不能替代医生或药师建议。",
      "primaryAction": { "label": "去确认", "route": "/medicine", "authRequired": true },
      "secondaryActions": [
        { "label": "跳过此次", "route": "/medicine?action=skip&id=...", "authRequired": true }
      ],
      "confidence": "high",
      "ruleId": "missed_dose_pending",
      "ruleVersion": "1.0.0",
      "triggerType": "event",
      "lifecycleState": "active",
      "notificationEligible": true,
      "feedbackOptions": ["accepted", "later", "not_applicable"]
    },
    "secondary": [
      {
        "id": "sug_yyy",
        "type": "behavior_advice",
        "cardTone": "soft",
        "icon": "droplets",
        "title": "今日饮水还差 2 杯",
        "triggerType": "timer",
        "lifecycleState": "active",
        "feedbackOptions": ["accepted", "later", "not_applicable", "suppress"],
        ...
      }
    ],
    "observations": [
      {
        "id": "sug_zzz",
        "type": "coverage",
        "cardTone": "neutral",
        "title": "睡眠数据不足，暂无法生成睡眠趋势建议",
        "reason": "需要至少 3 天连续睡眠记录才能建立基线。",
        "lifecycleState": "active",
        ...
      }
    ]
  }
}
```

### 4.8 与前端实体的映射

| 后端 DTO                  | 前端实体                                    | 说明                                                                                                                  |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `primary` / `secondary[]` | `TodayPriorityItem` + `TodaySuggestionItem` | 扩展 `TodayPriorityItemType` 为 `medication / water / confirmedRisk / compliance / trend / behaviorAdvice / coverage` |
| `observations`            | `TodayRecommendation`                       | 低置信度内容继续走现有观察项区                                                                                        |
| `evidence[]`              | 主卡可折叠证据区                            | 保持不变                                                                                                              |
| `boundary`                | 主卡可折叠边界区                            | 保持不变                                                                                                              |
| `primaryAction.route`     | `context.go()` / `context.push()`           | 前端解析深度链接                                                                                                      |
| `feedbackOptions`         | 卡片底部反馈按钮                            | 根据后端返回的可用选项渲染                                                                                            |
| `lifecycleState`          | 卡片视觉状态                                | `fading` 时降低视觉权重                                                                                               |
| `triggerType`             | 不直接渲染                                  | 前端可用于决定刷新策略（event→即时刷新，timer→定时刷新）                                                              |

---

## 5. API 合同

### 5.1 新增接口

```http
GET /api/v1/user/today/suggestions
```

**Query Parameters**：

- `date` (optional, `YYYY-MM-DD`)：默认当天。
- `excludeIds` (optional, `string[]`)：用户已 dismiss 的建议 id，本次不再返回。
- `locale` (optional)：默认从 `Accept-Language` 读取，用于返回已本地化文案。

**Response**：见 4.7。

### 5.2 反馈接口

```http
POST /api/v1/user/today/suggestions/{id}/feedback
```

**Body**：

```json
{
  "feedback": "accepted" | "later" | "not_applicable" | "suppress"
}
```

**Response**：

```json
{
  "code": 200,
  "message": "ok",
  "data": {
    "suggestionId": "sug_xxx",
    "feedback": "later",
    "appliedEffect": "delayed_until" | "suppressed_type" | "boosted_type" | "noted",
    "expiresAt": "2026-07-09T18:00:00+08:00"
  }
}
```

反馈效果：

- `accepted` → `boosted_type`：同类规则后续出卡积极度提高
- `later` → `delayed_until`：该卡延后到指定时间再出现
- `not_applicable` → `suppressed_type`（临时）：同类卡在一段时间内降权
- `suppress` → `suppressed_type`（强）：同类卡强抑制，除非更高严重度新证据

### 5.3 建议详情接口（供 Report 历史回顾）

```http
GET /api/v1/user/today/suggestions/history
```

**Query Parameters**：

- `startDate` / `endDate` (optional, `YYYY-MM-DD`)：日期范围，默认最近 7 天。
- `type` (optional)：按类型筛选。
- `lifecycleState` (optional)：按状态筛选。

**Response**：`TodaySuggestionHistoryItem[]`，包含 `type`、`title`、`lifecycleState`、`feedback`、`generatedAt`、`resolvedAt` 等字段，供 Report 历史建议回顾区使用。

### 5.4 现有接口调整建议

- `/today-analysis/generate` 继续负责 AI 每日总结（summary + bullets），不承载卡片裁决。
- `/today-analysis/recommendations` 可逐步废弃，由 `/today/suggestions` 的 `observations` 替代。
- 未来可考虑把 `/today/suggestions` 与 dashboard 聚合为一个 `GET /api/v1/user/today/dashboard` 端点，一次性返回 suggestions + summary + vitals，减少前端请求数。

---

## 6. 规则引擎设计

### 6.1 规则接口

```ts
interface SuggestionRule {
  ruleId: string;
  ruleVersion: string;
  type: SuggestionType;
  triggerType: TriggerType;

  // 前置检查：冷启动基线是否满足
  isBaselineRequired: boolean;
  baselineDimensions?: BaselineDimension[];

  // 核心匹配逻辑
  match(
    signals: SuggestionSignal[],
    context: RuleContext,
  ): SuggestionCandidate | null;

  // 信号组合：声明此规则可消费哪些弱信号
  consumableSignalKinds?: string[];
}
```

### 6.2 规则示例

#### 6.2.1 风险卡 — confirmed_risk（事件触发，立即出卡）

**信号来源**：Medicine 风险检查结果。

```
IF riskCheck.findings.length > 0
AND finding.severity IN ['high', 'critical']
AND finding.status == 'confirmed'
THEN create Candidate(CONFIRMED_RISK)
     triggerType = EVENT
     priorityScore = 900 + severityBonus
     confidence = high
     evidence = [finding.title, finding.medicines, finding.ruleReference]
     primaryAction = { route: '/medicine/risk-check', label: '查看风险解释' }
     notificationEligible = true
     isBaselineRequired = false
```

#### 6.2.2 依从卡 — missed_dose（事件触发，立即出卡）

**信号来源**：reminders + doseLogs。

```
FOR each active reminder scheduled for today
  IF now > scheduledTime + gracePeriod (e.g. 30min)
  AND no doseLog for (medicineId, scheduledTime) with status taken/skipped
  THEN create Candidate(COMPLIANCE)
       triggerType = EVENT
       priorityScore = 800 + overdueMinutes/10
       confidence = high
       evidence = [planTime, medicineName, lastTakenAt]
       primaryAction = { route: '/medicine', label: '去确认' }
       notificationEligible = true
       isBaselineRequired = false
```

#### 6.2.3 趋势卡 — deteriorating_trend（定时触发，需基线 + 连续记录）

**信号来源**：symptom records（最近 N 天）。

```
IF baselineService.isBaselineReady(userId, 'symptom_severity')
AND symptom records in last 7 days >= 3
THEN
  FOR each symptom type recorded in last 7 days
    IF severity trend slope > threshold
    AND consecutiveDays >= 2
    THEN create Candidate(TREND)
         triggerType = TIMER
         priorityScore = 700
         confidence = medium/high based on record density
         evidence = [latest severity, trend direction, days count, baseline value]
         boundary = "请尽快线下就医或咨询医生。"
         primaryAction = { route: '/record/create?kind=symptom', label: '记录症状' }
         notificationEligible = false
         isBaselineRequired = true
         baselineDimensions = ['symptom_severity']
```

#### 6.2.4 行为建议卡 — water_behind_target（定时触发，需连续记录）

**信号来源**：daily records + targets。

```
IF baselineService.isBaselineReady(userId, 'water_intake')
AND water records in last 3 days >= 2
THEN
  water_count = records.where(kind == 'water' and date == today).sum(amount)
  IF water_count < target * 0.5 AND timeOfDay >= afternoon
  THEN create Candidate(BEHAVIOR_ADVICE, subtype='water')
       triggerType = TIMER
       priorityScore = 400
       confidence = medium
       evidence = [current cups, target cups, 3-day average]
       primaryAction = { route: '/record/create?kind=water', label: '去记录' }
       notificationEligible = false
       isBaselineRequired = true
       baselineDimensions = ['water_intake']
```

#### 6.2.5 说明卡 — coverage_explanation（定时触发）

**信号来源**：健康档案完整度 + 风险检查覆盖范围。

```
IF riskCheck.coverage == 'partial' OR healthContext.missingFields.length > 0
THEN create Candidate(COVERAGE)
     triggerType = TIMER
     priorityScore = 200
     confidence = high
     evidence = [missing fields, uncovered sources, coverage percentage]
     boundary = "当前药品安全检查覆盖范围有限，结果仅供参考。"
     primaryAction = { route: '/mine/health-context', label: '完善档案' }
     notificationEligible = false
     isBaselineRequired = false
```

#### 6.2.6 信号组合示例 — 咖啡因 + 睡眠关联

```
IF caffeine records in last 3 days show upward trend
AND sleep records in last 3 days show downward trend
AND baselineService.isBaselineReady(userId, 'caffeine_intake')
AND baselineService.isBaselineReady(userId, 'sleep_duration')
THEN create Candidate(TREND, subtype='caffeine_sleep_correlation')
     triggerType = TIMER
     priorityScore = 600
     confidence = medium
     evidence = [caffeine trend, sleep trend, correlation note]
     boundary = "这只是关联提示，不构成因果关系结论。"
     primaryAction = { route: '/record/create?kind=caffeine', label: '记录摄入' }
     composedFrom = [caffeine_signal_id, sleep_signal_id]
     notificationEligible = false
     isBaselineRequired = true
     baselineDimensions = ['caffeine_intake', 'sleep_duration']
```

---

## 7. 冷启动与个人基线

### 7.1 基线维度

```ts
enum BaselineDimension {
  WATER_INTAKE = 'water_intake',
  SLEEP_DURATION = 'sleep_duration',
  CAFFEINE_INTAKE = 'caffeine_intake',
  SYMPTOM_SEVERITY = 'symptom_severity',
  MEDICATION_ADHERENCE = 'medication_adherence',
  MOOD = 'mood',
}
```

### 7.2 基线建立规则

- 每个维度独立计算基线，不能用一个全局"已完成冷启动"状态替代。
- 基线建立条件：至少 N 天连续记录（默认 3 天，可配置）。
- 冷启动阶段只允许出：规则/安全类卡、计划事件卡、极保守的记录引导卡。
- 基线存储：`UserSuggestionBaseline` 表，按 `(userId, dimension)` 维度记录 `daysCollected`、`baselineValue`、`establishedAt`。

### 7.3 基线服务

```ts
interface BaselineService {
  isBaselineReady(userId: string, dimension: BaselineDimension): boolean;
  getBaseline(
    userId: string,
    dimension: BaselineDimension,
  ): BaselineRecord | null;
  recordObservation(
    userId: string,
    dimension: BaselineDimension,
    value: number,
    date: string,
  ): void;
}
```

---

## 8. 卡片生命周期管理

### 8.1 生命周期流转

```
GENERATED → ACTIVE → FADING → EXPIRED
                ↓
            DISMISSED (用户主动)
```

- **GENERATED**：规则命中，候选生成。
- **ACTIVE**：通过仲裁，展示在 Today 首屏。
- **FADING**：证据开始失效（如用药计划已过期、记录已超出时间窗口），卡片降级展示，视觉权重降低。
- **EXPIRED**：证据完全失效或用户已处理，从 Today 移除，保留在历史记录中。
- **DISMISSED**：用户主动 dismiss，不再展示，但保留在历史记录中。

### 8.2 证据失效检测

- 定时任务检查每张 ACTIVE 卡片的证据是否仍然有效。
- 用药类卡片：检查 doseLog 是否已更新为 taken/skipped。
- 记录类卡片：检查时间窗口是否已超出。
- 风险类卡片：检查 riskCheck 状态是否已变化。

### 8.3 证据冲突弃权

- 证据冲突（如同一药物既有"安全"又有"风险"结论）时，系统弃权不出卡。
- 证据不足或只能讲一个"也许有帮助"的故事时，系统弃权不出卡。

---

## 9. 反馈驱动抑制

### 9.1 反馈存储

```
UserSuggestionFeedback 表：
  userId, suggestionId, suggestionType, feedback, appliedAt, expiresAt
```

### 9.2 抑制策略

| 反馈类型         | 效果                        | 持续时间 | 例外                             |
| ---------------- | --------------------------- | -------- | -------------------------------- |
| `accepted`       | 同类规则后续出卡积极度 +10% | 永久     | 无                               |
| `later`          | 该卡延后到指定时间再出现    | 4 小时   | 如果严重度升级则立即重新出现     |
| `not_applicable` | 同类卡降权 -30%             | 7 天     | 如果出现更高严重度证据则恢复     |
| `suppress`       | 同类卡强抑制，不出卡        | 30 天    | 如果出现更高严重度的新证据则恢复 |

### 9.3 反馈服务

```ts
interface FeedbackService {
  recordFeedback(
    userId: string,
    suggestionId: string,
    feedback: SuggestionFeedback,
  ): FeedbackEffect;
  getActiveSuppressions(
    userId: string,
    suggestionType: SuggestionType,
  ): SuppressionRecord[];
  shouldSuppress(userId: string, candidate: SuggestionCandidate): boolean;
  applyFeedbackAdjustment(
    userId: string,
    candidate: SuggestionCandidate,
  ): SuggestionCandidate;
}
```

---

## 10. 通知升级

### 10.1 升级条件

只有满足以下条件的卡片才能升级为通知：

1. `notificationEligible == true`
2. `triggerType == EVENT`（事件触发的卡片）
3. `confidence == 'high'`
4. 用户未在当前时间窗口内收到过同类通知（避免通知轰炸）

### 10.2 可升级的卡片类型

- **依从卡**（到时未确认的用药计划）
- **风险卡**（明确规则风险）
- 用户已订阅的计划事件

### 10.3 升级流程

```
Arbitration Layer 标记 notificationEligible
→ Lifecycle Service 检查通知频率限制
→ NotificationsService.createOrReplaceScoped()
→ 通知发送
```

---

## 11. 缓存策略

### 11.1 信号缓存

- 信号采集结果按 `(userId, date)` 缓存到 Redis，TTL 5 分钟。
- 事件触发时（如新增药物、新记录）自动失效相关缓存。
- 冷启动基线按 `(userId, dimension)` 缓存，TTL 1 小时。

### 11.2 建议缓存

- 最终建议结果按 `(userId, date)` 缓存到 Redis，TTL 3 分钟。
- 用户 dismiss 反馈后立即失效缓存。
- 前端可通过 `Cache-Control: no-cache` 强制刷新。

---

## 12. 建议持久化

### 12.1 数据库表

```
UserSuggestion 表：
  id, userId, type, triggerType, ruleId, ruleVersion,
  title, reason, boundary, evidence (JSON),
  primaryAction (JSON), secondaryActions (JSON),
  priorityScore, confidence, lifecycleState,
  notificationEligible, notificationSentAt,
  feedback, feedbackAt,
  generatedAt, activatedAt, fadingAt, expiredAt,
  createdAt, updatedAt

UserSuggestionBaseline 表：
  id, userId, dimension,
  daysCollected, baselineValue, establishedAt,
  createdAt, updatedAt

UserSuggestionFeedback 表：
  id, userId, suggestionId, suggestionType,
  feedback, appliedAt, expiresAt,
  createdAt
```

### 12.2 用途

- **Report 历史建议回顾**：查询 `UserSuggestion` 表，展示已执行/未执行/被延后的建议。
- **反馈分析**：统计各类建议的接受率、忽略率，优化规则优先级。
- **审计**：每条建议可追溯到规则版本和证据。

---

## 13. AI 解释层（架构内建，按需调用）

### 13.1 设计原则

- AI 解释是架构的一等公民，但不阻塞首屏。
- 规则引擎先生成结构化卡片（含规则文案的 reason/boundary），前端立即渲染。
- AI 解释作为增强层，按需为复杂卡片生成更自然的语言变体。
- 所有 AI 输出必须基于 `evidence[]`，禁止生成 evidence 之外的内容。

### 13.2 AI 解释触发场景

- 趋势卡：生成更自然的趋势描述和因果关联提示。
- 信号组合卡：解释多个弱信号如何组合成更强建议。
- 说明卡：生成更友好的覆盖范围解释。
- 用户主动请求：前端可调用 `POST /today/suggestions/{id}/explain` 获取 AI 解释。

### 13.3 架构预留

- `prompts/` 目录存放 AI 解释 prompt 模板。
- `schemas/` 目录存放 AI 输出结构化 schema。
- 解释服务继承 `BaseAiGeneratorService`，与现有 `today-analysis` 的 AI 生成器共用基础设施。

---

## 14. 建议的目录结构（Lucent 后端）

> 严格遵循 `AGENTS.md` 文件命名规则：模块根文件保留模块名前缀，子目录文件不重复前缀，所有 `@Injectable()` 使用 `.service.ts` 后缀，所有子目录有 `index.ts` barrel 导出，只使用白名单子目录。

```
src/modules/today-suggestion/
├── today-suggestion.controller.ts              # 根文件：保留模块名前缀
├── today-suggestion.module.ts                  # 根文件：保留模块名前缀
├── today-suggestion.controller.spec.ts
├── dto/
│   ├── index.ts
│   ├── suggestion-response.dto.ts              # 不重复模块前缀
│   ├── suggestion-history.dto.ts
│   ├── feedback.dto.ts
│   ├── evidence-item.dto.ts
│   └── suggestion-action.dto.ts
├── types/
│   ├── index.ts
│   ├── suggestion.types.ts                     # SuggestionType, TriggerType, SuggestionLifecycleState, SuggestionFeedback
│   ├── signal.types.ts                         # SuggestionSignal 接口
│   ├── candidate.types.ts                      # SuggestionCandidate 接口
│   ├── rule.types.ts                           # SuggestionRule 接口
│   └── baseline.types.ts                       # BaselineDimension, BaselineRecord
├── constants/
│   ├── index.ts
│   ├── thresholds.constants.ts                 # 默认阈值（gracePeriod, trendSlope, etc.）
│   └── feedback.constants.ts                   # 反馈持续时间、抑制策略常量
├── prompts/
│   ├── index.ts
│   └── explanation.prompt.ts                   # AI 解释 prompt 模板
├── schemas/
│   ├── index.ts
│   └── explanation.schema.ts                   # AI 输出结构化 schema
└── services/
    ├── index.ts
    ├── suggestion.service.ts                   # 主编排器：Signal → Candidate → Arbitration → Lifecycle
    ├── suggestion.service.spec.ts
    ├── collectors/                             # 信号采集域
    │   ├── index.ts
    │   ├── medication.service.ts               # 用药信号采集
    │   ├── record.service.ts                   # 记录信号采集（多日趋势）
    │   ├── profile.service.ts                  # 健康档案信号采集
    │   └── risk-check.service.ts               # 风险检查信号采集
    ├── rules/                                  # 规则引擎域
    │   ├── index.ts
    │   ├── registry.service.ts                 # 规则注册表
    │   ├── missed-dose.service.ts              # 依从卡：漏服规则
    │   ├── confirmed-risk.service.ts           # 风险卡：确认风险规则
    │   ├── deteriorating-trend.service.ts      # 趋势卡：症状恶化规则
    │   ├── water-shortfall.service.ts          # 行为建议卡：饮水不足规则
    │   ├── sleep-shortfall.service.ts          # 行为建议卡：睡眠不足规则
    │   ├── caffeine-sleep.service.ts           # 趋势卡：咖啡因-睡眠关联规则（信号组合）
    │   └── coverage.service.ts                 # 说明卡：覆盖范围规则
    ├── arbitration/                            # 仲裁域
    │   ├── index.ts
    │   ├── arbitration.service.ts              # 排序、去重、截断
    │   ├── scoring.service.ts                  # 评分策略
    │   └── suppression.service.ts              # 反馈驱动抑制
    ├── lifecycle/                              # 生命周期域
    │   ├── index.ts
    │   ├── lifecycle.service.ts                # 生成→激活→消退→失效管理
    │   ├── baseline.service.ts                 # 冷启动与个人基线
    │   └── expiry.service.ts                   # 证据失效检测
    ├── feedback/                               # 反馈域
    │   ├── index.ts
    │   └── feedback.service.ts                 # 记录与应用用户反馈
    ├── notification/                           # 通知升级域
    │   ├── index.ts
    │   └── escalation.service.ts               # 通知升级判断与触发
    └── explanation/                            # AI 解释域
        ├── index.ts
        ├── explanation.service.ts              # AI 解释生成
        └── copy.service.ts                     # 本地化文案
```

### 14.1 命名合规说明

| 规则                      | 合规示例                                                            | 原方案违规示例                                         |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| 模块根文件保留模块名      | `today-suggestion.controller.ts`                                    | `today-suggestion.controller.ts`（模块名却叫 `today`） |
| 子目录文件不重复前缀      | `dto/suggestion-response.dto.ts`                                    | `dto/today-suggestion.dto.ts`                          |
| `.service.ts` 后缀        | `rules/missed-dose.service.ts`                                      | `rules/missed-dose.rule.ts`                            |
| 接口放 `types/`           | `types/rule.types.ts`                                               | `rules/rule.interface.ts`                              |
| 白名单子目录              | `services/`、`dto/`、`types/`、`constants/`、`prompts/`、`schemas/` | `rules/`、`signals/`、`arbitrators/`                   |
| 域子目录在 `services/` 下 | `services/collectors/`、`services/rules/`                           | `signals/`、`rules/`（模块根级）                       |
| 每个子目录有 barrel       | `services/rules/index.ts`                                           | 无 barrel                                              |

### 14.2 模块依赖关系

```
TodaySuggestionModule
  imports:
    - PrismaModule                          # 数据持久化
    - LlmRuntimeModule                      # AI 解释（可选调用）
    - TodayAnalysisModule                   # 复用 TodayAnalysisContextService
    - NotificationsModule                   # 通知升级
    - MedicinesModule                       # 风险检查信号
    - MedicineRemindersModule               # 用药提醒信号
    - DailyRecordsModule                    # 记录信号
    - UserHealthContextModule               # 健康档案信号

  exports:
    - SuggestionService                     # 供未来 dashboard 聚合端点使用
    - FeedbackService                       # 供通知模块查询反馈状态
```

---

## 15. 与现有后端的集成点

| 现有后端模块                                 | 新引擎如何使用                                                | 复用方式                            |
| -------------------------------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `TodayAnalysisContextService`                | 信号采集层复用其上下文构建逻辑（水/药/记录/睡眠）             | 直接注入，扩展多日查询              |
| `MedicineRiskCheckService`                   | 输出 `findings` 作为 `CONFIRMED_RISK` 信号                    | 通过 `MedicinesModule` 导出         |
| `MedicineReminderService` + `DoseLogService` | 输出 `COMPLIANCE` 信号                                        | 通过 `MedicineRemindersModule` 导出 |
| `DailyRecordService`                         | 输出 water/sleep/meal/symptom/mood 信号 + 多日趋势            | 通过 `DailyRecordsModule` 导出      |
| `HealthContextService`                       | 输出 allergies/conditions/currentMedicines 信号               | 通过 `UserHealthContextModule` 导出 |
| `NotificationsService`                       | 接收高优先级建议，生成 proactive 通知                         | 通过 `NotificationsModule` 导出     |
| `TodayAnalysisService`（AI 摘要）            | 继续独立运行；未来可消费 suggestion summary 作为 bullets 素材 | 不直接依赖                          |
| `BaseAiGeneratorService`                     | AI 解释层继承此基类                                           | 从 `common/ai/` 导入                |
| `AiSafetyPolicyService`                      | AI 解释输出经过安全策略检查                                   | 从 `common/ai/` 导入                |
| `LocalizedCopyService`                       | 本地化文案基类                                                | 从 `common/services/` 导入          |

---

## 16. 实现阶段

---

## 17. 安全、隐私与边界

1. **医疗免责声明**
   - 所有卡片 `boundary` 必须包含「不构成诊断/处方，必要时请咨询医生」。
2. **证据可溯源**
   - 每条 evidence 必须能映射回具体记录或规则来源，禁止黑盒结论。
3. **红线规则**
   - 禁止 LLM 直接给出「停药、加量、换药」建议。
   - 禁止 LLM 在未命中规则时虚构风险。
   - 红旗信号（高烧不退、呼吸困难、严重过敏）必须来自固定规则表和固定文案。
4. **隐私**
   - 规则引擎只使用用户已授权数据；未授权字段不参与 inference。
5. **可回滚**
   - 规则版本化，发布异常可快速回退到上一版 rule set。
6. **弃权原则**（对齐 `Product_Insights`）
   - 证据冲突、证据不足或只能讲一个"也许有帮助"的故事时，系统弃权，不出主动建议卡。
7. **通知克制**
   - 只有高优先级、强时效卡才升级为通知，避免通知轰炸。

---

## 18. 结论

后端应采用 **「Signal → Candidate（规则引擎）→ Arbitration（仲裁器）→ Lifecycle（生命周期管理）」** 的四层流水线，而不是把建议逻辑继续放在前端或让 LLM 直接生成建议。

与原方案的核心差异：

| 维度           | 原方案         | 优化方案                         |
| -------------- | -------------- | -------------------------------- |
| 卡片类型       | 4 类           | 5 类（新增说明卡）               |
| 触发链         | 未区分         | 事件触发 + 定时触发              |
| 冷启动         | 缺失           | 维度基线管理                     |
| 卡片生命周期   | 仅 expiresAt   | 生成→激活→消退→失效              |
| 反馈闭环       | Phase 4 模糊   | 4 种反馈真实影响出卡             |
| 信号组合       | 不支持         | 预定义规则合成弱信号             |
| 通知升级       | 未设计         | 高优先级卡升级为通知             |
| 建议持久化     | 未设计         | DB 持久化供 Report 回顾          |
| 缓存策略       | 未设计         | Redis 多层缓存                   |
| AI 解释        | Phase 3 接入   | 架构内建，按需调用               |
| 与现有模块复用 | 平行采集       | 复用 TodayAnalysisContextService |
| 命名规范       | 多处违规       | 严格遵循 AGENTS.md               |
| 目录结构       | 非白名单子目录 | 全部白名单，services/ 下域子目录 |

- **Phase 1 即可替换现有 medication/water 硬编码**，价值立即可见。
- **Phase 2 达成蓝图五类建议卡 + 冷启动保护**，不依赖强 LLM 能力。
- **Phase 3 实现反馈闭环**，让用户反馈真实影响后续出卡。
- **Phase 4 的 AI 层只做解释和文案润色**，与 `Product_AI_Design` 的「规则兜底 + AI 解释」原则一致。
- **Phase 5 支持信号组合和历史回顾**，让引擎更丰富多变，同时为 Report 提供数据。

这样后端能力可以逐步增强，前端今天就能按统一合同渲染，避免等产品/AI 成熟后再做一次性大改。
