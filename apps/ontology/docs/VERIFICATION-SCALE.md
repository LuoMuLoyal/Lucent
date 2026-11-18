# 扩量验证：OAG 中规模实测（895 药 / 21 万边）

> **历史文件（2026-09-19 的快照）。** 数字取自当时的 AGE 部署，其中**关系类型
> 一项已过时**（原文 26 种；实测为 **21 种**，见下）。图后端已于 2026-09-30
> 迁移到 Neo4j，本文描述的操作路径（AGE 导出 / `load_graph.py`）**已不存在**：
> 取代它的是 `scripts/load_graph_neo4j.py`，其生成器
> `scripts/write_verification_scale.py` 已随 AGE 适配器一并删除。**本文只作为
> 当时判断的留档，不应作为当前规模或操作依据。** 当前图规模与连接自检见
> `scripts/check_graph_connection.py`。

> 原注：由 `scripts/write_verification_scale.py` 生成，数字取自**当前运行中的**
> `semantica-service` 与 `lucent-postgres-dev` 上的真实数据。
> 试点（`semantica-oag-pilot`）仅作可行性判断，结论不沿用，以本文实测为准。

## 1. 图规模

| 项 | 值 |
| --- | --- |
| 节点 | 3278 |
| 边 | 211630 |
| Drug | 895 |
| Protein | 916 |
| ATCClass | 1467 |
| 关系类型 | ~~26 种~~ → **21 种**（Neo4j 迁移时实测订正） |

选材口径：20 个 ATC 四位数类目（N06A/N05A/N03A/M01A/C10A/J01C/L01X/L04A…）
并集 12 个锚点药，取诱导子图。相对试点的 86 药 / 6784 边，边数扩大约 31×。

## 2. 建图：确定性 schema 映射，零 LLM

**导入全程不调用模型。** DrugBank 的 `drugbank_drug_targets.actions` 已是结构化
字段，导入只做查表：`(relation_kind, action) → 边类型`。没有抽取，也就没有抽取误差，
token 消耗为 0。这与试点 `ontology_map.py` 是同一条路子。

```
lucent 源表 --(只读 SELECT)--> JSONL --(查表 + UNWIND)--> Neo4j
        export_subgraph.py          load_graph_neo4j.py / ACTION_EDGE
```

映射键是**二维**的：同一个动词在不同 relation_kind 下含义不同。
`substrate` 对 enzyme 是 `SUBSTRATE_OF`，但对 **carrier** 并不表示「被它代谢」；
只按动词查表会把这句话默默写成事实。实测被这个错误影响的正是 carrier 行。

覆盖度（实测）：源表观测到 56 个 `(relation_kind, action)` 组合，
**5052/5073 行（99.6%）命中 ACTION_EDGE**，其余 0.4% 走 relation_kind 兜底，
且兜底是**按类型**的（enzyme → `ENZYME_LINKED_TO`，不再一律塌进 `TARGETS`）。

| 项 | 值 |
| --- | --- |
| 总耗时 | 1848 s（约 31 分钟，全量建图） |
| 吞吐 | 约 114 边/秒 |
| 失败数 | 0 |
| 靶点边关系类型 | 18 种（修复前仅 14 种，其余塌进 `TARGETS`） |

试点的 45 边/秒是**逐条 `create_relationship()`** 的往返开销；本脚本改为每批
2000 行一条 `UNWIND`，在真实 amd64 主机上得到 114 边/秒。批量写入确有收益，
但**没有试点在模拟环境下报出的 1571 边/秒那么高** —— 那个数字不可作容量规划依据。

## 3. 显示名问题（本次新增能力的实测）

### 3.1 名称唯一性：drug 唯一，target **不**唯一

| 实体 | 总行数 | 不同名称 | 结论 |
| --- | --- | --- | --- |
| `drugbank_drugs` | 19842 | 19842 | **名称唯一**，0 组冲突（大小写折叠后仍为 0） |
| `drugbank_targets` | 5096 | 4563 | **有 25 组重名** |

靶点重名的典型例子（全库）：`Genome polyprotein` ×33、`Beta-lactamase` ×17、
`Peptide deformylase` ×13 —— 差异在**物种/毒株**，不在名称。
此外有 18 个靶点名与药物名相同（跨类型撞名）。

**所以「用 name 当 Datalog 常量」不成立**：靶点侧会直接把不同蛋白合并成一个常量。
键用标识符（`DB00945` / `P23219`），名另附一张表 —— 这是本次实现的选择。

### 3.2 标签表实测

| 项 | 值 |
| --- | --- |
| `/reason` 派生事实总数 | 23523 |
| 其中 `shares_enzyme` | 280 |
| 标签表条目 | 3278 |
| 无法解析成名的派生项 | 0 |
| `/reason` 端到端耗时 | 1479 ms |

派生事实 → 名称（实际输出）：

```
shares_enzyme(db00091, db00176)  ->  Cyclosporine × Fluvoxamine
shares_enzyme(db00091, db00188)  ->  Cyclosporine × Bortezomib
shares_enzyme(db00091, db00193)  ->  Cyclosporine × Tramadol
shares_enzyme(db00091, db00203)  ->  Cyclosporine × Sildenafil
shares_enzyme(db00091, db00208)  ->  Cyclosporine × Ticlopidine
shares_enzyme(db00091, db00216)  ->  Cyclosporine × Eletriptan
```

结论：**辅助/用户侧拿得到名称，不必自己反查 ID**。

### 3.3 修复的一个静默缺陷

节点查询与边查询各自使用同一个 `limit` 但**互相独立**，因此边可以指向节点查询
未取到的节点。该端点仍会成为 Datalog 常量，而标签表里没有它 —— 事实看起来
「有名字」，实际是 ID。实测在 `limit=1000` 时标签数由 1000 提升到 1013，即
13 个此类端点原先无名。已修（`fix(graph): 标签表补齐边端点并回退到分类编码`）。

## 4. 与 Lucent 现有检索路径的对比

### 4.1 Lucent 侧现状（同一数据库实测）

| 工具 | 可用性 |
| --- | --- |
| `resolve_drugbank` | 可用（Prisma，`name/casNumber/unii/searchText` 的 `contains`，上限 5 行） |
| `get_drugbank_detail` | 可用（单行） |
| `search_drugbank` | **不可用** —— `drugbank_passage_embeddings` 表不存在（0 张） |

`drugbank_passage_chunks` 为 0 行。也就是说当前 dev 库上，向量检索这条线**没有数据**，
`search_drugbank` 只会返回 `not configured` 的空 envelope。

`resolve_drugbank` 的输入契约是**裸实体名**（工具描述：*Resolve a drug
name*），用 `contains` 匹配。实测按契约输入正常：`Paroxetine` → 1 行、
`Tramadol` → 1 行。整句输入（`Can Paroxetine and Tramadol be taken together`）
返回 0 行 —— 这是**输入越界**，不是缺陷；它也说明该工具不做自然语言解析，
实体抽取由模型侧完成。

### 4.2 与中文侧的关系：按语言分工，本层不做桥接

**英文 OAG 不承担跨语言桥接。这是既定决策，不是本层的缺口。**

- `docs/reference/adr/0008-no-cn-drugbank-medicine-mapping.md`（accepted，
  标注不可逆）：不维护 CN↔DrugBank 映射，`drugbank_ids` 字段已删除。
  理由：医药映射容错率为零、无专业药学人力、模糊匹配假阳性不可接受。
- `plans/2026-09-17-semantica-oag-english-side-plan.md` §2 按语言分工；
  §4.4「**英文 OAG 不依赖它** —— 英文用户查英文药，DrugBank 自身足够」；
  §8.2 中英映射不在该计划路径内、也不构成其依赖。
- `plans/2026-08-28-medicine-risk-graph-plan.md` §6.9 源层共享、物化隔离。

因此本节**不做**「中文问题打英文链路」的对照 —— 那是越出 §2 边界的提问，
测出的「不通」是设计如此。中文侧走 LightRAG，与本层无依赖。

本层接口边界相应收敛为：**只接受英文药物实体**（`Paroxetine` / `DB00715`），
`/resolve` 按此设计。中文药名若将来要落到英文图，属 §4.4 的离线数据资产
（且未复核的 `SAME_AS` 边不得进结论层），不在本层实现。

### 4.3 英文侧同类问题的产出差异

问题「Paroxetine 与 Tramadol 能否同服」（英文实体，符合本层边界）：

| 路径 | 产出 |
| --- | --- |
| OAG 一句 Cypher | 直接返回 1 条带原文描述的相互作用 |
| Lucent 现有工具 | 无「两药相互作用」工具；需先 resolve 两次，再把两边 `drug_interactions` 数组拉到模型侧比对 |

问题「与 Paroxetine 共享靶点的其他药物」（英文实体）：

| 路径 | 产出 |
| --- | --- |
| OAG | 按靶点分组的药物集合（如 CYP3A4 上 252 种药） |
| 扁平全文检索 | 8 条**文本相似**的药物，与「共享靶点」无关 |

实测扁平基线给出的是 `Etrolizumab` / `Oteseconazole` / `Lenacapavir` 这类
文本相近但药理无关的结果 —— **这种错误很危险，因为它看起来像答案**。

## 5. 六个类型化多跳探测（`scripts/probe_oag.py`）

| 探测 | 行数 | 耗时（AGE 当时） | 耗时（Neo4j 迁移后复测） |
| --- | --- | --- | --- |
| `cyp_mediated_ddi` | 40 | 485 ms | 144 ms |
| `shared_targets` | 15 | 150 ms | 76 ms |
| `cascade_metabolic_chain`（4 跳） | 25 | 1895 ms | 139 ms |
| `inhibition_plus_interaction` | 20 | 21 ms | 72 ms |
| `serotonergic_overlap` | 30 | 23 ms | 50 ms |
| `atc_class_hub_targets`（层级下钻） | 15 | 29 ms | 81 ms |

2026-09-30 在 Neo4j 5.26.31 上复测：**6/6 通过，行数逐项一致**。
多跳类探测显著变快（4 跳级联 1895 → 139 ms）；单跳类反而略慢，量级在几十毫秒，
属冷启动与驱动开销，不构成回归。注意两列不是同一台机器上的受控对比，
只作数量级参考。

6/6 通过（AGE 与 Neo4j 两次均如此）。修复映射后，探测输出能区分动作粒度（例如同一靶点上
`act_a: ANTAGONIZES` / `act_b: AGONIZES` 分别列出，而非笼统的 `TARGETS`）。
ATC 类的实测结果符合药理：N06A（抗抑郁药）内作用最多的靶点依次是
血清素转运体（26 药）、去甲肾上腺素转运体（23 药）、CYP3A4（21 药）。

## 6. 过程中发现并修复的四个真实缺陷

1. **动作映射丢了一个维度。** 初版 `ACTION_EDGE` 只按 action 查表，但同一个动词
   在不同 `relation_kind` 下含义不同。实测后果：`carrier` 的 `substrate` 被写成
   `SUBSTRATE_OF`（声称载体是某酶底物，语义错误）；`target` 的 `antibody` 未识别，
   40 行退化成笼统的 `TARGETS`；enzyme 的未识别动作也全塌进 `TARGETS`。
   改为 `(relation_kind, action)` 二维键后，靶点边类型由 14 种增至 **18 种**，
   覆盖 99.6% 的源行。修复**不需重灌全图**：只重建 8805 条靶点边，
   20 万条 `INTERACTS_WITH` 未动。

2. **`inhibition_plus_interaction` 耗时 421 秒。**
   机制 2 跳（564 对）与 20 万条 `INTERACTS_WITH` 稠密边做笛卡尔积，
   `LIMIT` 不能阻止连接本身。加 `WITH a,e,b LIMIT 200` 先收窄后连接，
   **421 s → 27 ms（约 1.6 万倍）**。这不是微优化：不加它这个端点在真实图上不可用。

3. **ATC 层级断裂。** ATC 层级不是等长步进：化学物质层是 7 位（`N06AB05`），
   其父层化学亚组是 5 位（`N06AB`）。按「去掉最后一个字符」建层级会让**所有** 7 位
   节点失去父节点（1417 条父子边里错 1126 条），类别查询恒返回 0 行。
   修正后从 `N06A` 可达 57 种药，与源表 `N06A: 57` 完全一致。

4. **导出批次中嵌套 map 被静默字符串化。** 渲染 Cypher 字面量时，dict 落到了
   `str()` 分支，产出 Python repr `{'a': 1}`，AGE 当作**字符串**接受，不报错。
   边属性会静默写入无意义内容。已改为递归渲染。

## 7. 仍未验证 / 未做

- **真实 DrugBank 全量**未灌入：本次是 895 药的诱导子图，非全量 19842 药。
- **英文侧评测集（计划 §8.1 S0）未建**：本次的六个探测是能力探测，
  不是评测集；「是否继续」应由 S0 裁决。
- **Lucent 侧未接线**：`reason_ontology` 工具与四个注册点未做。
- **向量检索线无法验证**：`drugbank_passage_embeddings` 表不存在，
  §4 的扁平基线是全文检索替代，不是向量对照。
- **未部署**：sidecar 未进 compose。
- 试点报告的 1571 边/秒 未复现（本次 114 边/秒）；容量规划不要引用该数字。

**不在本层范围内（非缺口）**：中文侧检索走 LightRAG；中英映射是 §4.4 的
离线数据资产，`ADR-0008` 已决定不维护。二者都不构成英文 OAG 的依赖。
