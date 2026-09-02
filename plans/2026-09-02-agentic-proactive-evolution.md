# Agentic → Proactive → 伴身演进:Lucent 后端任务清单

> 2026-09-02 起。定位:把 assistant(已有的 LangGraph Agent + 工具 + proposal 门控)从"聊天窗口里的单页能力"升级为贯穿主流程的 Agentic 形态,再走向事件/时间驱动的 Proactive/Ambient 后台智能体,最终对齐"健康伴身智能体"愿景。每一步保留 human-in-the-loop——医疗场景的合规需要,也是产品差异化。

## 现状锚点(代码事实)

- `src/modules/assistant/`:LangGraph + LangChain 运行时,工具齐备(`tools/drugbank`、`knowledge`、`leaflet`、`medicine`、`records`、`read`、`vector`、`proposal`),Postgres checkpointer 长期记忆与会话压缩,SSE 流式。
- 写操作已走 proposal 门控(`tools/proposal` + `confirm-proposal.dto`)。
- 模型基建平台化:chat/vision/analysis/embedding/compression 多角色模型池,openai-compatible,熔断/重试/安全策略。
- `medicine-reminders` 自述 schedule-only,纯规则;`today-analysis`、`today-suggestion`、`historical-ai-summary` 各自独立调 AI,未与 assistant 共享上下文。
- BullMQ 已在技术栈(Worker 进程分离已按 2026-07-24 计划落地)。

## Phase 0 夯实期:吃满基建红利

- [ ] **P0-1 语义搜索 API**
  - 把 `tools/vector` 的向量检索能力从 assistant 内部泛化为独立搜索服务:混合检索(关键词 + embedding,embedding 模型池已就绪)。
  - 新增 search 相关端点,走 OpenAPI 直出 → `pnpm export:openapi` → 通知 Luminous 重生成客户端。
- [ ] **P0-2 扫药视觉字段提取服务**
  - 提供 vision 模型池驱动的药品标签字段提取端点;在线时作为字段提取主路径**替代纯规则解析**,端侧 PaddleOCR 文本 + 规则解析仅作离线/失败降级;明确置信度与降级策略(端侧可用、扫码主流程不因云端失败而阻塞)。
- [ ] **P0-3 AI 上下文统一**
  - 抽取共享上下文构建器(user-health-context、近期记录、用药清单),让 `today-analysis` / `today-suggestion` / `historical-ai-summary` 与 assistant 图共享同一份上下文来源,消除各调各的重复拼装。
- [ ] **P0-4 proposal 服务域化**
  - 把 `tools/proposal` 从 assistant 工具内部实现上提为可复用域服务,使后续 today/review/reminders 等模块都能以同一套门控协议发起写提案。

## Phase 1 Agentic 化:把 Agent 放进主流程

- [ ] **P1-1 会话上下文注入**
  - assistant 会话支持按来源表面(source surface)与预置上下文启动:today 起草补录方案、review 生成复盘、medicine 调整提醒各自携带不同初始状态;会话 API 合同同步导出。
- [ ] **P1-2 today 补录提案工具**
  - 新增 agent 工具:基于当日缺口生成补录方案草案,输出走 P0-4 proposal 门控。
- [ ] **P1-3 review 复盘生成工具**
  - 复盘生成 + 调整计划起草工具;复用 `historical-ai-summary` 的结论但经 assistant 图编排,产出结构化提案。
- [ ] **P1-4 reminders 对话式调整工具**
  - medicine-reminders 的写操作封装为 proposal 工具(改时间/剂量/暂停),agent 只能提案、用户确认后落库。
- [ ] **P1-5 合同与测试**
  - 每个 Phase 1 端点变更后:`pnpm export:openapi` + 提醒 Luminous `dart run scripts/contract/bootstrap.dart`;工具与门控路径补集成测试。

## Phase 2 Proactive / Ambient:后台智能体

- [ ] **P2-1 事件总线设计**
  - 基于 BullMQ + Outbox(与 2026-08-22 盘点中的 Outbox 方向对齐)定义事件契约:服药/漏服记录、记录落库、复盘就绪、提醒触发等;明确事件 schema 版本化。
- [ ] **P2-2 medicine-reminders 事件化**
  - schedule-only → 调度触发时同时发出事件(Worker 进程),为漏服模式识别提供数据流;不改变现有本地通知语义。
- [ ] **P2-3 依从性模式识别触发器**
  - 规则引擎(先规则后模型):如"连续三天漏服晚间药"→ 生成主动提议(调整时间/询问原因),经通知通道推送并附带可点入的 assistant 会话;必须有冷却/去重/静默时段,防止过度打扰。
- [ ] **P2-4 复查节点主动关怀**
  - health-events 复查日期临近时触发关怀任务;输出为通知 + assistant 预置会话。
- [ ] **P2-5 review 摘要主动推送**
  - 复盘从"用户点开才有"改为生成即推送(尊重 notification-preferences 的开关)。
- [ ] **P2-6 Proactive 治理**
  - 频控、用户级开关、审计日志(audit-log)、proactive 内容同样过安全策略;所有主动写操作一律仍是 proposal,绝不静默落库。

## Phase 3 伴身愿景:跨端一致(远期,与 Next.js BFF 对齐)

- [ ] 会话与记忆按用户而非设备索引,checkpointer 作用域复核;SSE 断线恢复/会话续传。
- [ ] BFF/cookie 双写决策落 ADR(BFF 动工前;当前该决策仅存在于讨论结论,仓库内无记录)。
- [ ] BFF/cookie 双写路径下 agent 会话跨端(web + 移动)一致;移动端合同不动,改动收敛在 BFF 层。
- [ ] 评估多智能体 orchestrator-workers 是否必要;在此之前不引入。

## 执行注意

- 合同流水线:Lucent API 变更 → `pnpm export:openapi` → Luminous `dart run scripts/contract/bootstrap.dart`,不要手写端点 prose。
- 每次代码变更追加 `docs/logs/migration-log/YYYY-MM-DD.md`;阶段稳定决策落 ADR。
- 完成的任务直接从本清单删除,不留 ✅/划线标记。
- 迭代期用窄命令,收尾跑 `pnpm lint:check && pnpm typecheck && pnpm build && pnpm test && pnpm docs:check`。
- 依赖关系:P1 依赖 P0-3/P0-4;P2 依赖 P1-1 与事件总线(P2-1);Phase 3 仅在 BFF 启动后推进。
