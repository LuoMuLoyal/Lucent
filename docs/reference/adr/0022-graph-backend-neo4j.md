# ADR-0022: 图后端由 Apache AGE 改为 Neo4j

- **Status**: accepted（图后端决定已定；实施未开工——实施计划为 2026-09-29 命名的那份，已按约定删除）
- **Date**: 2026-09-29
- **Deciders**: LuoMuLoyal

## Context

[ADR-0021](0021-semantica-english-side-oag.md) 决定 4 把 `semantica-service` 的图后端定为 Apache AGE 1.7.0，
理由是其 Options 表把专用图数据库整行否决——"三项核心能力根本不走图后端，换库买不到它们"。
该判断隐含前提是**图后端只承担一跳取数**。运行后实测表明该前提不成立。

**AGE 二跳不可用，已迫使服务把推理整体放在另一个引擎里。**

- `semantica-service` 的 `graph/range.py` 注释记录：无向模式 `-[r]-` 用不上端点索引，
  在 200,182 条 `INTERACTS_WITH` 边上**超出连接 `statement_timeout`（实测）**——连"一跳无向"都超时。
- 无向变长路径 `*1..3` 在**单条查询上 12 分钟未完成**（45s `statement_timeout` 收敛）。

因此形如 `A ─一跳→ 中间节点 ←一跳─ B` 的二跳规则在 AGE 上无处安放，只能由 Datalog 承担。
`rules/reasoning.yaml` 随附的三条规则（`potential_ddi` / `shares_target` / `same_atc_class`）
**形状完全一致**，都是该二跳模式：

```datalog
potential_ddi(A, B) :- inhibits(A, E), substrate_of(B, E), A != B.
```

每一条若 AGE 支持可靠二跳，都可用一条 Cypher 直接表达：

```cypher
MATCH (a)-[:INHIBITS]->(e)<-[:SUBSTRATE_OF]-(b) WHERE a <> b
```

**但 Datalog 在此不是旁挂的补丁，而是 `/reason` 的实现本身。** `routes/reason.py` 是 541 行的
端点，其主体为 `DatalogReasoner` + `derive_all()` 不动点 + 截止时间传递，配套
`provenance_bridge.py`（前提恢复）、`reasoning_limits.py`（事实预算）、`rules/rules.py`
（规则库装载与词表校验）、`graph/export.py`（781 行图→事实桥）。依赖
`semantica[..., tripletstore-oxigraph]`（`pyoxigraph` 已安装）。

**该引擎是通用的，不局限于三条规则**：`ReasonRequest.rules` 接受调用方传入的最多 100 条
规则（`routes/schemas.py` 的 `RuleSpec`），`rules.py` 对任意装载的规则库做词表校验。
三条随附规则只是随附规则，不是引擎的能力边界。

**关于引擎可信度（须准确记录）**：`semantica-oag-pilot` 早期暴露过两个 Datalog 静默缺陷——
不等式约束 `A != B` 不生效（试点数据上 12 个自反假阳性）、`load_from_graph` 传图句柄时
返回 0 而不报错。**两者均为上游缺陷，fork 已修复并加了回归测试**：
`semantica-service` 的 `graph/export.py` 头注释记载 `load_from_graph` 现抛 `TypeError`
（"a fork fix; upstream returned 0 and silently reasoned over an empty fact base"）；
该仓的推理自检脚本断言 "inequality enforced"；
`tests/test_endpoints.py::test_reason_honours_inequality_constraints`
与 `docs/VERIFICATION.md`（`X != Y` 生效 ✅）覆盖。

**因此这两条不构成"当前补偿层是坏的"的证据**，而是**引擎信任成本**的证据：一个外部规则引擎
的语义正确性需要靠 fork 自行修补与自建回归来保证，且其失效模式是静默的。这一点与后端选型的
关系是间接的——它衡量的是"维持 Datalog 这一层要付多少看护成本"，而非该层当下有错。

**判据**：检查三条随附规则是否存在 Cypher 无法表达的构造——递归传递闭包是 Datalog 的真实优势。
检查结果为**一条都没有**，三条全是固定二跳。故**当前用法**不依赖 Datalog 的独有能力。

## Decision

1. **图后端改为 Neo4j（Community）**，取代 AGE 1.7.0。落地见 2026-09-29 命名的那份迁移计划
   （实施完毕该文件按约定删除）。
   HTTP 拓扑与 `SEMANTICA_*` 三个键不动；Lucent 侧改动为提示词常量 1 处、引擎名断言 3 处
   （`core.service.spec.ts` 2 处 + `ontology-reasoning.service.spec.ts` 1 处）、以及
   `assistant/README.md` 与 env 文档的散文，**不是零改动**，明细见计划 §3.2。
2. **图后端迁移与推理引擎收编，是两件事，后者是独立的取舍。**
   a. 图后端：一跳取数与导出改由 Neo4j 承担。
   b. **收编推理引擎**：把 `/reason` 从 Datalog 改为手写二跳 Cypher，随之删除 Oxigraph 依赖、
   规则库装载器与图→事实桥。
   **b 的真实代价**：`/reason` 失去通用性——不再接受调用方传入的任意（受审阅的规则 100 条上限），
   规则从"数据"退化为"代码"；`premise` 恢复与 `citation_hint` 须重新推导；
   `ReasonRequest.rules` 的去留须在 P4 裁决（保留→自建等价校验；删除→记为 breaking change）。
   **真实收益**：单引擎、单方言，且不等式约束由 `WHERE a <> b` 原生生效，
   无需依赖外部引擎的语义正确性。这是**用通用性换可维护性**的有意取舍，不是"删除一个补偿层"。
   **b 可独立取消**：若判定"规则即数据"的价值高于单引擎收益，只做 a 即可，a 的收益不受影响。
3. **拆除 `cypher.py` 的限制扫描器**：其拒绝的每一条（`shortestPath` / 多类型边 / `datetime()`）
   均源于 AGE 缺陷，Neo4j 原生支持。同步删除 Lucent 侧 `cypher.prompt.ts` 的 `AGE_LIMITATIONS` 块。
4. **只读性由事务保证**：`execute_read()` 只读事务 + 正则白名单保留为第一道门。
   **此项触及现有唯一只读防线**：白名单实现是 AGE 的 `cypher()` 单语句包裹的产物，
   Bolt 下理由不再成立，但替换期间必须双保险（计划 R5），不得先删白名单再上事务。
5. **钉死 Neo4j 版本**，显式设 heap 512m / pagecache 256m，禁止依赖默认值。
6. **导入必须用 `CREATE`，禁止 `MERGE`**：图中有 **175 组同类型平行边**（`prov` 不同，
   语义上不是同一条边），`MERGE` 会静默合并。
7. **AGE 资产暂不删除**：`docker/postgres-age/` 与 `lucent_graph` 保留为回滚路径，
   迁移验证通过并稳定运行一个周期后清理。

## Options Considered

| Option                                    | Pros                                                                                                                                          | Cons                                                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Neo4j（本 ADR）**                       | Cypher 参考实现，零方言缺口；多跳/最短路径原生；fork **已有 `Neo4jStore`**（无需自写 adapter）；内存实测次线性（4× 时 1,605.6 MiB，边际递减） | Community 为 GPLv3；固定内存 852.8 MiB（实测）；多一个 JVM 容器                                                      |
| 保留 AGE，修补补偿层                      | 零迁移成本；GIN 索引修复实测 35×（4.960 ms → 0.142 ms）；内存增量极小（容器共 161.9 MiB）                                                     | 修不了能力缺口：索引不能让二跳不超时，不能让 `shortestPath` 存在；跨引擎与规则引擎看护成本继续存在                   |
| Memgraph                                  | 装载全图仅 171 MiB；`--memory-limit` 硬上限                                                                                                   | 全内存、线性增长：171 MiB 的优势只在全量 4.5% 时成立，图涨 22 倍后最危险；仍需保留 `datetime()` 拒绝与深路径方言引导 |
| FalkorDB                                  | 复用 Redis                                                                                                                                    | 文档化缺陷命中核心查询：`LIMIT` 不约束 eager 操作、无名关系在平行边下少算 → 静默漏边                                 |
| RyuGraph（Kuzu fork）                     | 最省内存（102–136 MiB）、列存                                                                                                                 | 上游最后推送距今约 8 个月，接手可能停更的依赖；关系类型名被改写；无 `datetime()`                                     |
| 自建（Datalog / SPARQL / PROV-O / SHACL） | 完全可控                                                                                                                                      | 四套机器的实现与维护成本更高；时间线不可接受（与 ADR-0021 同判）                                                     |

**对 ADR-0021 否决理由的修正**：该 ADR 称"三项核心能力根本不走图后端，换库买不到它们"。
前半句仍成立，**后半句不成立**——换库买到的是**解除 AGE 对查询表达力的约束**
（多跳、最短路径、多类型边、`datetime()`），这与"那三项能力"不是同一件事，原判断低估的正是这部分。
**但需如实限定**：换库本身**不降低**推理层的复杂度——Datalog 层的去留是决定 2b 的独立取舍，
不由换库自动带来。

## Consequences

- **契约**：sidecar 对外 HTTP 契约不变（`/query`、`/reason` 等端点与错误类别表不变）。
  图数据形态（`prov` 属性 + Postgres 哈希链审计表）不变，`provenance/*` 从不 import `graph_store`，
  换库零影响。**`/reason` 的能力面收窄**：不再接受调用方传入的任意规则（决定 2b），
  请求侧 `ReasonRequest.rules` 的去留须在 P4 明确（保留则须自建等价校验，删除则是 breaking change）。
- **Lucent 侧改动非零**：提示词常量 1 处、引擎名断言 3 处、`assistant/README.md` 与 env 文档散文；
  明细见计划 §3.2。以"三个键与拓扑不动"描述**进程边界**是准确的，但不宜延伸为"几乎零改动"。
- **能力解锁**：多跳、`shortestPath`/`allShortestPaths`、多类型边、`datetime()`、
  变长路径上的属性访问全部可用——机制链、酶介导 DDI、通路这类"更专业"的场景所需正是这些。
  同时 `cypher.py` 限制层与 Lucent 侧 `AGE_LIMITATIONS` 可删，提示词不再需要告知模型"什么不能用"。
- **安全面**：拆除 `cypher.py` 会触及**现有唯一只读防线**。只读性改由 `execute_read()` 事务保证，
  但其正确性依赖事务模式被正确使用；替换期须双保险（计划 R5），白名单最后删。
- **成本**：多一个含 JVM 的容器，固定内存 852.8 MiB（实测）。内存实测到 4× 为 1,605.6 MiB
  且边际递减，全量外推 ~1.6–1.9 GiB（**外推，非全量实测**；全量约 469 万边，P0 确认是否复测）。
- **许可**：Community 为 GPLv3。当前内网自用且经 HTTP 进程边界调用（不链接 driver），
  **不触发分发义务**；**产品对外交付前须法务评估**。ADR-0021 曾以"候选多为非 OSI 许可"否决，
  此点从"否决"降级为"有明确触发条件的跟进项"。
- **不可逆性**：图数据形态一旦被产品消费，换引擎需重建全部断言与审计；
  沿用每次升级前跑 `add_edge_provenance.py --verify` 确认链与 id 一致的纪律。
- **多跳能力的表达边界**：三条随附规则改写为 Cypher 后，若将来需要"任意长度传递闭包"的规则，
  Neo4j 的表达能力边界需实测（Datalog 在此点上更自然，但当前无此类规则）。
- **图规模口径待统一**：本 ADR 用**实测值 21 种关系类型**（由边数据直接统计），
  而 `semantica-service/docs/VERIFICATION-SCALE.md` §1 记为 **26 种**。两者不一致，
  该文件的两个数字（26 与边数）中至少一个已过时。**P2 验收以实测 21 为准**，
  并须在 P2 一并修正该文档，避免验收依据自相矛盾。

## Relationship to ADR-0021

ADR-0021 的**服务边界与其余决定全部保留**：Semantica 只承接英文侧 OAG（决定 1）、
fork 自持跟随上游 main（决定 2）、入图是确定性 schema 映射而非 LLM 抽取（决定 3）、
sidecar 自建（决定 5）、溯源是一等能力（决定 6）、答案出口唯一（决定 7）、
本体以 Lucent 词表为源（决定 8）、中英映射不进运行时结论层（决定 9）。
被本 ADR 取代的只有**决定 4（图后端）**，并部分修正其 Options 表对专用图数据库的否决理由。
ADR-0021 按只增不改的约定保留原文，历史上限以其落笔时的设计为准。
