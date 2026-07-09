# Today Suggestion Engine

## 概述

后端主动建议引擎，替代前端硬编码的 Today 页建议卡逻辑。按 `Product_Insights` 支持 5 类卡片，具备双触发链、冷启动基线、卡片生命周期、反馈驱动抑制。

## 架构

```
信号采集层 (Collectors)
    ↓
规则引擎 (Rules → Registry)
    ↓
仲裁器 (Arbitration + Scoring)
    ↓
生命周期管理 (Lifecycle + Baseline)
    ↓
DTO 映射 → API 响应
```

## API 端点

- `GET /user/today/suggestions` — 获取今日建议卡
  - Query: `date` (可选, YYYY-MM-DD), `excludeIds` (可选, 已 dismiss 的建议 ID)
  - Response: `{ primary, secondary[], observations[] }`

## 模块位置

- `src/modules/today-suggestion/`

## 卡片类型

| 类型   | 枚举值            | 规则                                     | 说明                  |
| ------ | ----------------- | ---------------------------------------- | --------------------- |
| 依从卡 | `compliance`      | `missed_dose_pending`                    | 到时未确认用药        |
| 行为卡 | `behavior_advice` | `water_behind_target`, `sleep_shortfall` | 饮水/睡眠不足         |
| 趋势卡 | `trend`           | `deteriorating_symptom`                  | 症状恶化趋势          |
| 说明卡 | `coverage`        | `coverage_explanation`                   | 档案不完整/今日无记录 |
| 风险卡 | `confirmed_risk`  | （Phase 3+）                             | 明确规则风险          |

## 冷启动基线

- 维度: water_intake, sleep_duration, symptom_severity, mood, caffeine_intake, medication_adherence
- 最少连续记录天数: 3 天
- 基线建立前，behavior/trend 类规则不出卡

## 数据库表

- `user_suggestions` — 建议持久化
- `user_suggestion_baselines` — 冷启动基线
- `user_suggestion_feedbacks` — 反馈记录（Phase 3）

## 实现状态

- [x] Phase 1: 规则引擎骨架 + missed-dose + water-shortfall
- [x] Phase 2: 5 类卡片 + 冷启动基线 + 生命周期 + sleep/trend/coverage 规则
- [ ] Phase 3: 反馈驱动抑制
- [ ] Phase 4: 信号组合 + AI 解释层
- [ ] Phase 5: 通知升级
- [ ] Phase 6: 缓存策略
