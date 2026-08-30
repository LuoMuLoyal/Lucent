# assistant

AI 对话助手模块——基于 LangGraph 的多意图路由 agent，支持健康数据查询、
药品知识检索（RAG）、日报记录写入提案和简单闲聊。

## Architecture

```
SSE Request → AssistantService → AssistantRuntimeService → LangGraph
                                                                ↓
                                                    ┌───────────┴───────────┐
                                                    │  prepare_context       │
                                                    │  (tools + memory)      │
                                                    └───────────┬───────────┘
                                                                ↓
                                                    ┌───────────┴───────────┐
                                                    │  classify_intent       │
                                                    │  (rule-based router)   │
                                                    └──┬───┬───┬───┬───┬─────┘
                                                       ↓   ↓   ↓   ↓   ↓
                                              simple_chat read write knowledge agent↔tools
                                                       ↓   ↓   ↓   ↓   ↓
                                                    ┌───────────────────────┐
                                                    │  respond (SSE stream)  │
                                                    └───────────────────────┘
```

## Runtime Graph (`agent/runtime/`)

`buildAssistantRuntimeGraph()` 构建一个 LangGraph 状态图：

| Node                                  | Responsibility                                                      |
| ------------------------------------- | ------------------------------------------------------------------- |
| `prepare_context`                     | 注入 system prompt + 跨对话记忆 + 用户消息，确定 allowed tools      |
| `classify_intent`                     | 纯规则关键词路由（无 LLM），分类为 5 种 intent，选择 relevant tools |
| `agent`                               | LLM 调用，返回文本或 tool calls                                     |
| `tools`                               | 执行 tool calls，循环回 `agent`（最多 `MAX_TOOL_LOOPS` 次）         |
| `read_subgraph`                       | 读取数据子图（日报/报告/档案/设置查询）                             |
| `write_subgraph`                      | 写入提案子图（日报/设置 CRUD 提案，不直接写 DB）                    |
| `knowledge_subgraph`                  | 知识检索子图（中文说明书/DrugBank/医学问答 RAG）                    |
| `write_review_setup` / `write_review` | HITL 审查节点（需 checkpointer），等待用户确认提案                  |
| `respond`                             | 生成最终回复，通过 SSE callback 流式输出                            |

### Intent Routing

`classifyIntent` 将用户消息分为 5 种语义 intent，每种路由到不同的子图或快速路径：

| Intent           | Route                            | Description                    |
| ---------------- | -------------------------------- | ------------------------------ |
| `simple_chat`    | `→ respond`                      | 问候/闲聊，跳过 agent 和 tools |
| `read_data`      | `→ read_subgraph → respond`      | 查询用户自己的记录/档案        |
| `write_proposal` | `→ write_subgraph → respond`     | 提案修改日报/设置（HITL 审查） |
| `knowledge`      | `→ knowledge_subgraph → respond` | 药品/医学知识 RAG 检索         |
| `mixed`          | `→ agent ↔ tools → respond`      | 跨意图，走完整 agent-tool 循环 |

## Tools (`tools/`)

22 个工具按功能域组织：

| 子目录             | 工具                                                                                                                                                                                                                      | 数据源                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `tools/read/`      | `get_today_records`, `get_records_by_date`, `get_records_by_range`, `get_today_summary_by_date`, `get_report_summary_by_range`, `get_recent_today_summaries`, `get_recent_report_summaries`, `get_sleep_summary_by_range` | today-analysis/reports 物化结果 |
| `tools/medicine/`  | `search_cn_medicine_products`, `get_cn_medicine_detail`                                                                                                                                                                   | 中国药品数据库                  |
| `tools/leaflet/`   | `search_medicine_leaflets`                                                                                                                                                                                                | 中文药品说明书向量检索          |
| `tools/knowledge/` | `search_medical_qa_corpus`                                                                                                                                                                                                | 医学问答语料向量检索            |
| `tools/drugbank/`  | `resolve_drugbank_entity`, `get_drugbank_detail`, `search_drugbank_passages`                                                                                                                                              | DrugBank 科学文献向量检索       |
| `tools/records/`   | `get_user_profile`, `get_current_medicines`                                                                                                                                                                               | 用户健康档案                    |
| `tools/proposal/`  | `propose_create/update/delete_daily_record`, `propose_update_user_settings`                                                                                                                                               | 写入提案（不直接写 DB）         |
| `tools/shared/`    | `context.service`, `date-resolver`, `tool-definitions`, `tool-constants`                                                                                                                                                  | 共享工具基础设施                |

> **RAG 源分离约束**：中文说明书、DrugBank 文献、医学问答语料各自独立向量表 + 独立检索工具。
> 医学问答语料仅供 Assistant 对话使用，前端线性服药流程不得消费该语料。详见
> [architecture.md RAG 约束](../../docs/01-reference/architecture.md#assistant-rag-data-source-constraints)。

## Port Interfaces (`types/ports.ts`)

Assistant 使用 consumer-defined port 模式——消费者声明接口，提供方模块实现：

| Interface                        | Symbol Token                       | Provider Module    | Purpose          |
| -------------------------------- | ---------------------------------- | ------------------ | ---------------- |
| `IMedicineReminderReader`        | `MEDICINE_REMINDER_READER`         | medicine-reminders | 列出活跃提醒     |
| `IDailyRecordReader`             | `DAILY_RECORD_READER`              | daily-records      | 分页查询日报记录 |
| `IDailyRecordCandidateGenerator` | `DAILY_RECORD_CANDIDATE_GENERATOR` | daily-records      | LLM 候选生成     |

通过 `{ provide: TOKEN, useExisting: XxxService }` 注册，零运行时开销。详见
[ADR-0009](../../docs/01-reference/adr/0009-cross-module-data-access.md)。

## Persistence (`repositories/`)

| Repository                        | Port Interface                        | Table                   |
| --------------------------------- | ------------------------------------- | ----------------------- |
| `AssistantConversationRepository` | `AssistantConversationRepositoryPort` | `AssistantConversation` |
| `AssistantMemoryRepository`       | `AssistantMemoryRepositoryPort`       | `AssistantMemory`       |
| `AssistantSummaryRepository`      | `AssistantSummaryRepositoryPort`      | `AssistantSummary`      |

`AssistantCheckpointerService` (`agent/checkpointer.service.ts`) 提供 LangGraph
Postgres checkpointer，用于 HITL 写入提案的跨请求状态恢复。

## Module Exports

通过 `index.ts` barrel 导出：

- `HistoricalAiSummaryService` — 被 `reports` 模块用于历史 AI 摘要查询。

## API Endpoints

| Method   | Path                                        | Description            |
| -------- | ------------------------------------------- | ---------------------- |
| `GET`    | `/user/assistant/capabilities`              | 用户助手能力与权限     |
| `GET`    | `/user/assistant/conversations`             | 最近对话列表           |
| `GET`    | `/user/assistant/latest`                    | 最近一条对话           |
| `POST`   | `/user/assistant/conversations/:id/open`    | 激活历史对话           |
| `POST`   | `/user/assistant/conversations/:id/confirm` | 确认/拒绝写入提案      |
| `POST`   | `/user/assistant/conversations/:id/rename`  | 重命名对话             |
| `DELETE` | `/user/assistant/conversations/:id`         | 删除对话               |
| `POST`   | `/user/assistant/messages/stream`           | SSE 流式对话（主入口） |
| `DELETE` | `/user/assistant/messages`                  | 清除所有对话+记忆      |

## Dependencies

**Imports**: `AuthModule`, `LlmRuntimeModule`, `LlmCommonModule`, `MedicinesModule`,
`UserSettingsModule`, `UserHealthContextModule`, `DailyRecordsModule`,
`MedicineRemindersModule`

**Cross-Module DI (Port Interfaces)**: `IMedicineReminderReader`,
`IDailyRecordReader`, `IDailyRecordCandidateGenerator`, `IUserSettingsPort`,
`IUserHealthContextReader` (Phase 3 port 隔离)

## Safety

- 写入操作不直接写 DB——通过 `propose_*` 工具生成提案，用户确认后才执行。
- HITL（Human-in-the-Loop）：有 checkpointer 时，write subgraph 在 `write_review`
  节点暂停，等待 `POST /conversations/:id/confirm` 确认后恢复。
- 详见 [assistant-safety.md](../../docs/01-reference/contracts/assistant-safety.md)。
