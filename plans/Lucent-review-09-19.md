# Lucent 每日代码审查 · 2026-09-19

- 审阅日期：2026-09-19（上海时区）
- 提交区间：UTC 2026-09-18 16:00:00 ~ UTC 2026-09-19 15:59:59（= 上海 2026-09-19 00:00:00 +0800 ~ 23:59:59 +0800）
- 最早 commit: `42c0fa04` — docs(plans): 修订 semantica 计划与计划的清单描述
- 最晚 commit: `4655e512` — docs(plan): AGE 计划状态同步为 P0-P5 已落地、P2 剩余为 sidecar 镜像
- commit 数: 20

## 概览

今日全部 20 个 commit 都围绕 **Semantica 英文侧 OAG（Ontology-Augmented Generation）** 端到端接通与相应的文档同步：先建 `semantica` 服务定义、自建含 Apache AGE 的 `lucent-db:18` 镜像、把 `reason_over_ontology` 工具从配置 → 客户端 → 生成器 → 推理服务 → 流编排 → 客户端来源条一条龙串起来；接着按 LoRAG/Sidecar eval log 里登记的实测缺陷修三处漏（漏进知识集合、零行结论误语义、eslint-disable 位置）；最后接入 PROV-O 引用 + SUBSTRATE/CYP/ATC 关键词路由 + 节点超时预算，ADR-0021 收口决策。

总体印象：

- 错误处理一致使用判别式联合（`{ ok: true, value } | { ok: false, failure }`），构造器体、prompt、envelope 三层一致。
- 重试回路（生成 + 一次"缺引用"重写 + 工具级预算）四档共同存在，**没有** LLM 重试 + 工具预算双重吞错。
- 工具层（`AssistantToolService`）做了缓存保护（cacheGet/cacheSet 各自 try/catch 并 warn，**不抛**），与 sidecar 客户端的"分类失败而非抛异常"同形。
- 但有 1 个**真正的 critical**：审批失败路径**没有审计留痕**，正好落入计划 §8.3 缺口本身。这条不应被发布。

## Critical

### C-1：审批失败路径不会触发审计日志（计划 §8.3 自己点名的缺口）

- **位置**：`src/modules/assistant/assistant.controller.ts:148-168`
- **现象**：
  ```ts
  const result = await unwrapResult(
    this.assistantService.confirmProposal(user.sub, conversationId, dto),
  );
  this.auditLogService.logFireAndForget({ ... status: result.status });
  ```
  当 `confirmProposal` 链路上任一步抛（`applyApprovedProposals` 写库失败、`resumeConversation` 失败等）—— `await unwrapResult(...)` 把异常往上抛到 Nest filter—— 紧随其后的 `logFireAndForget(...)` **根本不会执行**。
- **影响**：被拒的审批尝试（含写库失败的 approved）在审计表里完全无痕。这正是 commit `e1c5b9dd` 自己说的 §8.3 缺口——但实现只补了对侧，漏掉了负向分支。一次 DB 写错后客户端只能看到 5xx，看到的就是「用户点了 approve 但什么都没发生」，事后追责不到人。
- **修正**：
  1. 把审计改为 `try { result = await unwrapResult(...); fireAndForget({status:'ok', ...}); } catch (e) { fireAndForget({status:'failed', failure: e.code}); throw }`，或者
  2. 把 audit 调用挪进 `AssistantProposalConfirmService.doConfirmProposal` 本身（`approved` / `rejected` / `apply_failed` / `resume_failed` 四态写清楚），controller 不持有"成不成都来留痕"的语义负担。方案 2 与 service 层「写发生在 Lucent 这一侧」的边界更一致。

## Warning

### W-1：`decision` 与 `status` 写入同一值，审计元数据语义混淆

- **位置**：`src/modules/assistant/assistant.controller.ts:160-162`（同 `e1c5b9dd`）
- **现象**：`decision` 取 `dto.decision`，`status` 取 `result.status`，而 `AssistantConfirmResult.status` 同样只是 `'approved' | 'rejected'`。这两个字段在所有可观测路径上恒相等。
- **影响**：审计消费者无法区分"用户请求"和"服务端实际结果"。即使将来加 `apply_failed` 状态，结构里也得改一遍；如果想实现"决策与结果不一致"（罕见但可能就是审计真正想看的信号），结构现在是写死的。
- **修正**：只留一个；或拆为 `requestDecision` / `effectiveStatus`，让 `effectiveStatus` 在错误路径也允许是 `'failed' | 'rejected_no_change'` 之类。建议与 C-1 一并重构。

### W-2：`policy.service.ts` 重复维护 sidecar 元组

- **位置**：`src/modules/assistant/services/policy.service.ts:18-22`
- **现象**：本地再次 `new Set(ASSISTANT_OAG_TOOL_NAMES)` 而不是直接用 `ASSISTANT_OAG_TOOL_NAMES`，`RETRIEVAL_TOOL_NAMES` 也是同形。
- **影响**：每新增 sidecar 或每拆工具就要在 N 个地方同步元组。同仓里已有 `ASSISTANT_RETRIEVAL_TOOL_NAMES` / `ASSISTANT_OAG_TOOL_NAMES` 两套元组，再各自 Set 化是典型的"防御性重复"。
- **修正**：把 `RETRIEVAL_TOOL_NAMES` / `OAG_TOOL_NAMES` 改名为 `*_TOOL_NAMES_SET`（实际就是 Set），直接放在 `tool-types.ts` 里导出。PolicyService 只 reuse，不要 wrap。

### W-3：节点级 `cachePolicy` 模式与图全局 `cachePolicy: false` 容易误开

- **位置**：`src/modules/assistant/agent/runtime/graph.ts` `ASSISTANT_NODE_CACHE` (process-wide InMemoryCache) + `classify_intent` 的 `{ cachePolicy: { ttl: 3600 } }`
- **现象**：当前只有 `classify_intent` 走节点缓存（输入维度：系统 prompt + 用户消息），看起来是安全的（纯规则、无用户数据）。但 `setNodeDefaults` 设置 `cachePolicy: false`，未来加节点时容易不小心复制 `classify_intent` 写法/模板而引入缓存——一旦节点内吃了 `state.userId` / `state.toolResults` / 选定的 system prompt 文本串之外的某样东西，就会跨用户串味（InMemoryCache 是进程内实例）。
- **影响**：缓存命中是隐式的（没有日志写"hit/note per user"），单用户自测、shadow traffic 都看不出来；出问题后才被某一个新加的节点背刺。
- **修正**：
  1. `classify_intent` 缓存前显式断言只用了 `messages[0].text` 与 `state.allowedTools`，lint 规则守住；
  2. 或者干脆去掉节点级缓存、`InMemoryCache`；classify 纯规则的耗时本来就极短，缓存收益相对风险不值。

### W-4：`compose.dev.yaml` 默认镜像变成自建 `lucent-db:18`（开发体验断点）

- **位置**：`compose.dev.yaml:4-6`（`git diff` 42269 之前）
- **现象**：`postgres-dev` / `postgres-test` 默认 `image: ${LUCENT_DB_IMAGE:-lucent-db:18}`，依赖 `docker build -t lucent-db:18 docker/postgres-age`。新成员第一次 `make dev-up` 直接遇到 `no such image`。
- **影响**：新人 onboarding 必须先 build 镜像，未 build 时报错信息也不会把"构建命令是什么"指向 README。
- **修正**：默认仍走 `pgvector/pgvector:pg18`（旧行为），`lucent-db` 放到可选 `profiles: ['age']`，或在 `Makefile` 的 `dev-up` 里前置 `docker build`。改完后功能对照测试一遍：现在 dev 默认就是无 AGE，可保持。

### W-5：`cypher-generator.service.ts` 把基类方法改名造成语义混淆

- **位置**：`src/modules/assistant/tools/ontology/cypher-generator.service.ts:51-53`
  ```ts
  hasLanguageModel(): boolean {
    return this.hasAnalysisModel();
  }
  ```
- **现象**：本生成器的 `modelRole = 'language'`，但调用入口却用 `hasAnalysisModel`。新加入的同事读基类符号跟自己的业务名对不上。
- **影响**：长期维护成本 + 误导后续作者以为"language 角色和 analysis 角色有什么关联"。
- **修正**：直接在基类里把检查暴露成 `protected roleConfigured(): boolean` 或 `hasModelForRole()`，子类不再翻译。或者在基类的 `hasRoleConfig(role: LlmRole)` 直接暴露，子类一行调用即可。

### W-6：`IS_RETRYABLE` 把 `internal` 列为可重试，但 prompt 几乎不可能自纠

- **位置**：`src/modules/assistant/tools/ontology/semantica.types.ts:159-168`（`isRetryableSemanticaFailure`）
- **现象**：`internal` 是 sidecar 自身 bug（5xx、`kind: internal`），回喂给模型重生成并不会变；本次重试只是再赌一次 sidecar 运气。同时 prompt 的 RETRY_HINTS 里对 internal 给的是"写得更简单"——这其实是把 sidecar 的 bug 错误归类为"查询写得太笨"。
- **影响**：3 次重试都走 `internal` = 必然 3 次同样坏结果；预期拉高首个工具结果 timeout、token cost 也跟着翻倍。
- **修正**：把 `internal` 从可重试集合里挪走（与 `server_error` 同形）；RETRY_HINTS 删掉 internal 那行，留着也只会诱导后续作者添加更多"非语义性"的修正。

## Suggestion

### S-1：`ontology-reasoning.service.ts` 中 `previousErrorKind: string | null`

- **位置**：`src/modules/assistant/tools/ontology/cypher.schema.ts:34`、使用处 `ontology-reasoning.service.ts:138, 191, 238, 275`
- **现象**：`previousErrorKind` 在 schema 里是 `string | null`，运行时实际只用 `MISSING_PROVENANCE_ERROR_KIND`（自定义客户端分类）和 sidecar 结构化 6 选 1（`SemanticaQueryErrorKind`）。
- **影响**：传值没有强约束，typo 或改名不会在编译期被发现。
- **修正**：类型改成 `SemanticaQueryErrorKind | 'missing_provenance' | null`。

### S-2：`normalizeLimit` 静默夹紧，模型看不到

- **位置**：`src/modules/assistant/tools/ontology/ontology-reasoning.service.ts:262-267`
- **现象**：`limit` 超 [1, 100] 区间直接 clamp，下游 envelope 不会写"你请求了 N，已夹紧到 M"。
- **影响**：模型重复问大窗口、再大、再大，每次都被静默截，体感像"返回结果忽好忽坏"。
- **修正**：在 result envelope 内加 `requestedLimit` 与 `limitCapped` 字段，与 `MEAL_DIGEST_LIMIT_CAP_MESSAGE` 同构。

### S-3：`extractCitations` / `extractExecutedQuery` 对所有工具都跑

- **位置**：`src/modules/assistant/services/stream-orchestrator.service.ts:306-309`
- **现象**：每个工具执行后都尝试读 `result.citations`、`result.cypher`。绝大多数工具没有这俩字段——`safeParse` 失败也只是 warn 一下，没问题，但每条结果都多走一次 zod 校验。
- **影响**：小，但语义层面"只有 ontology 工具才应该有 executedQuery"会随别的工具也开始返回 `cypher` 而被打破。
- **修正**：用 `name === 'reason_over_ontology'` 短路（与 knowledge 路径上 `case 'reason_over_ontology':` 同形），旁路也把"为什么不在你这里"的语义留给自己。

### S-4：dev compose 的 `semantica` 服务 profile + staging 同时挂在可选 profile

- **位置**：`compose.dev.yaml` 与 `compose.staging.yaml` 中 `profiles: ['semantica']`
- **现象**：镜像 `lucent-semantica:latest` 注释里说"semantica-service 仓还没有 Dockerfile"。只有 `profile 激活 + 自建镜像可用`时才工作。
- **影响**：本地起 OAG 链路拿不到 sidecar，会出 `unreachable` 信封，PRD 里的"显式说服务不可用"的承诺会变成常态——所以这条**绝不是 bug**，但在评审/部署期的发现率会低到接近零。
- **修正**：在 `Makefile dev-up-with-oag` 与 README 明显位置写一句"未起 sidecar = reason_over_ontology 不可用，符合预期"，不要让 dev 自己猜是不是坏了。

### S-5：`reason_over_ontology` 的 router regex 使用 `cyp\s?\d`

- **位置**：`src/modules/assistant/agent/runtime/tool-keyword-rules.ts` `reason_over_ontology` 段最后两行 `/cyp\s?\d/i`、`/p450/i`、`/atc/i`
- **现象**：包含 `cyp + digit`，但 `cyp2d6`、`cyp3a4` 默认又会匹配 `enzyme` / `metaboli[sz]` / `substrate` 上一组。把"任意一位数字"作为边界也会把 "cytochrome p450 2c9" 这种用空格写法的命中变得依赖"刚好有一个数字"。
- **影响**：现行 regex 在 eval log 上已经测过覆盖了三种 CYP 问法；如果以后 sidecar 加上更细的 enzyme family 词汇（UGT/SULT/ABC family），要记得回头 expand。
- **修正**：当前 OK，但建议加一行端到端测试 (`reasonOverOntology.routes.test.ts`) 把"Which drugs are substrates of CYP3A4? / What ATC class does clopidogrel belong to? / What enzymes metabolize warfarin?" 这类参考问法锁住；之后 sidecar 改 schema 不会再悄悄把这些工具从 router 里丢掉。

### S-6：`semantica-client` 的 `parseErrorDetail` 用 `eslint-disable-line` 隐藏 silent catch

- **位置**：`src/modules/assistant/tools/ontology/semantica-client.service.ts:386`
  ```ts
  } catch {
    // eslint-disable-next-line error-handling/no-silent-catch
    return { errorKind: null, message: null };
  }
  ```
- **现象**：catch 处理完全靠注释承接，调用方把 body 文本已记过 warn，所以"空 catch"是有理由的。但规则级别 `error-handling/no-silent-catch` 仍判 false-positive。
- **影响**：lint 规则以后改严格会重新触警。
- **修正**：把 catch 块改成 `catch (error) { this.logger.warn(...) ; return ... }`，把"我们故意吞"的语义写成可观察的事实（**注释描述的是行为，不是行为本身**）。`semantica-client.service` 已声明了 `this.logger`，不需要新依赖。

### S-7：`extractCitations` 用 safeParse 失败直接 drop，不重试

- **位置**：`src/modules/assistant/services/stream-orchestrator.service.ts:347-353`
- **现象**：声明的语义是 "sidecar 响应漂移不该让整个查询结果作废"，但 schema 与侧端 schema 漂移时会**永远是 warn + drop**，不会暴露给上游修复。
- **影响**：长期容易变成"客户端永远不见 citations，不知道为什么"。
- **修正**：加 metrics 计数器 `assistant_tool_citations_dropped_total{reason="schema_mismatch"}`，便于定位 sidecar 升级时漂移。

### S-8：3c522db5 commit 的 eslint 位置修正属于隐含提示

- **位置**：`src/modules/assistant/tools/ontology/semantica-client.service.ts` diff 中的 eslint-disable 注释
- **现象**：`disable` 行曾经写在了 catch 的右侧一行，但规则库要求写在 catch 体里——这是产品代码之外的小动作。
- **影响**：无功能影响。
- **修正**：建议与 S-6 一并把 `eslint-disable` 移除（用显式 warn 替代），整个文件不再依赖 lint 例外。

---

## 总结

| 类别       | 数量 | 处理优先级                                                        |
| ---------- | ---- | ----------------------------------------------------------------- |
| Critical   | 1    | 阻塞 publish：C-1（审计缺口）                                     |
| Warning    | 6    | 与下一次 OAG eval 一并 fix：W-1 / W-2 / W-3 / W-4 / W-6；W-5 顺手 |
| Suggestion | 8    | S-1、S-3、S-7 对长期维护最有用；其余按需                          |

今天**最大的工程债**是 C-1：commit `e1c5b9dd` 的变更内自己点出了"§8.3 缺口"，但实现只补了对侧路径。请在下一次发布前回退 controller 增加 try/catch 或迁移到 service 层（推荐方案 2）。

值得肯定的几个一致点：

- "失败 = 判别式联合，不抛异常"在 6 个新增服务/SOA 边界里同形落地；
- 工具级预算 (`SEMANTICA_REASONING_BUDGET_MS`) 与图节点超时 (`ASSISTANT_NODE_TIMEOUT_MS = AI + max(tool, 45s) + 5s`) 的两条路径**只设一道闸**——没有 LLM 重试循环去吞工具层 budget 错误；
- `MAX_RESULT_CHARS` 在裁剪引文序列时仍然保留 `citations` 与 `citationsTruncated` 双信号，避免"看起来完整"的列表；
- 引用校验失败时**只 drop、warn、不把 envelope 整包丢掉**（`stream-orchestrator.ts:347`），与已有 evidence 路径一致。
