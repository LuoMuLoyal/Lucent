---
status: active
owner: backend
quadrant: reference
updated: 2026-08-07
---

# Lucent TODO

Last updated: 2026-08-07

This file keeps active backend follow-up items that are intentionally deferred.
Keep durable implementation context in the owning code comments when the TODO is tightly coupled to
one branch or security check, but do not scatter project-level follow-up lists across changelogs or
random docs.

**When a follow-up item is completed:** delete it from this file, move resulting facts to
the relevant `Lucent/docs/00-current/*.md` state file, and record the completion in both today's
`Lucent/docs/02-logs/migration-log/YYYY-MM-DD.md` and
`Luminous/docs/03-logs/migration-log/YYYY-MM-DD.md` as cross-repo sync evidence.

## 后续可做

### `0.1.0` 发布后：产品闭环重构（已决策，当前禁止启动）

启动门槛：Luminous/Lucent 当前版本完成真实联调、发布验证和 `0.1.0` 正式发布。发布前只修复发布阻断问题；不得提前引入健康事件 schema、主动重算或 Review 新合同。执行顺序见 `Luminous/plans/2026-08-07-post-0.1.0-product-loop-program.md`。

- **真正的主动触发**：daily record、dose log、reminder 和健康事件状态变化应触发有界重算/入队；`GET /today/suggestions` 只读取结果，不再承担首次生成。保留去重、冷却、通知升级和失败降级边界
- **Today Analysis 主动化**：当前 summary 仍由 generate/async/stream 请求触发；事件变化后应异步生成或失效，用户打开 Today 时读取最新可用结果并看到生成时间/陈旧状态
- **基线生产链路**：为 `BaselineService.recordObservation` 建立真实写入路径和冷启动策略；没有基线时明确弃权，不能让依赖基线的规则在正常新用户路径中永久不可达
- **漏服时间修正**：修复 `MedicationCollectorService` 使用日期午夜计算当前分钟的问题；超时无操作只能产生“未确认”，只有用户明确确认或既有合同明确裁决时才使用“漏服”
- **服药槽位口径**：报告、Today 和建议规则统一以 reminder slot 为分母和状态单位；同一药品任一 `taken/skipped` 不得代表当天全部计划完成，点击“已服”仅是用户自报确认
- **饮水口径**：Today、建议与回顾统一按标准 ml 聚合，禁止一处按记录条数、一处按容量；缺失记录是 unknown，不是 0 L，输出必须携带来源和覆盖率
- **睡眠口径**：允许夜间睡眠和午睡片段；汇总时保留时间区间、来源和是否近似录入，不能默认只有一段夜间睡眠
- **健康事件合同**：设计显式 start/end、系统 proposal、用户确认、关联症状/药物/记录和结果 `improved / unchanged / worsened`；系统不得静默判断疾病或康复
- **回顾读模型**：以健康事件聚合发生事实、关键变化、槽位完成情况和下一步；至少一个维度可解释即可返回，禁止跨维度综合健康评分，单维趋势需返回数据覆盖率
- **旧 Report 指标修正**：`nonZeroDays` 不能排除真实 0% 日期并抬高服药率；无记录日期不能直接写成 0 L 或 `needs_attention`；旧 dashboard 在 Review 切换完成前也必须返回诚实口径
- **报告出口降级**：hospital/monthly/print/clinic share 保留兼容，但从默认回顾内容移入“更多”；修正 clinic summary 固定 `last_30_days` 却不读取近期记录、`findings` 永远为空，以及 share URL 缺少 `/user` 的合同错误
- **闭环测量**：以最小化、可审计事件记录建议曝光/处理、健康事件起止与结果确认、回顾打开、摘要预览、导出请求和分享链接访问；不得把请求生成成功等同于医生查看或用户获益

### B2：环境数据接入真实天气 API（P3）

静态环境数据已标注 `dataSource: 'static'`（`src/modules/environment/config/reference.ts`）。
v1.1.0 接入真实天气/空气质量 API（和风天气/彩云天气等），替换 6 个区域静态配置文件。

### B3：多实例限流验证（P3）

`ThrottlerConfigService` 已实现 Redis-backed 限流存储（`REDIS_URL` 存在时启用）。
v2.0.0 水平扩展时需验证多实例限流计数器在 Redis 中的正确性。

### B4：账户删除级联清理（P3）

`DataRetentionService` 已实现 `@Cron` 清理管道（过期会话/通知/反馈抑制）和软删除账户 30 天后硬删除。
仍缺：账户删除流程增加匿名化数据导出 → 数据可移植性 JSON 导出（GDPR/PIPL 合规）。

### 高级可观测性（基础已完成）

基础可观测性已就位（Prometheus metrics + Grafana dashboards + LLM/BullMQ 指标 + Alertmanager 告警规则）。以下为进阶项：

- OpenTelemetry 分布式追踪
- 添加 synthetic uptime monitoring
