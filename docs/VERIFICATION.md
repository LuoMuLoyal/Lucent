# Semantica Service — 验证报告

**日期**：2026-09-30
**范围**：英文侧 OAG sidecar（`semantica-service/`）由 Apache AGE 迁移至 Neo4j 后的全量验证
**结论**：迁移完成；**0 回归**；图规模与 AGE 基线逐项一致

---

## 1. 摘要

| 项 | 结果 |
| --- | --- |
| 本仓测试 | **291 passed / 0 failed** |
| 静态门禁 | ruff / ruff format / mypy(strict) 全通过 |
| 端到端（真实 Neo4j） | **18/18 通过** |
| 标注端到端（真实 Neo4j） | **18/18 通过** |
| 手工校验脚本 | 9 个可运行脚本全通过（3 个需在服务运行时才有意义） |
| 图后端 | **Neo4j 5.26.31 community**（Bolt 7687） |
| 驱动 | `neo4j` 6.3.1 |

---

## 2. 图规模：与 AGE 基线逐项一致

| 指标 | AGE 基线 | Neo4j 迁移后 |
| --- | --- | --- |
| 节点 | 3,278 | **3,278** |
| 边 | 211,630 | **211,630** |
| 关系类型 | 21 | **21** |
| `prov` 覆盖 | 211,630 / 211,630 | **211,630 / 211,630** |
| 平行边组 | 175 | **175** |

节点构成：Drug 895 / Protein 916 / ATCClass 1,467。

**平行边 175 组完整保留**是关键：导入用 `CREATE` 而非 `MERGE`，因为 `MERGE` 会把
同一对端点的多条平行边合并成一条，静默丢边。AGE 允许平行边，Neo4j 也允许，
但只有 `CREATE` 才复现基线。

主要关系类型：`INTERACTS_WITH` 200,182 · `ACTS_ON` 3,738 · `INHIBITS` 1,809 ·
`SUBCLASS_OF` 1,417 · `IN_ATC_CLASS` 1,226 · `SUBSTRATE_OF` 1,151。

全量导入耗时 **304.6 s**（约 695 边/秒）。

---

## 3. 端到端验证（真实环境，非桩）

dev 栈：`lucent-neo4j` 容器，heap 512m / pagecache 256m，全量 3,278 节点图。

`scripts/check_e2e.py`（18/18）：

| 检查 | 结果 |
| --- | --- |
| `/health` 200 且图非空 | ✅ |
| `/schema` 列出 Drug/Protein 与机制边类型 | ✅ |
| `/reason` 在**真实图**上推出共享靶点 | ✅ |
| 作用域限定在**命名药物**而非其邻居 | ✅ |
| 推理结果**无自反冲突**（不等式生效） | ✅ |
| 每条结论都带前提 `prov` 引用 | ✅ |
| 未知药名被**拒答**而非放大成全图 | ✅ |
| `/validate` 检出违反约束的 shape | ✅ |
| 满足约束的 shape 判定为 conforms | ✅ |
| 旧 `rules` 载荷 → 422 且**点名该字段** | ✅ |
| 同时给 shacl+ontology → 422 | ✅ |

`scripts/check_labels_e2e.py`（18/18）：313 条结论的**每一个标识符都能解析出药名**，
结论全部标记 `verifiable: derived`，且无一自反。

### 规则计数与独立原始写法逐行一致

| 规则 | 结论数 | 独立原始查询 |
| --- | --- | --- |
| `potential_ddi` | 45,858 | 一致 |
| `shares_target` | 76,224 | 一致 |
| `same_atc_class` | 1,026 | 一致 |

三条规则都以 `a <> b` 求值，即**每一对无序对返回两个方向**（`_SHARED_TARGET` 的
docstring 明说"derived pair is symmetric by construction because the rule is evaluated
over every ordering"）。因此对照查询必须同样用 `<>`：先前用 `a < b` 写对照时，
`shares_target` 与 `same_atc_class` 恰好各差一倍（76,224 vs 38,112、1,026 vs 513），
而 `potential_ddi` 因为本就非对称所以对得上 —— 那个差异是**对照查询写错了**，
不是规则算错了。用 `<>` 重测后三者全部逐行一致。

这一点值得写下来，因为"差一倍"看起来像对称性缺陷，实际是测量口径不一致。

### Cypher 能力：迁移**解锁**的部分

| 构造 | AGE | Neo4j |
| --- | --- | --- |
| `shortestPath` | 422 `unsupported_feature` | **200，实测 1 跳** |
| `allShortestPaths` | 422 | 200 |
| `datetime()` | 422 | 200 |
| 多类型边 `[r:A\|B]` | 422 | 200 |
| 写入语句 | 拒绝 | 仍拒绝（`not_read_only`） |
| 语法错误 | 分类 | 仍分类 |

---

## 4. 期间发现并修复的缺陷

| # | 缺陷 | 后果 | 发现方式 |
| --- | --- | --- | --- |
| 1 | `server.memory.recovery_policy` 在 Neo4j 5.26 **不存在**（计划草案有误） | 容器**拒绝启动** | 启动日志 `Unrecognized setting` |
| 2 | 除 `NEO4J_AUTH` 外任何 `NEO4J_` 变量都被当**配置键**解析 | 容器拒绝启动（`server.password`） | 同上 |
| 3 | `/reason` 作用域被解析成**邻居集合** | 只有 26 对的药物返回 **500** 条 | P4 实测（见 §5） |
| 4 | `_PROTEIN_NEIGHBOURS` 把 UniProt id 写进 `drug_keys` | 标识符命名空间混淆 | 同上 |
| 5 | `/reason` 的 `labels`/`node_types` 被**写死为空** | 313 条结论无法把 `DB00682` 转成药名 | 运行 `check_labels_e2e.py` |
| 6 | `graph/retry.py` 迁移时**整体替换**了 transient 标记表 | 丢失 libpq 标记，provenance 掉线从"可重试"变"永久失败" | 运行 `check_transport.py` |

第 5、6 项值得单独一提：**两者都不报错** —— 第 5 项返回结构完好的、但不可用的响应；
第 6 项把可恢复故障静默升级为终态。都被"必须跑真实数据库"的校验脚本捕获，
单元测试全绿时依然存在。第 6 项已补回归测试（`test_retry.py`），
第 5 项已补 3 条回归测试（`test_endpoints.py`）。

### 一个测试**本身**的缺陷

`check_e2e.py` 断言"共享靶点能找到 Ibuprofen（db01050）"、`/schema` 断言标签**恰好等于**
`{"Drug","Protein"}`。前者断言的药物**根本不在这个子图里**（实测 422
`scope_matched_nothing`），后者的相等断言在一个正确的图上会因为**多了一个标签**而变红。
已改为超集断言与真实存在的药物，并补上"未知药名必须拒答"的正向检查。

---

## 5. 作用域缺陷的完整记录

这是本次迁移中唯一一个**改变答案**的缺陷。

**症状**：命名 Warfarin 的 `shared_target` 请求返回 **500** 条结论，而真实答案是 **26** 条。

**成因**（两层，需同时修复才正确）：

1. 命名 Warfarin 解析出 **511** 个 drug key（它的全部交互伙伴）。规则只要求"某个端点在
   这 511 个里"，于是**邻居之间的配对**也被算作结论 —— 而那些配对与 Warfarin 无关。
2. `_collect_neighbours` 把 `_PROTEIN_NEIGHBOURS` 的结果也追加进 `drug_keys`，
   把 UniProt id 混入药物标识符命名空间。

**修复**：作用域只限定在**调用方命名的药物**（`seed_keys`）上，作为**任一**端点匹配；
蛋白 id 改走 `ResolvedScope.protein_keys`。

**实测复核**：shared_target **26** / interaction **313** / atc_class **0**
（Warfarin 本就没有 `IN_ATC_CLASS` 边），全部 `uncited=[]`，与直接写在库上的等价查询一致。

---

## 6. 资源开销

| 项 | 实测 |
| --- | --- |
| 容器 RSS（heap 512m，全量图） | **1,243 MiB** |
| 全量导入 | 304.6 s |
| cyp 介导 DDI，首次请求 | **183.9 ms** |
| cyp 介导 DDI，缓存后 | 29.1 ms |
| 共享靶点，首次请求 | **108.8 ms** |
| 共享靶点，缓存后 | 5.9 ms |

首次/缓存后分开列出，是因为只报其中一个都会误导：冷启动成本是用户第一次请求的真实
体验，而缓存后的数字会让"这个服务有多快"看起来好得多。两者都不是另一个的替代品。

heap / pagecache 的设置**按计划原样生效**；计划中的
`server.memory.recovery_policy` 因不存在已移除，其意图（避免 OOM 后长时间恢复）
由 heap 上限本身承担。

---

## 7. 复现方式

```bash
# 1) Neo4j
docker run -d --name lucent-neo4j \
  -e NEO4J_AUTH=neo4j/neo4jdevpassword \
  -e NEO4J_server_memory_heap_initial__size=512m \
  -e NEO4J_server_memory_heap_max__size=512m \
  -e NEO4J_server_memory_pagecache_size=256m \
  -p 127.0.0.1:7687:7687 -p 127.0.0.1:7474:7474 neo4j:5.26.31-community

# 2) 灌图（JSONL 在 data/，已 gitignore）
cd semantica-service
uv sync
.venv/Scripts/python.exe scripts/load_graph_neo4j.py

# 3) 服务与测试
NEO4J_PASSWORD=neo4jdevpassword .venv/Scripts/python.exe -m pytest   # 291 passed
NEO4J_PASSWORD=neo4jdevpassword .venv/Scripts/python.exe -m uvicorn \
    semantica_service.main:app --port 8099 &
NEO4J_PASSWORD=neo4jdevpassword .venv/Scripts/python.exe scripts/check_e2e.py          # 18/18
NEO4J_PASSWORD=neo4jdevpassword .venv/Scripts/python.exe scripts/check_labels_e2e.py   # 18/18
```

---

## 8. 尚未验证 / 已知限制

诚实列出，避免误判完成度：

- **未部署为镜像**：`semantica-service` 仍是本地进程；三份 compose 已加 Neo4j 服务，
  但 sidecar 自身未进 compose。
- **未做并发压测**：连接池逻辑有单元测试覆盖，真实 Neo4j 下的并发表现未测。
- **`labels` 解析是逐请求的**：只为答案里出现的端点查名，不再导出全图；
  代价是每次 `/reason` 多一次查询（实测毫秒级）。
- **规则不再热更新**：规则即 Cypher 代码，改一条规则需发版。这是"规则即数据"
  设计的有意放弃，代价见 ADR-0022。
- **`unsupported_feature` 不再由任何构造产生**：保留为客户端契约（Lucent 的
  `SEMANTICA_QUERY_ERROR_KINDS` 依赖它），但服务端当前只会在"过程不存在"时发出。
- **AGE 资产保留**：`docker/postgres-age/` 与 `lucent_graph` 未删除，是回滚路径。
