# AGE → Neo4j 图存储迁移计划

Created: 2026-09-28（2026-09-29 由 Memgraph 改为 Neo4j）
状态：计划（**未开工**；P0 前置核对完成后进入 P1）
定位：把英文侧 OAG（`semantica-service`）的图后端从 **Apache AGE** 换成 **Neo4j**。**取代** `2026-09-27-apache-age-introduction-plan.md` 的图后端决定（该计划 P0–P5 已落地，本次替换其图存储层；其"不引入新容器"前提（决定 1/6）**在本计划中被显式推翻**）。**Lucent 侧（NestJS）不改架构**：只改一个提示词常量 + 三处注释，因为 Lucent 从不直连图库（`src/config/env/env-keys.config.ts:155`）。

证据标注沿用同目录约定：`[核实]` = 源码 / 官方仓库 / 官方文档 / 实测；`[二手]` = 第三方；`[研判]` = 本文判断；`[待核实]` = 尚未复核，落地前必须补。

---

## 〇、选型经过（为何最终是 Neo4j）

这是一份**反转过多次的决策**，保留完整依据以免后续读者困惑。**最终决定由用户作出（2026-09-29）**。

| 阶段                                        | 结论                                 | 依据                                                                                            |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 初始评估                                    | 不建议换                             | ——                                                                                              |
| 用户决定换                                  | 换，并选出目标库                     | 决定权归用户                                                                                    |
| 第一轮候选排序                              | Neo4j #1 / FalkorDB #2 / Memgraph #3 | 当时按"改动量"给 FalkorDB 加分（**后证伪**：现有 Redis 服务 Lucent 业务，不能作 FalkorDB 母体） |
| 第二轮（加资源维度）                        | Memgraph #1                          | 认为 Neo4j 需 1–2 GiB，小机器滑不动                                                             |
| 第三轮（拿到 2c4g 规格）                    | Neo4j #1                             | 两家都放得下 → 认为能力与现成 adapter 更重要                                                    |
| 第四轮（内存实测）                          | Memgraph #1                          | Memgraph ~171 MiB vs Neo4j 1,243 MiB（实测）；`--memory-limit` 是硬上限                         |
| 第五轮（索引修复实测）                      | **倾向 AGE 不换**                    | §2.8 GIN 索引修复 35×，"AGE 最大痛点可在库内解决"                                               |
| **第六轮（迁移成本与 Datalog 层性质查明）** | **Neo4j（本版）**                    | **决定性问题不是性能，是"AGE 的能力缺口逼出了一整层补偿架构"，见 §〇quater**                    |

### 决定理由（2026-09-29）

**换 Neo4j 的理由不是"Neo4j 更快"（AGE 一跳其实很快，§2.8 实测 35× 优化后 0.142 ms）**，而是：

1. **AGE 的多跳能力缺失，已经把推理整体推到另一个引擎**：`/reason` 的实现主体（541 行端点 + DatalogReasoner + 不动点 + 前提恢复 + 事实预算 + 规则库装载）与图→事实桥（`export.py` 781 行）都建立在 Oxigraph/Datalog 上（§〇quater）。**换库解除的是查询表达力约束**，而"是否收编推理引擎"是独立的取舍，见 §3.5。
2. **该引擎带来持续的看护成本**：外部规则引擎的语义正确性需靠 fork 自行修补与自建回归保证，且失效模式是静默的。**（§〇ter 已更正：两个典型缺陷是上游 bug，fork 已修并加回归测试——故这是信任成本证据，不是"该层当下是坏的"。）**
3. **"做更专业的医疗"= 多跳推理**（机制链、酶介导 DDI、通路），而多跳正是 AGE 最弱、Neo4j 原生支持最强的地方。
4. **Neo4j 内存实测次线性**（§2.6），4 GiB staging 扛得住全量。

**代价（明确接受）**：多一个含 JVM 的容器（固定开销 ~850 MiB 实测，§2.1），运维比"一个 PG 全包"复杂。**换来的是解除查询表达力约束；推理层的简化需另付 P4 的改造代价（§3.5）。**

**被否掉的候选**：Memgraph（全内存、线性增长，全量时最危险，§2.6）、FalkorDB（功能缺陷命中核心查询，§2.2）、RyuGraph（上游停更风险，§2.5）、AGE（能力缺口见上）。

---

## 〇bis、教训一：AGE 时代的「限制」不是需求证据

规划中途曾用「`cypher.py` 拒绝了这个构造」推断「我们用不上」，据此认为候选引擎的语法缺口无所谓。**这个推理是错的**，且它会系统性低估换库收益：

- `cypher.py:78` 拒绝 `shortestPath` —— 因为 **AGE 1.7 解析不了**（实测：`ERROR: syntax error at or near "shortestPath"`）
- `cypher.py:80` 拒绝 `datetime()` —— 因为 AGE 没有，**日期只能存成字符串**（被逼的数据模型）
- `cypher.py:79` 拒绝多类型边 —— 因为 AGE 没有，只能拆成多条 pattern

**这三条是「想要但拿不到」，不是「不需要」。** 拿被 AGE 裁剪后的查询文本当需求基线，等于**用枷锁证明手脚没用**。

**正确判据**：拿 AGE 时代的**查询意图**（而非被裁剪的**查询文本**）去对照候选引擎。

---

## 〇ter、教训二：同一推理错误犯了两次（**本文最有价值的部分**）

本计划的选型在两天内反转六次，其中**两次是因为同一个思维错误**。记录在此，因为它比结论本身更值得保留。

### 第一次：把测试集当需求

在 AGE 上跑了 232 次真实 LLM 输出 → 真实 AGE 执行（29 题 × 2 条件 × 2 模型 × 2 轮），发现 deepseek 在"最短路径"类问题上失败率高。

**我当时的推断**："AGE 撑不住，换 Neo4j。"
**错误**：那 29 道题**是我自己出的**，其中 Q24–Q27 是最短路径题。**我用一个产品并不需要问的场景，判了技术栈死刑。**

更糟的是，那批测试里 deepseek 的失败**不是语法错误，是超时**：

```cypher
MATCH (a:Drug)-[r:INTERACTS_WITH*1..3]-(b:Drug)   -- 20 万条边上的无向三跳
```

实测**单条跑 12 分钟未完成**，最后靠 45s `statement_timeout` 才收敛。这是**图遍历复杂度**问题，我把"我的题难"读成了"库不行"。

### 第二次（更危险）：把「生产没写」读成「生产不需要」

查 `semantica-service/src/semantica_service/graph/range.py`（276 行，6 条查询全部是**固定长度单跳**：

```cypher
_INTERACTION_PARTNERS_OUT   MATCH (a:Drug {drugbank_id: seed})-[:INTERACTS_WITH]->(b:Drug)
_INTERACTION_PARTNERS_IN    MATCH (a:Drug)-[:INTERACTS_WITH]->(b:Drug {drugbank_id: seed})
_PROTEIN_NEIGHBOURS         MATCH (a:Drug {drugbank_id: seed})-[r]->(p:Protein)
_DRUGS_IN_ATC               MATCH (d:Drug)-[:IN_ATC_CLASS]->(c:ATCClass {code: code})
```

全服务 grep `*1..` / `shortestPath` → **只在 `cypher.py:78` 出现一次，那是"AGE 不支持"的拒绝文案，不是查询**。

**我当时的推断**："生产零使用变长路径 → 所以产品不需要多跳 → 留 AGE。"
**错误**：**多跳没有消失，它换了个实现层。**

### 真相：多跳被 Datalog 接管了，而 Datalog 是妥协

`semantica-service/rules/reasoning.yaml` 三条规则**全是二跳**：

```datalog
potential_ddi(A, B)  :- inhibits(A, E), substrate_of(B, E), A != B.
shares_target(A, B)  :- acts_on(A, T),   acts_on(B, T),   A != B.
same_atc_class(A, B) :- in_atc_class(A, C), in_atc_class(B, C), A != B.
```

形状完全一致 —— `A ─一跳→ 中间节点 ←一跳─ B`，即 **A 与 B 的二跳关系**：

```
华法林 ──INHIBITS──→ CYP2C9 ←──SUBSTRATE_OF── 氯霉素
   A        一跳         E          一跳          B
             └────── 二跳结论 potential_ddi(A,B) ──────┘
```

**这三条若 AGE 支持可靠二跳，本可以写成 Cypher：**

```cypher
MATCH (a)-[:INHIBITS]->(e)<-[:SUBSTRATE_OF]-(b) WHERE a <> b
```

**但 `range.py:72-74` 的注释记录了实测结果**：

> The two directions are two statements rather than one undirected pattern: `-[r]-` cannot use either endpoint index and **an undirected scan over 200,182 interaction edges exceeds the connection's statement_timeout (measured)**.

**连"一跳无向"都超时，二跳更不可能。** 所以 Datalog 层存在的唯一理由是 **AGE 做不了多跳**。

### 关键判据（用户提出，本文采纳）

> "Datalog 那不很明显纯妥协吗，因为 AGE 能力限制不得不选的。AGE 能力足够强的话要 Datalog 干什么？"

**这个判据是可验证的**，且验证结果为真：

| 检查                                                   | 结果                                                             |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| Datalog 规则是否有 Cypher 无法表达的（递归传递闭包）？ | ❌ **一条都没有**，三条全是固定二跳                              |
| 三条规则能否一一写成 Cypher？                          | ✅ 能，且更短（见上）                                            |
| Datalog 层是否引入了独立复杂度？                       | ✅ Oxigraph 引擎 + 规则文件 + 子图导出 + 结论翻译 + 跨引擎一致性 |
| 该层是否有自己的缺陷？                                 | ✅ **有静默错误**，见下                                          |

### ⚠️ 更正：两个 Datalog 静默缺陷是**上游 bug，fork 已修**（曾经被我错误引用）

本节先前写作"补偿层自身存在静默缺陷，现行应对是绕过而非修复"，**这个表述是错的**。
复核 `semantica-service` 源码后更正如下。

**① 不等式约束** —— `semantica-oag-pilot` 早期实测 `A != B` 与 `<>` 均不生效（12 个自反假阳性）。
但**该缺陷是上游 Semantica 的 bug，fork 已修复并加了回归测试**：

| 证据               | 位置                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 断言"不等式已生效" | `scripts/check_reasoning.py:83-93`（`=== Datalog inequality (fork fix) ===`，`assert found, "inequality constraint was silently ignored"`）                         |
| 端点级回归测试     | `tests/test_endpoints.py:222` `test_reason_honours_inequality_constraints`（docstring：_"Inequalities were the subject of a fork fix; they must not be ignored."_） |
| 验证记录           | `docs/VERIFICATION.md:31` → 推理结果无自反冲突（`X != Y` 生效）✅                                                                                                   |
| 端到端检查         | `check_labels_e2e.py:122` `len(self_pairs) == 0`                                                                                                                    |

**② `load_from_graph`** —— 同为上游 bug，fork 改为抛 `TypeError`：

> `graph/export.py:27-31`：_"`DatalogReasoner.load_from_graph` documents that a graph-store handle
> is not an accepted input ... and raises `TypeError` otherwise (**a fork fix; upstream returned 0
> and silently reasoned over an empty fact base**)."_

这也是 `graph/export.py` 这个适配层存在的原因。

**更正后的正确含义**：这两条**不是"当前补偿层是坏的"的证据**，而是**引擎信任成本**的证据——
外部规则引擎的语义正确性要靠 fork 自行修补与自建回归保证，且其失效模式是**静默**的。
它衡量的是"维持 Datalog 这层要付多少看护成本"，而非该层当下有错。

**同时更正一处错误类比**：先前把 12 个自反假阳性与 `VERIFICATION-SCALE.md` §3.3 并称"同级"。
**§3.3 讲的是另一回事**——节点查询与边查询各自独立使用同一 `limit`，导致边可指向未取到的节点
（`limit=1000` 时标签数 1000→1013，13 个端点无名），是**名称解析的完整性**缺陷，且已修。
与"约束未生效"不是同类问题，该类比不成立。

### 结论

**这层不是"两层各司其职的主动设计"，是"下层缺能力、上层打补丁、补丁自己还有洞"。** 换 Neo4j 可**整体删除该层**：

| 现在                                                         | 换 Neo4j 后                 |
| ------------------------------------------------------------ | --------------------------- |
| 导出子图 → 灌 Oxigraph → 跑 Datalog → 翻译回结论             | **一条 Cypher 直接出结果**  |
| 不等式靠后处理兜底                                           | `WHERE a <> b` **原生生效** |
| 两个引擎依赖（`graph-apache-age` + `tripletstore-oxigraph`） | 一个                        |
| 跨引擎一致性问题                                             | 不存在                      |

---

## 〇quater、AGE 侧实测缺陷汇总（换库的实证依据）

| 发现                                  | 实测                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **变长路径不可用**                    | 20 万边上的无向 `*1..3` **单条 12 分钟未完成**；`range.py:72-74` 记录的"一跳无向"即已超时                            |
| **无 `shortestPath`**                 | `ERROR: syntax error at or near "shortestPath"`                                                                      |
| **无多类型边**                        | `[r:A\|B]` → `ERROR: syntax error at or near "\|"`                                                                   |
| **无 `datetime()`**                   | `function datetime does not exist`                                                                                   |
| **变长路径上的属性访问失败**          | `[rel IN r \| rel.prov]` → `ERROR: could not find properties for rel`                                                |
| **`SET` 不能用 map 变量**             | `SET r = row.p` / `SET r = pl[i]` → `ERROR: SET clause expects a map`（须逐键赋值）                                  |
| **`cypher()` 第三参数必须是绑定变量** | 任何字面量（`NULL`/`'{}'::agtype`/`agtype_build_map(...)`）→ `third argument of cypher function must be a parameter` |
| **默认无属性索引**                    | `drugbank_id`/`code`/`uniprot_id` 全无索引 → `Seq Scan`（**但可修复，见 §2.8**）                                     |
| 基线                                  | 3,278 节点 / 211,630 边（与 `VERIFICATION-SCALE.md` 一致）                                                           |
| 关系类型                              | **21 种**；`INTERACTS_WITH` 占 200,182（94.6%）                                                                      |

> **注**：`SET r = row.p` 与 `cypher()` 第三参数这两条是 2026-09-29 重新导入图数据时**新踩到**的，不在早期记录中。

---

## 一、要解决的问题（为什么换）

换库**不是为了省内存，也不是为了少改代码**。收益按优先级：

| #   | 收益                          | 现状缺陷                                                                                               | 依据                                                                                                           |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1   | **解除 AGE 的查询表达力约束** | AGE 二跳即超时 → 二跳规则只能靠 Datalog 绕行；多跳 / `shortestPath` / 多类型边 / `datetime()` 全不可用 | §〇quater、§〇bis 教训二                                                                                       |
| 2   | **原生参数绑定**              | AGE 不支持 `$param`，fork 靠**字符串转义拼接**进 Cypher 文本                                           | `[核实]` `semantica/graph_store/age_store.py:928` 注释原文；`:958` `final_query.replace(placeholder, literal)` |
| 3   | **去掉崩库版本债**            | AGE ≥1.8 `id(n) IN <list>` 触发 **SIGSEGV 崩 PG**，被迫钉在 `PG18/v1.7.0-rc0` **pre-release**          | `[核实]` `docker/postgres-age/Dockerfile:10-12,36`；`apache/age#2500`（open）                                  |
| 4   | **能力补齐**                  | 无多类型边、无 `datetime()`、无 `shortestPath`、变长路径属性访问失败                                   | `[核实]` `cypher.py:78-80`、`_UNSUPPORTED_SYNTAX:85-99`                                                        |
| 5   | **只读改由事务保证**          | 只读性靠**正则白名单**猜（`check_read_only`），白名单源自 AGE 的 `cypher()` 单语句 SQL 包裹            | `[核实]` `cypher.py:224-263`                                                                                   |

**内存是代价（但可接受）**：AGE 寄生在既有 PG 里，换 Neo4j 多一个容器，空实例固定开销 **852.8 MiB**（实测）。**但 Neo4j 内存不随数据线性增长**（§2.6），这是它在全量场景的关键优势。

---

## 二、为什么是 Neo4j（同口径对比）

### 2.1 资源占用（2c4g staging 实测口径）

**staging 存量占用盘点**（依据 `compose.staging.yaml` 的服务清单 + 宿主 PM2）：

| 组成                         | 估算           | 依据                                                                                         |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| Postgres 18 + pgvector + AGE | ~400 MiB       | 扩展 + 两库（`lucent` / `lucent_graph`）                                                     |
| Redis 8-alpine               | ~64 MiB        | 业务缓存 + BullMQ                                                                            |
| **LightRAG**                 | **~425 MiB**   | `[核实]` **实测值**：`deploy/lightrag/.env:26-28` 记"抽取 100 份语料时容器内存 423MiB/15GiB" |
| VictoriaMetrics              | ~150 MiB       | `retention 15d`，单二进制                                                                    |
| VictoriaLogs                 | ~120 MiB       | `retention 15d`                                                                              |
| Traefik v3.6                 | ~80 MiB        | TLS 终止 + 路由                                                                              |
| Lucent app（宿主 PM2）       | ~450 MiB       | 不在 compose 内                                                                              |
| OS + Docker daemon           | ~400 MiB       |                                                                                              |
| **已占用**                   | **~2,090 MiB** |                                                                                              |
| **余量**                     | **~2,000 MiB** | 4 GiB 机器                                                                                   |

**候选落位**（**同图实测**：3,278 节点 / 211,630 边）：

| 候选                                    | 装载全图后 RSS                                  | 类型              | 判定                                  |
| --------------------------------------- | ----------------------------------------------- | ----------------- | ------------------------------------- |
| **RyuGraph**（嵌入式）                  | **102–136 MiB**                                 | 列存**磁盘**      | ✅ 最省，但上游风险见 §2.5            |
| **Memgraph**                            | **171 MiB**                                     | **全内存**        | ⚠️ 当前量级宽裕，**全量危险**（§2.6） |
| **Neo4j**（heap 512m + pagecache 256m） | **1,243 MiB**                                   | 磁盘 + page cache | ✅ **选它**，见 §2.6                  |
| Neo4j（heap 2g + pagecache 1g）         | 2,673 MiB                                       | ——                | ⚠️ 只是**配置**结果，非引擎下限       |
| **AGE**（现役）                         | 容器共 **162 MiB**（含 `lucent` 业务库 2.6 GB） | PG 磁盘           | 增量极小，但能力不足（§〇quater）     |

**⚠️ 重要修正**：先前记录的"Neo4j 2,586 MiB"来自 **heap 2g + pagecache 1g** 的配置（为撑过批量导入临时调高），**不是 Neo4j 的下限**。改回 **heap 512m + pagecache 256m** 后，同一张图实测 **1,243 MiB**——**省下 1,430 MiB**。

**Neo4j 内存分两块**（这是理解其全量行为的关键）：

| 部分                          | 实测                    | 是否随数据增长                                        |
| ----------------------------- | ----------------------- | ----------------------------------------------------- |
| **固定（JVM/jemalloc/框架）** | **852.8 MiB**（空实例） | ❌ 不增长                                             |
| **数据（page cache + 索引）** | 390 MiB（211,630 边）   | ⚠️ 但 **page cache 上限固定 256 MiB**，超出部分留磁盘 |

**结论**：Neo4j 是"**高固定成本 + 低边际成本**"——给它 256 MiB page cache，它就只用 256 MiB，**数据涨到 470 万边也不会线性吃掉内存**。**这在"数据将涨 22 倍"的场景下是决定性优点。**

### 2.2 Cypher 兼容性（**按查询意图评估，非按 AGE 裁剪后的文本**）

**关键认知（见 §〇bis）**：`cypher.py` 的拒绝列表是**AGE 约束的产物**，不能当作"我们用不上"的证据。

`[核实]` 实际用到的构造（`src/semantica_service/graph/*.py`）：

| 构造                                                            | 用在哪                        | **Neo4j（选）**                          | AGE                      | Memgraph |
| --------------------------------------------------------------- | ----------------------------- | ---------------------------------------- | ------------------------ | -------- |
| `MATCH`/`WHERE`/`RETURN`/`ORDER BY`/`LIMIT`/`UNWIND`/`DISTINCT` | 全部核心查询                  | ✅                                       | ✅                       | ✅       |
| `UNWIND $keys AS seed` + 属性查找                               | `range.py:36,55,76,85,96`     | ✅                                       | ✅                       | ✅       |
| `STARTS WITH`/`toLower()`/`coalesce()`                          | `range.py:38,46,47`           | ✅                                       | ✅                       | ✅       |
| `labels()`/`type()`/`properties()`                              | `export.py`、`get_stats()`    | ✅                                       | ✅                       | ✅       |
| **`$param` 原生绑定**                                           | 全部                          | ✅                                       | ❌ **字符串拼接**        | ✅       |
| **二跳模式**（`potential_ddi` 等三条规则）                      | `rules/reasoning.yaml`        | ✅ **原生**                              | ❌ **超时**（§〇quater） | ✅       |
| 多类型边 `[r:A\|B]`                                             | `cypher.py:79` 拒绝（AGE 缺） | ✅                                       | ❌                       | ✅       |
| **深路径（最短/加权/K 条）**                                    | `cypher.py:78` 拒绝（AGE 缺） | ✅ **`shortestPath`/`allShortestPaths`** | ❌                       | ✅ 方言  |
| `datetime()`                                                    | `cypher.py:80` 拒绝（AGE 缺） | ✅                                       | ❌                       | ❌       |
| 变长路径属性访问 `[rel IN r \| rel.prov]`                       | 232 题实测失败                | ✅                                       | ❌                       | ✅       |

**Neo4j 是 Cypher 参考实现**：上表**全部 ✅**，无方言、无缺口。这意味着 `cypher.prompt.ts` 的 `AGE_LIMITATIONS` **可以整体删除**（§3.4）——模型不再需要被告知"什么不能用"，因为它都能用。

**FalkorDB 被功能性否决（非偏好）**：其两条文档化缺陷直接命中我们的核心查询 ——

- [LIMIT 不约束 eager 操作](https://docs.falkordb.com/cypher/known-limitations)：`CREATE … RETURN … LIMIT 1` 仍全量执行；
- 无名关系只验证存在性：`MATCH (a)-[e]->(b) RETURN COUNT(b)` 在平行边下**少算**。

我们的 `range.py:75-89` 正是**无名关系 + `ORDER BY … LIMIT`** 的形状，会造成**相互作用边静默缺失**。在医药场景**不可接受**。

### 2.3 许可与上游

|            | **Neo4j（选）**                          | Memgraph                       | FalkorDB                     |
| ---------- | ---------------------------------------- | ------------------------------ | ---------------------------- |
| 许可       | Community **GPLv3**                      | BSL 1.1 + Additional Use Grant | **SSPL v1**（非 OSI 开源）   |
| 对外交付时 | **需法务过**（GPL 义务随分发触发）       | 授权失效，需商业许可           | §13 触发，须开源服务全部源码 |
| 上游       | 商业公司 + 活跃社区，**Cypher 参考实现** | 商业公司                       | 商业公司                     |

**GPLv3 的影响面（如实记录）**：`semantica-service` 是**内网服务、不对外交付**（`Lucent/deploy/semantica/.env.example` 注明"不是 lucent app 的 .env""自身不持有任何模型凭据"）。

- **内网自用**：不触发 GPL 分发义务 ✅
- **进程边界**：Lucent 通过 **HTTP** 调用 sidecar，**不链接** Neo4j driver，属独立进程通信 ✅
- **若将来整体交付第三方**：需法务评估 ⚠️

对比之下 Memgraph 的 BSL 对"内部生产使用"更宽松。**但 §〇bis 教训二表明：为规避一个许可问题而接受一整层有静默错误的补偿架构，是错误的天平。** 许可风险是**未来的、有明确触发条件的**；补偿层的静默错误是**现在的、已经发生的**。[研判]

### 2.4 已知代价（不回避）

| 项                           | 实情                                                                                                 | 处置                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **固定内存高**               | 空实例 **852.8 MiB**（实测），JVM 底座压不动                                                         | 接受；2c4g 余量 ~2,000 MiB 放得下（§2.6）                                        |
| **必须调参**                 | 默认配置约 1.5 GiB 会挤占机器                                                                        | P0 用 `neo4j-admin server memory-recommendation` + 实测定 heap/pagecache（§4.3） |
| **容器更重**                 | 官方镜像含 JVM，比 Memgraph 大                                                                       | 接受                                                                             |
| **超时语义变化**             | 无 Postgres `statement_timeout` 的 per-connection 能力；Neo4j 有 `dbms.transaction.timeout`          | 客户端 `SEMANTICA_TIMEOUT_MS=20000` 兜底 + 服务端超时兜底（P4）                  |
| **GC 停顿**                  | JVM 固有                                                                                             | heap 给足 + 选用低停顿 GC（P0 压测验证）                                         |
| **`get_stats()` 实现**       | fork `Neo4jStore.get_stats()`（`:1028-1060`）用 `MATCH (n) RETURN count(n)` 等**纯 Cypher 全表计数** | 21 万边下为全扫描，**需实测耗时**；必要时改为维护计数（P1 `[待核实]`）           |
| **`$param` 在 Neo4j 的边界** | 参数不能用于 label/rel-type/属性名（4.x 起如此）                                                     | `export.py` 的动态 label 需确认走白名单拼接（P0 `[待核实]`）                     |
| **写入批量吞吐**             | 逐条 `CREATE` 在 AGE 上实测 **~107 边/s**（211,630 边耗时 2,204 s）                                  | P3 用 `apoc.periodic.iterate` 或 `UNWIND` 批量；**需实测 Neo4j 导入耗时**        |

**已澄清、不再视为代价的两项**：

- **审计不受影响**：项目的"可审计"= **Semantica 自己的哈希链 provenance**，落在 **Postgres 的 `semantica_provenance` 表**（`provenance_dsn` → **Lucent 库**，非图库），导入时由 `scripts/add_edge_provenance.py` 写入，请求期只读（`provenance/reader.py:4`），由 `/provenance/verify` 的 `verify_chain()` 校验。`provenance/*` **从不 import `graph_store`**，换库**零影响**。
- **监控无需改动**：现有 VictoriaMetrics **只抓 Lucent app 的 `/metrics`**（`vmscraper.staging.yml`），不抓图库。若将来要抓 Neo4j 指标，它**自带 Prometheus 端点**（`server.metrics.prometheus.enabled=true`，Community 可用），比 Memgraph 更省事。

### 2.5 RyuGraph（嵌入式候选，实测后**未采纳**）

Kuzu 于 2025-10 归档（`kuzudb/kuzu` 仓库 `archived: true`，最后 push 2025-10-10）。社区 fork **RyuGraph**（`predictable-labs/ryugraph`，MIT）实测可用：

| 项                                    | 实测值                                         |
| ------------------------------------- | ---------------------------------------------- |
| 读全图 RSS                            | **101.8 MiB**（open）→ 135.6 MiB（查完）       |
| 磁盘                                  | **123.57 MiB**（单文件）                       |
| 装载 211,630 边                       | 942 s（逐条 `CREATE`，**未走批量导入**）       |
| 基础查询/`$param`/多类型边/`SHORTEST` | ✅ 2–27 ms                                     |
| `datetime()`                          | ❌ 不存在                                      |
| `DISTINCT` + `ORDER BY` 别名          | ⚠️ 需改写为 `WITH ... RETURN`                  |
| 关系类型名                            | ⚠️ **被改写为 `<TYPE>_<SrcLabel>_<DstLabel>`** |

**数据一致性已验证**：warfarin 入边 **530**、`DB08910` 出边 **612**——与 AGE 完全吻合。

**未采纳理由（非技术形态）**：

1. **上游存续风险**：fork 的最后代码推送为 **2026-01-20**（距今约 8 个月），PyPI 最后发版 2025-12-06。Kuzu 原厂的死亡轨迹相似，**这是接手一个可能停更的依赖**。
2. **提示词仍须改**：关系类型名被改写，`cypher.prompt.ts` 不能零改动。
3. **无 `datetime()`**，与 Memgraph 同等限制。

**触发重新评估的条件**：其发布节奏恢复且稳定 6 个月以上。

### 2.6 全量内存（**决定性约束**，图仅占全量 **4.5%**）

`[核实]` AGE 现图 **895** 个 Drug；`DrugDataBase/derived/drugbank/drugbank_drugs.parquet` 共 **19,842** 个。**895 / 19,842 = 4.5%**。

按真实源数据推算全量：

|              | 当前（4.5%） | 全量（约 22×） |
| ------------ | ------------ | -------------- |
| 节点         | 3,278        | ~72,700        |
| 边           | 211,630      | **~4,690,000** |
| AGE 图库磁盘 | 134 MB       | ~2.9 GB        |

**Neo4j 逐级实测**（heap 512m / pagecache 256m）：

| 规模   | 边数        | RSS             | 边际成本        |
| ------ | ----------- | --------------- | --------------- |
| 空     | 0           | **852.8 MiB**   | ——              |
| 真实图 | 211,630     | **1,243.1 MiB** | ——              |
| 2×     | 423,260     | **1,461.2 MiB** | 5.87 MiB / 千边 |
| 3×     | 634,890     | **1,537.0 MiB** | 3.45 MiB / 千边 |
| 4×     | **846,342** | **1,605.6 MiB** | 2.42 MiB / 千边 |

**边际成本递减，且实测到 4×（84.6 万边）** → 全量外推 ≈ **1.6–1.9 GiB，基本走平**。`[研判]`（外推，非全量实测）

**全量内存对比**（4 GiB 机器，可用约 2 GB）：

| 引擎         | 内存模型                   | 全量时                     | 判定                                         |
| ------------ | -------------------------- | -------------------------- | -------------------------------------------- |
| **Neo4j**    | 磁盘 + **固定 page cache** | ~1.6–1.9 GiB，**基本恒定** | ✅ **扛得住**                                |
| **Memgraph** | **全内存**                 | ~2–3 GiB，**线性增长**     | ❌ **危险**（实测已撞 `--memory-limit=384`） |
| **AGE**      | PG，**page cache 可回收**  | 增量很小                   | ✅ 内存扛得住，但能力不足                    |

**这推翻了一个早期结论**：Memgraph 的 171 MiB 优势**只在当前 4.5% 量级成立**；因其图**必须全部驻留内存**，全量时反而**最危险**。而 Neo4j 的高固定开销**换来了"内存不随数据线性增长"**。

### 2.7 AGE 的真实内存（现役基线，供对比）

`[核实]` `lucent-postgres-dev` 容器共 **161.9 MiB**，但其中含：

| 库                       | 磁盘       |
| ------------------------ | ---------- |
| `lucent`（业务）         | 2,665 MB   |
| `lightrag`               | 172 MB     |
| **`lucent_graph`（图）** | **134 MB** |

**AGE 的增量成本远小于独立图库容器**：与业务库**共用** `shared_buffers` 与连接进程，图数据主要**留在磁盘**，内存体现为**可回收的 OS page cache**。

**`INTERACTS_WITH` 单表 114 MB**（占图库 85%）。

**这是 AGE 的真实优点**：天然磁盘型、内存增量小。**但内存不是本计划的决定因素** —— 决定因素是 §〇bis 教训二的能力缺口。

### 2.8 ⚠️ AGE 索引修复实测成功（**已评估，不足以推翻迁移**）

P0 曾记录 AGE"**完全没有属性索引**"，`drugbank_id` 查询走 `Seq Scan`（`Rows Removed by Filter: 894`）。**但那只是默认状态——AGE 的节点表就是普通 PostgreSQL 表**：

```
Table "lucent_graph.Drug"
 id         | ag_catalog.graphid
 properties | ag_catalog.agtype
Indexes: "Drug_pkey" PRIMARY KEY, btree (id)     <-- 仅此一个
```

`properties` 是 `agtype`（PG 的 jsonb 超集），查询谓词是 `properties @> '{"drugbank_id": "DB00682"}'::agtype`——**这正是 GIN 索引的适用形态**。

**实测（`CREATE INDEX ... USING gin (properties)`）**：

| 查询                                     | 索引前                                               | 索引后                                                                           | 提升    |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- | ------- |
| `MATCH (d:Drug {drugbank_id:'DB00682'})` | `Seq Scan`，扫 **895** 行，653 buffers，**4.960 ms** | **`Bitmap Index Scan on drug_props_gin`**，扫 **1** 行，43 buffers，**0.142 ms** | **35×** |

**✅ 在真实 `range.py` 查询中同样生效**：

```
Nested Loop
  -> Bitmap Heap Scan on "Drug" b        <-- 用了 GIN，只取 1 行
       Recheck Cond: (properties @> '{"drugbank_id": "DB00682"}'::agtype)
       -> Bitmap Index Scan on drug_props_gin
  -> Bitmap Heap Scan on "INTERACTS_WITH" <-- 走 end_id 索引，530 条入边
```

**端到端计时（实测）**：warfarin 入边（530 条，LIMIT 50）**5.843 ms**；单药属性查找 **0.344 ms**；`DB08910` 出边（612 条，LIMIT 50）**4.539 ms**。

**成本**：GIN 索引 **696 kB**（`Drug` 表总 3,568 kB），建索引秒级。

**结论修正（重要）**：此修复**消除了 AGE 的性能痛点**，一度使选型天平倾向"不换"。**但它修不了能力缺口** —— 索引不能让二跳不超时，不能让 `shortestPath` 存在。**故本迁移计划不变**，且**该索引优化仍建议在 AGE 上先建**（P0 步骤，可随时 DROP），以便 A/B 对比。

---

## 三、现状与改动面（已实测）

### 3.1 store 真实契约（只有 4 个方法）

`[核实]` 通过全量 grep `src/` 确认，服务**只调用**：

```python
execute_query(query: str, parameters: dict | None = None, **options) -> dict
    # 返回 {"success", "records", "keys", "metadata"}
get_stats() -> dict          # node_count / relationship_count / label_counts / relationship_type_counts
connect(**options) -> bool
close() -> None
```

`create_node` / `create_relationship` / `get_neighbors` / `shortest_path` / `create_index` **服务内零调用**（仅 `scripts/` 与 `methods.py` 包装用到）。

**结论：Neo4j adapter 已存在于 fork（`Neo4jStore`），无需自写。** `[核实]`

### 3.2 改动清单

| 组件                                                           | 行数    | 改动                                                                                                                                                                                                | 风险                   |
| -------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **fork 后端分派**                                              | ~3      | `graph_store.py:571-602` 是字面 if/elif，**`neo4j` 分支已存在** → 只需切换配置                                                                                                                      | **低**                 |
| **fork 依赖**                                                  | ~2      | `pyproject.toml:26` extras `graph-apache-age` → 保留/改用 `neo4j`                                                                                                                                   | 低                     |
| `graph/pool.py`                                                | 237     | **~180 行删除**：psycopg2 池 → driver 自带池（**session 非线程安全，每线程一个**）；`getattr(store,"_conn")` 穿透、`SHOW statement_timeout`、`_dsn_with_timeouts`、`_parse_pg_duration_ms` 全部作废 | **关键路径**           |
| `graph/retry.py`                                               | 171     | ~40：psycopg2 标记 → `neo4j.exceptions.TransientError`/`ServiceUnavailable`                                                                                                                         | 中                     |
| **`cypher.py`**                                                | 336     | **扫描器整体拆除**（§3.3）——所有拒绝理由都是 AGE 缺陷                                                                                                                                               | **高**                 |
| `graph/export.py`                                              | 781     | ~35：注解、`_as_dict` 的 agtype 归一化、2 处错误串；**6 条查询模板原样保留**                                                                                                                        | 低                     |
| `graph/range.py`                                               | 276     | ~12：注解 + 1 消息 + 1 注释；**6 条查询原样保留**                                                                                                                                                   | 低                     |
| `graph/orientation.py`                                         | 190     | **0**                                                                                                                                                                                               | 无                     |
| `routes/query.py`                                              | 161     | ~15：文档串/消息                                                                                                                                                                                    | 低                     |
| `routes/{health,schema,resolve,reason,validate}.py`            | —       | ~18：文档串 + `get_stats()` 契约                                                                                                                                                                    | 低-中                  |
| `config.py`                                                    | 97      | ~15：`age_dsn`/`graph_name` → Bolt URI + 凭据                                                                                                                                                       | 低                     |
| **Datalog 层**（`rules/reasoning.yaml` + Oxigraph 接线）       | —       | **删除或降级为可选**（§3.5）——三条规则改写为 Cypher                                                                                                                                                 | **中（架构简化）**     |
| `provenance/*` + `routes/provenance.py`                        | —       | **0**（独立 Postgres store，见 §2.4）                                                                                                                                                               | 无                     |
| `scripts/*.py`                                                 | 12 文件 | ~30 处 `settings.age_dsn` → 新连接配置                                                                                                                                                              | 中（离线，非请求路径） |
| **Lucent** `cypher.prompt.ts`                                  | 131     | **删除 `AGE_LIMITATIONS` 四条 + 相关引用**（§3.4）                                                                                                                                                  | **高（跨仓契约）**     |
| **Lucent** `sidecar-defaults.ts:46-52`                         | ~5      | 注释：20s 超时原按 `statement_timeout` 校准                                                                                                                                                         | 低                     |
| **Lucent** `semantica.types.ts:59`、`env-keys.enum.ts:154-161` | ~5      | 错误类别表 + AGE 注释                                                                                                                                                                               | 低                     |
| 测试                                                           | 288     | **~35-40 个** AGE-specific（`test_pool.py` 18 个整体失效、`test_retry.py` 5 个、`test_cypher.py`/`test_query.py`/`test_export.py` ~8 个）；**~250 个后端无关（stub 驱动）**                         | 中                     |

> **adapter 不需要自写**（与 Memgraph 方案的关键差异）：fork 已有 `Neo4jStore`，`age_store.py:308` 注释明写 "Provides the same backend interface as Neo4jStore / FalkorDBStore" —— **接口本就同构**。这省下 P1 的 ~300 行自写工作量。

### 3.3 `cypher.py` 扫描器拆除（**换库的意义所在**）

现有扫描器拒绝的构造**逐条来自 AGE 缺陷**（见 §〇bis）。**Neo4j 上这些构造全部可用，故整个拒绝层应删除**：

| 现行拒绝                                                  | 处置                                                                 | 理由                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `_MSG_SHORTEST_PATH`（`:78`）                             | **删除该条**                                                         | Neo4j **原生支持** `shortestPath`/`allShortestPaths`                                      |
| `_MSG_MULTI_TYPE`（`:79`）                                | **删除该条**                                                         | Neo4j **支持**多类型边                                                                    |
| `_MSG_DATETIME`（`:80`）                                  | **删除该条**                                                         | Neo4j **支持** `datetime()`                                                               |
| `_UNSUPPORTED_SYNTAX` 正则（`:85-99`，应用点 `:259-261`） | **删除**                                                             | 拒绝理由全部消失                                                                          |
| `_UNSUPPORTED_ERROR_TEXT`（`:102-106`）                   | **删除**                                                             | 同上                                                                                      |
| `_MSG_TIMEOUT` 提及 `statement_timeout`（`:124-127`）     | 改述为引擎超时                                                       | 机制变了（见 §2.4）                                                                       |
| `"AGE rejected the Cypher"`（`:310`）                     | 改述                                                                 | —                                                                                         |
| `check_read_only` 白名单（`:224-263`）                    | **改由只读事务保证**（`session.execute_read()`）+ 正则保留为第一道门 | 白名单源自 AGE 的 `cypher()` 单语句 SQL 包裹；Bolt 下理由已不成立；**正则守安全线本就脆** |

> **这是本方案相对 Memgraph 的核心优势**：Memgraph 仍需保留 `datetime()` 拒绝与深路径方言引导，**Neo4j 则整层删除**。

### 3.4 跨仓提示词契约（`Lucent/.../cypher.prompt.ts`）

当前 `AGE_LIMITATIONS`（`:16-21`）四条，**逐条均可删除**：

| 现行文本                                                                                         | 处置                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| "No `shortestPath()` / `allShortestPaths()`. Write an explicit typed multi-hop pattern instead." | **删除**（Neo4j 原生支持）                                                                     |
| "No multi-type edge patterns like `[r:A\|B]`."                                                   | **删除**（Neo4j 支持）                                                                         |
| "No `datetime()`. Stored dates are strings."                                                     | **删除**（Neo4j 支持）。**但"图内日期按字符串存储"是数据事实，若仍成立应在 schema 说明中保留** |
| "variable-length path must be anchored / typed / bounded"                                        | **保留**——这是**性能**约束（20 万边实测），与引擎无关；可改为"锚定与有界"的通用建议            |

同步动作：

- `:40` "ONE read-only Cypher query for an **Apache AGE** graph" → 改引擎名
- `:64` "Apache AGE 1.7 limitations (hard — these fail at execution)" → **整块删除**
- `RETRY_HINTS.unsupported_feature`（`:31-32`）"see the AGE limitations above" → 改述
- **错误类别表两侧同步**：`cypher.py` 的 `QueryErrorKind` 与 `semantica.types.ts:59` 的 `SEMANTICA_QUERY_ERROR_KINDS` 六个值逐字一致（`not_read_only`/`multiple_statements`/`syntax_error`/`unsupported_feature`/`timeout`/`internal`）；**若 `unsupported_feature` 已无触发路径，两侧同步决定保留（向后兼容）还是删除**

### 3.5 推理引擎的处置（**这是独立取舍，不是"删补偿层"**）

**先纠正一个错误表述**：本节此前写作"整体删除 Datalog 补偿层"，暗示该层是旁挂的补丁。
**事实是它就是 `/reason` 的实现本身**：

| 组件                   | 规模 / 作用                                                              |
| ---------------------- | ------------------------------------------------------------------------ |
| `routes/reason.py`     | **541 行**端点：`DatalogReasoner` + `derive_all()` 不动点 + 截止时间传递 |
| `provenance_bridge.py` | 由 `DatalogReasoner.query` 恢复前提（`premise`）                         |
| `reasoning_limits.py`  | 事实预算、`check_declared_sizes`                                         |
| `rules/rules.py`       | 规则库装载 + 词表校验                                                    |
| `graph/export.py`      | **781 行**图→事实桥                                                      |
| 依赖                   | `semantica[..., tripletstore-oxigraph]`（`pyoxigraph` 已安装）           |

**且该引擎是通用的，不局限于三条随附规则**：`ReasonRequest.rules` 接受调用方传入的
**最多 100 条**规则（`routes/schemas.py` 的 `RuleSpec`），`rules.py` 对任意装载的规则库做词表校验。
三条随附规则只是随附，不是引擎的能力边界。

**因此这是一次引擎替换，不是删除。** 代价必须写明：

| 失去的                    | 说明                                                                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **规则即数据的设计**      | `rules.yaml` 头注释：_"Letting a request carry arbitrary Datalog would mean the conclusion a user sees depends on text nobody reviewed"_ —— 规则退化为**代码**，改规则从改配置变成改代码+发版 |
| **请求侧自定义规则**      | `ReasonRequest.rules` 失去后端；保留则须自建等价校验，删除则是 **breaking change**（P4 必须明确二选一）                                                                                       |
| **通用推理能力**          | 引擎能跑任意受审阅规则，Cypher 只能跑硬编码的那几条                                                                                                                                           |
| **现成的 `premise` 恢复** | `provenance_bridge.py` 的机制须为每条 Cypher 重新推导                                                                                                                                         |

**换来的**：单引擎、单方言；不等式由 `WHERE a <> b` 原生生效，不依赖外部引擎的语义正确性。

三条随附规则的翻译本身是直接的：

| Datalog 规则                                                        | 等价 Cypher                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `potential_ddi(A,B) :- inhibits(A,E), substrate_of(B,E), A!=B`      | `MATCH (a)-[:INHIBITS]->(e)<-[:SUBSTRATE_OF]-(b) WHERE a<>b`     |
| `shares_target(A,B) :- acts_on(A,T), acts_on(B,T), A!=B`            | `MATCH (a)-[:ACTS_ON]->(t)<-[:ACTS_ON]-(b) WHERE a<>b`           |
| `same_atc_class(A,B) :- in_atc_class(A,C), in_atc_class(B,C), A!=B` | `MATCH (a)-[:IN_ATC_CLASS]->(c)<-[:IN_ATC_CLASS]-(b) WHERE a<>b` |

**Datalog 的真实能力**：**递归传递闭包**（"A 经任意长度链条是否可达 B"）它表达更自然。
**当前三条规则一条递归都没有**，故当前用法不吃这个能力。若将来需要，Neo4j 可用
变长路径 / `apoc.path.expandConfig` 覆盖大部分场景（P0 `[待核实]` 边界）。

**决策**：P4 将三条规则译为 Cypher，`/reason` 语义保留，**并在 P4 明确 `ReasonRequest.rules`
的去留**（保留→自建校验；删除→记 breaking change 并同步 Lucent 侧）。Oxigraph 依赖与
图→事实桥删除。**这条不做也可以**——若判定"规则即数据"的价值高于单引擎收益，P4 可整体取消，
只做 P1–P3 的图后端迁移；**该取舍不影响 P1–P3 的收益**。

---

## 四、目标形态

### 4.1 拓扑

```
Lucent (NestJS)  --HTTP-->  semantica-service (FastAPI)  --Bolt-->  neo4j
   SEMANTICA_* 3 个键          4 方法 store 契约          7687 Bolt / 7474 HTTP
                                    │
                                    └── 三条规则改为 Cypher（不再需要 Oxigraph/Datalog）
```

**Lucent 不直连图库**（`env-keys.enum.ts:155` 已声明 DSN 属 sidecar 侧），故拓扑上 Lucent 侧无变化。

### 4.2 资源预算（实测口径）

| 项                          | 值                                              |
| --------------------------- | ----------------------------------------------- |
| 图数据                      | 3,278 节点 / 211,630 边 / **21 种关系**         |
| **Neo4j 空实例（固定）**    | **852.8 MiB**                                   |
| **Neo4j 装载本图**          | **1,243.1 MiB**                                 |
| 数据部分（可调 page cache） | 390 MiB（page cache 上限 256 MiB，超出留磁盘）  |
| **全量外推**                | **~1.6–1.9 GiB，基本恒定**                      |
| 机器余量                    | ~2,000 MiB → **放得下**                         |
| **heap / pagecache 建议**   | heap 512m / pagecache 256m（P0 实测基线，§2.1） |

### 4.3 compose 片段（草案，P6 定稿）

```yaml
services:
  neo4j:
    image: neo4j:5.26-community # [待核实] 钉死具体 tag，勿用浮动
    environment:
      NEO4J_AUTH: neo4j/${NEO4J_PASSWORD:?required}
      # 显式限制，勿依赖默认（默认约 1.5 GiB，会挤占 2c4g 机器）
      NEO4J_server_memory_heap_initial__size: 512m
      NEO4J_server_memory_heap_max__size: 512m
      NEO4J_server_memory_pagecache_size: 256m
      NEO4J_server_memory_recovery__policy: none # 小机器上避免恢复期额外占用
    ports:
      - '127.0.0.1:7687:7687' # Bolt，只绑回环（与 postgres/redis 一致）
      - '127.0.0.1:7474:7474' # HTTP，同上
    volumes:
      - neo4j-data:/data
      - neo4j-logs:/logs
    ulimits:
      nofile: { soft: 65536, hard: 65536 }
    logging:
      driver: json-file
      options: { max-size: '50m', max-file: '5' }
```

**必须钉版本**：Neo4j major 升级有存储格式变更与配置前缀变更；**升级前必做备份**。

**页缓存上限的意义**：pagecache 固定 256m 意味着**数据增长不会线性吃内存**（§2.6），这是选 Neo4j 的核心理由。

---

## 五、落地顺序与验收

| 阶段                                  | 工作量 | 内容                                                                                                                                                                                                                   | 验收                                                                                                                                           |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** 前置核对                       | 0.5 天 | ①抽 3-5 条真实查询实测**语义等价**（重点：`UNWIND`+属性查找、`ORDER BY … LIMIT`）；②钉镜像 tag；③验证 §2.6 内存外推（可选：在 4× 数据上复测）；④**在 AGE 上先建 GIN 索引**（§2.8）作为 A/B 基线                        | 三条查询与 AGE **逐行一致**；镜像 tag 固定；内存实测 RSS                                                                                       |
| **P1** 连接层                         | 1 天   | `config.py` 换 Bolt 配置；删 `pool.py` psycopg2 池；重写 `retry.py` 异常标记；fork 分派切 `neo4j`；处置 `test_pool.py`                                                                                                 | `execute_query`/`get_stats` 单测通过；`/health` 返回图规模；**Neo4j adapter 无需自写**                                                         |
| **P2** 数据迁移                       | 1.5 天 | AGE 导出（`scripts/export_subgraph.py` 走 JSONL）→ Neo4j 导入；**批量写入**（`UNWIND`/`apoc.periodic.iterate`）；**保留全部边属性**（§九）；**保留平行边**（AGE 侧实测有 175 组同类型平行边，**禁止用 `MERGE` 压平**） | 图规模 3,278 / 211,630 **一致**；**平行边保留**；边属性无丢失；导入耗时可接受                                                                  |
| **P3** 扫描器拆除 + 只读事务          | 1 天   | §3.3 逐条删除；只读改正则 → `execute_read()`                                                                                                                                                                           | `scripts/check_reason_range.py`/`check_orientation.py` 通过；**`shortestPath`/多类型边/`datetime()` 均可用**                                   |
| **P4** 推理引擎收编（**可独立取消**） | 1 天   | §3.5 三条规则译为 Cypher；`/reason` 语义保留；明确 `ReasonRequest.rules` 去留；删除 Oxigraph 接线                                                                                                                      | 三条规则结果与 Datalog 版**逐行一致**（**自反对须为 0**——fork 已修不等式，故这是回归保护而非修复既有错误）；`ReasonRequest.rules` 已有明确裁决 |
| **P5** 跨仓契约                       | 0.5 天 | §3.4 删除 `AGE_LIMITATIONS` + 错误类别同步 + 3 处注释                                                                                                                                                                  | Lucent `pnpm typecheck`/`lint:check`/`test` 通过；**端到端**问一句需多跳的问题拿到带 `prov` 的行                                               |
| **P6** 部署与验证                     | 1 天   | `compose.staging.yaml` 落地（回环端口、heap/pagecache、日志轮转）；备份流程；跑通 `scripts/check_*.py` 全部                                                                                                            | 三环境 up；备份/恢复演练通过；`semantica-service` 288 测试通过                                                                                 |
| **P7** 文档收口                       | 0.5 天 | 迁移日志；`docs/reference/environment-variables.md`；模块 README；ADR；**删除** `2026-09-27-apache-age-introduction-plan.md` 与本计划（执行完毕即删，见 `plans/README.md`）                                            | `pnpm docs:verify` / `docs:links` 通过                                                                                                         |

**总工作量约 6.5 天**（**比 Memgraph 方案少 0.5 天**：无需自写 adapter，但多一步 Datalog 替换）。

AGE 侧资产**不立即删除**：`docker/postgres-age/` 与 `lucent_graph` database 保留至 P6 验证通过（**回滚路径**）。

---

## 六、回滚

P2–P5 期间 AGE 与新库**并存**，`SEMANTICA_*` 指向可切换：

1. 保持 AGE 图数据不变（不 DROP `lucent_graph`）
2. `SEMANTICA_BASE_URL` 指回旧 sidecar 实例（或 compose profile 切回）
3. 触发回滚的条件：P0 语义等价实测失败 / P3 出现无法在 1 天内定位的结果差异 / P6 生产验证发现静默错算

**AGE 资产在 P6 验证通过并稳定运行一个周期后才清理**，并单独记一条迁移日志。

---

## 七、风险与应对

| #       | 风险                                                      | 概率   | 影响   | 应对                                                                                                                                                      |
| ------- | --------------------------------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | **内存超预算**：默认配置约 1.5 GiB                        | 中     | **高** | P0 显式设 heap 512m / pagecache 256m；上线前观察 RSS；全量前复测                                                                                          |
| **R2**  | **平行边被压平**：Neo4j 的 `MERGE` 会合并同端点同类型的边 | **高** | **高** | P2 **必须用 `CREATE`**；验收做"平行边数 = 175 组"检查（AGE 侧实测值）                                                                                     |
| **R3**  | 语义差异导致**静默错算**（最危险，因"看起来像答案"）      | 中     | **高** | P0 三条查询逐行对账；P3 跑 `check_*.py`；P6 用 `VERIFICATION-SCALE.md` 的六探测复测（AGE 基线：6/6 通过、21 ms–1,895 ms）                                 |
| **R4**  | P4 引擎收编引入差异或丢失通用性                           | 中     | **高** | 与 Datalog 版**逐行对账**（自反对为 0 是回归保护，fork 已修不等式）；**先明确 `ReasonRequest.rules` 去留**；若判定通用性不可放弃，P4 整体取消，只做 P1–P3 |
| **R5**  | 只读守卫从正则改为事务后，**意外放行写操作**              | 中     | **高** | 迁移期**双保险**：正则白名单保留（第一道）+ `execute_read()`（第二道）；`check_read_only` 的 16 个单测保留                                                |
| **R6**  | **GPLv3 许可**在对外交付时触发义务                        | 低     | 中     | 当前内网自用 + HTTP 进程边界，不触发；**产品化前须法务评估**（§2.3）                                                                                      |
| **R7**  | `get_stats()` 全表计数在 21 万边下慢                      | 中     | 中     | P1 实测耗时；必要时改为维护计数                                                                                                                           |
| **R8**  | 写入批量吞吐不足（AGE 侧实测仅 ~107 边/s）                | 中     | 中     | P2 用 `UNWIND`/`apoc.periodic.iterate`；**实测导入耗时**                                                                                                  |
| **R9**  | `$param` 不可用于动态 label/属性名                        | 中     | 中     | P0 确认 `export.py` 的动态 label 拼接路径                                                                                                                 |
| **R10** | Neo4j 升级有存储格式/配置前缀变更                         | 中     | 中     | **钉死一个版本**；升级前必做备份与恢复演练                                                                                                                |

---

## 八、待确认（阻塞 P1）

1. **`[待核实]`** 钉哪个 Neo4j 镜像 tag（Community vs Enterprise），勿用浮动 tag。
2. **`[待核实]`** `$param` 不能用于动态 label 的边界，是否影响 `export.py` 的拼接路径。
3. **`[待核实]`** 全量内存外推（§2.6 到 4× 实测 1,605.6 MiB → 全量 ~1.6–1.9 GiB）是否需要在更大规模上复测。
4. **Datalog 递归能力**：改写为 Cypher 后，将来若需"任意长度传递闭包"的规则，Neo4j 的表达能力边界需实测。
5. **P2 导入必须保留全部边属性**（见 §九）**与平行边**（175 组，见 R2）。
6. **`unsupported_feature` 错误类别的去留**：扫描器拆除后该类已无触发路径，需决定保留（向后兼容）还是删除（两侧同步）。

**已解决，不再阻塞**：~~AGE 的索引修复路径~~（§2.8 已实测，35×，但不解决能力缺口）；~~Prometheus 指标~~；~~审计~~；~~Neo4j 内存 2.5 GiB~~（那是 heap 2g 的**配置**结果；同图换 512m 实测 **1,243 MiB**）。

---

## 九、必须逐字保留的图数据（实测，**易漏项**）

迁移时若只搬"看得见"的属性，会**静默丢数据**。以下为实测的完整分布。

### 9.1 边属性：**三种组合，不是两种**（`[核实]` 实测）

| 边类型                                                        | 条数        | 属性键                                          |
| ------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| `INTERACTS_WITH`                                              | 200,182     | `prov`, `description`                           |
| **19 个 drug→protein 关系**（`ACTS_ON`/`INHIBITS`/`BINDS`/…） | **8,805**   | `prov`, **`known_action`**, **`relation_kind`** |
| `SUBCLASS_OF` + `IN_ATC_CLASS`                                | 2,643       | `prov`                                          |
| **合计**                                                      | **211,630** | ✅ 与总数一致                                   |

**风险**：若按"`prov` + `description`"迁移，会丢掉 **`known_action` 与 `relation_kind` 共 17,610 个属性值**。这两个字段承载"药物**如何**作用于靶点"的语义（激动/抑制/底物/拮抗），对相互作用推理是**关键内容**。

**实测校验**：`known_action IS NOT NULL` 的边数 = **8,805**，与上表第二行**精确吻合**。

### 9.2 `prov` 完整性

`prov IS NULL` 的边数 = **0 / 211,630**（`[核实]` 实测）。溯源链完整，迁移后必须保持。

### 9.3 节点属性：Drug **不齐整**（`[核实]` 实测）

| 标签     | 属性数 | 节点数 |
| -------- | ------ | ------ |
| Drug     | 13     | 887    |
| Drug     | 12     | 2      |
| Drug     | 11     | 6      |
| Protein  | 6      | 916    |
| ATCClass | 3      | 1,467  |

缺失字段：`unii` 缺 **8** 个、`drug_type` 缺 **6** 个。

**处置**：导入用 `SET n = p`（整体赋值），可**原样保留**不齐整——**不要**为缺失字段补空串或默认值，那会改变语义。

### 9.4 属性值形态陷阱

`groups` / `synonyms` / `categories` 等**存的是 JSON 字符串**，不是列表，例如字面量：

```
[\"approved\", \"investigational\"]
```

**必须按字符串原样搬运**，不要解析成列表——AGE 侧是字符串，解析会改变下游比较语义（`export.py` 与 PROMPT 都按字符串处理）。

### 9.5 标签与关系类型清单

- 节点标签 **3**：`Drug`(895) / `Protein`(916) / `ATCClass`(1,467)
- 关系类型 **21**；`INTERACTS_WITH` 占 200,182（94.6%）
- AGE 目录中另有 `Probe` 标签与 `LINKS`/`LINKS2`/`LINKS3`/`LINKS4`/`TARGETS` 等关系**仅存在于表结构、实际数据为空** —— 迁移**不要**创建这些空壳。

### 9.6 ⚠️ 平行边：**必须用 `CREATE`，禁止 `MERGE`**（2026-09-29 新实测）

`[核实]` 重新导入时实测：图中有 **175 组同类型平行边**（相同起点、终点、关系类型，但 `prov` 不同）。

**这些边承载不同的 provenance，语义上不是同一条边。** 例如：

```
ACTS_ON   DB00415 → Q16348   prov=.../all/ACTS_ON
ACTS_ON   DB00415 → Q16348   prov=.../target/ACTS_ON     <-- 平行边
INHIBITS  DB00493 → Q16348   prov=.../target/INHIBITS
INHIBITS  DB00493 → Q16348   prov=.../transporter/INHIBITS  <-- 平行边
```

**Neo4j 的 `MERGE` 会静默合并它们，丢失其中一条。** 这是**静默丢数据**，与 §9.1 同级风险。

**导入验收必须检查**：同类型平行边组数 = **175**。

> 注：若按"任意类型、相同端点"统计则为 **2,866** 组（含跨类型），这是不同口径，验收时勿混淆。

---

## 十、本计划保留的实测资产索引

以下实测结果不随结论变更而失效，供后续复用：

| 资产                   | 位置 / 值                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| AGE 图基线             | 3,278 节点 / 211,630 边 / 21 类型 / 175 组平行边 / `prov IS NULL`=0    |
| AGE GIN 索引提升       | **35×**（4.960 ms → 0.142 ms），成本 696 kB（§2.8）                    |
| AGE 变长路径爆炸       | 无向 `*1..3` 在 20 万边上 **12 分钟未完成**（§〇quater）               |
| Neo4j 内存曲线         | 空 852.8 → 1×1,243.1 → 2×1,461.2 → 3×1,537.0 → 4×1,605.6 MiB（§2.6）   |
| Memgraph 内存          | 装载全图 171 MiB；官方空实例基线 75 MiB（§2.1）                        |
| RyuGraph 内存          | 读全图 101.8–135.6 MiB，磁盘 123.57 MiB（§2.5）                        |
| AGE 容器真实占用       | 161.9 MiB（含业务库 2.6 GB）；`lucent_graph` 134 MB（§2.7）            |
| **232 题真实执行基线** | 29 题 × 2 条件 × 2 模型 × 2 轮，真实 LLM 输出 → 真实 AGE 执行（§十一） |

---

## 十一、232 题 AGE 执行基线（**本计划的重要旁证**）

2026-09-29 完成：把 232 条真实 LLM 生成的 Cypher 全部对**真实 AGE 实例**执行，得到执行级（非静态）证据。

### 11.1 结果

| 模型                | 条件                                 | 通过    | 失败   | 通过率    |
| ------------------- | ------------------------------------ | ------- | ------ | --------- |
| qwen3.8-max         | A_blind（不告知 AGE 限制）           | 52      | 6      | 89.7%     |
| qwen3.8-max         | **B_fixed**（告知限制 + 可复制模板） | **56**  | **2**  | **96.6%** |
| deepseek-v4.1-flash | A_blind                              | 50      | 8      | 86.2%     |
| deepseek-v4.1-flash | B_fixed                              | 47      | 11     | 81.0%     |
| **合计**            |                                      | **205** | **27** | **88.4%** |

### 11.2 失败原因（全部为 AGE 能力缺陷）

| 原因                                        | qwen A / B | deepseek A / B |
| ------------------------------------------- | ---------- | -------------- |
| **`shortestPath` 不支持**                   | 6 / 0      | 4 / 0          |
| **多类型边 `[r:A\|B]`**                     | 0 / 0      | 2 / 3          |
| **变长路径超时**（45s `statement_timeout`） | 0 / 0      | 0 / 5          |
| **`[rel IN r \| rel.prov]` 属性访问失败**   | 0 / 2      | 0 / 0          |
| 模型自身语法错误                            | 0 / 0      | 1 / 1          |
| 未定义标识符                                | 0 / 0      | 1 / 0          |

**零行返回 = 0 / 205**：无静默漏数。

### 11.3 提示词修复有效（执行验证）

| 指标                                            | 修复前   | 修复后  |
| ----------------------------------------------- | -------- | ------- |
| `shortestPath`（最短路径题 Q24/Q25/Q27）—— qwen | 6/8 写入 | **0/8** |
| `shortestPath` —— deepseek                      | 4/8 写入 | **0/8** |

**但 deepseek 出现了新的失败模式**：`shortestPath` 被禁后改用无向变长路径 `*1..3`，触发**超时**（5 例）。

**这正是 §〇bis 教训二的直接体现**：提示词能教会模型"别用这个语法"，但**教不会它 AGE 没有的能力**。禁掉 `shortestPath` 之后，模型只能退回到手写变长路径 —— 而那是 AGE 上同样跑不动的东西。

### 11.4 本测试自身的两个缺陷（已修正，如实记录）

1. **提词器缺陷**：v1 检测器把 `-[r1]->`（无类型但**已绑定**）误判为未绑定别名 → 虚高"31%"，真实约 **19%**。修正后：**22.6% → 0%**。
2. **提取器缺陷**：未剥离 `-- Rationale:` 注释，导致 **3 条** qwen 输出被误判为语法错误。修正后 qwen B_fixed 从 93.1% → **96.6%**（**数据为重跑结果，非改分**）。

> **教训**：测量工具本身的缺陷会伪装成被测对象的缺陷。**每次调整评分器后，必须重跑而非重算。**

### 11.5 本测试不能证明什么（**重要限定**）

- 232 题是**合成题集**，不是真实用户查询分布；**不能**据此推断"生产需要多跳"。
- **反过来说也成立**：**不能**因为 `range.py` 里没有多跳，就推断"生产不需要多跳" —— 多跳在 Datalog 层（§〇bis 教训二）。
- 该测试的**有效结论只有两条**：①提示词修复有效；②AGE 的多跳能力确实不可用。
