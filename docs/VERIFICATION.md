# Semantica Service — 验证报告

**日期**：2026-09-19
**范围**：英文侧 OAG sidecar（`semantica-service/`）骨架、AGE 镜像、`/reason` `/schema` `/validate` 端点
**结论**：本地链路已跑通；**0 回归**；可进入 Lucent 集成

---

## 1. 摘要

| 项 | 结果 |
| --- | --- |
| 本仓测试 | **61 passed / 0 failed** |
| fork 回归对照 | **新增失败 0**，消失 1（已知 flaky） |
| 端到端（真实 AGE） | **14/14 通过** |
| 静态门禁 | ruff / ruff format / mypy(strict) 全通过 |
| AGE 版本 | **1.7.0**（避开 #2500 SIGSEGV） |

---

## 2. 端到端验证（真实环境，非桩）

dev 栈：`lucent-postgres-dev` 容器（`lucent-db:18`），database `lucent_graph`，
样本图 **6 节点 / 5 边**。

| 检查 | 结果 |
| --- | --- |
| `GET /health` → 200 且图非空 | ✅ |
| `GET /schema` 列出 Drug/Protein 与两类边 | ✅ |
| `POST /reason` 在**真实图**上推出共享靶点 | ✅ |
| 推理结果**无自反冲突**（`X != Y` 生效） | ✅ |
| `POST /validate` 检出缺 name 的 Protein | ✅ |
| 满足约束的 shape 判定为 conforms | ✅ |
| 空事实集 → 422 | ✅ |
| 同时给 shacl+ontology → 422 | ✅ |

### 真实推理输出（节选）

```json
{
  "fact_count": 13,
  "derived": [
    "drug(db00682)", "drug(db00945)", "drug(db01050)",
    "protein(p00734)", "protein(p23219)", "protein(p99999)",
    "interacts_with(db00945, db00682)", "interacts_with(db01050, db00682)",
    "targets(db00682, p00734)", "targets(db00945, p23219)", "targets(db01050, p23219)",
    "shares_target(db00945, db01050)", "shares_target(db01050, db00945)"
  ],
  "bindings": [{ "Y": "db01050" }]
}
```

**13 条事实 = 6 节点 + 5 边 + 2 条推理得出**。后两条 `shares_target` **图中并未显式存储** ——
阿司匹林（DB00945）与布洛芬（DB01050）共享靶点 COX-1（P23219），这正是 OAG 的价值所在。

---

## 3. fork 回归对照

用 `git worktree` 建基线副本（`de2e200e`，修复前）与当前 HEAD（`42519e65`）对比，
同一 Python 环境、同一排除集（`integration` / `integrations` / `explorer`，缺可选依赖）。

| | 基线 `de2e200e` | 当前 `42519e65` |
| --- | --- | --- |
| failed | 61 | 60 |
| passed | 7067 | 7119 |

**逐条集合比对**：

- **新增失败：0** ← 无回归
- 消失失败：1 —— `tests/export/test_jsonld_document_iri.py::test_exported_at_still_varies_between_exports`

### 那 1 个差异是预存在的 flaky 测试

该测试断言两次导出的**微秒级时间戳**不同，同一微秒内会碰撞。
在当前 HEAD 上**连跑 10 次，失败 7 次**：

```
10 次中失败 7 次
```

即它的通过与否**与代码改动无关**，纯属时序巧合。基线运行恰好通过、本次运行恰好失败，
才造成 61 vs 60 的表象。**非我方引入，未修改。**

其余 60 个失败全部为既有失败（`vector_store` / `llm_*` / `qdrant` 等缺可选依赖），
与基线**完全一致**。

---

## 4. 本仓测试分布

```
tests/test_endpoints.py  ................  16   /schema /validate /reason 与错误处理
tests/test_export.py     ......................  22  AGE → semantica 桥接与 Turtle 序列化
tests/test_health.py     .....             5   /health 探针
tests/test_pool.py       ..................  18  连接池与时长解析
                                         ─────
                                          61
```

设计取舍：**测试套件全部用桩，不依赖数据库**，故可在任何环境运行；
真实数据库验证走 `scripts/check_e2e.py`（手动执行，见 §2）。

---

## 5. 期间发现并修复的缺陷

均为本次工作引入或暴露，已逐个提交：

| # | 缺陷 | 后果 | 发现方式 |
| --- | --- | --- | --- |
| 1 | `statement_timeout` 经 `connect(**options)` 传入被**静默忽略** | 超时形同虚设 | 读上游源码发现该参数未使用 |
| 2 | `statement_timeout` 是服务端 GUC，**不能作为 libpq 选项** | DSN 解析失败 | 真实启动时 `invalid dsn` |
| 3 | DSN 中 `options` 值含空格**未加引号** | libpq 拒绝整个 DSN | 同上 |
| 4 | 超时校验按字符串比较，PG 把 `15000ms` 显示为 `15s` | **配置正确却拒绝启动** | `/health` 返回 503 |
| 5 | 默认 AGE 端口凭印象填成 15433（实际 15432） | 连不上 dev | 自检脚本连不上 |
| 6 | 导出用 AGE **行 id** 作事实常量 | 推理结果退化为 `844424930131970` | 端到端测试失败 |
| 7 | 边导出 dict **重复 `target` 键** | 后写的 `str(target)` 覆盖已解析值，边连不上节点 | 单元测试捕获 |
| 8 | 镜像 Dockerfile 误放 `semantica-service/` | Lucent 部署被迫依赖该仓 | 架构评审 |

第 4 与第 7 项值得单独一提：**都是"看起来对但其实错"的静默缺陷** ——
前者让服务拒绝启动（还好是响亮的失败），后者是 Python 允许重复字典键、
不报错也不警告，静默用错值。若无测试与真实环境验证，两者都极易漏过。

---

## 6. 尚未验证 / 已知限制

诚实列出，避免误判完成度：

- **未在 Lucent 侧集成**：`reason_over_ontology` 工具未实现，Lucent 尚不能调用本服务。
- **未部署**：`semantica-service` 未进 compose；sidecar 部署位置（同栈 or 独立）未定。
- **样本图非真实数据**：6 节点是手工构造的 DrugBank 形状样本，**尚未灌入真实 DrugBank 数据**。
- **`load_from_graph` 一次导出全图**：受 `limit` 约束（默认 1000），大图下的性能与内存未测。
- **无并发压测**：连接池逻辑有单元测试覆盖，但真实 AGE 下的并发表现未测。
- **`/validate` 的 SHACL 来自调用方**：本服务不自带本体，shape 需 Lucent 提供。
- **AGE 的 4 项 Cypher 子集限制**仍存在（如多标签匹配 `(n:A|B)` 不支持，灌数据时已踩到）。

---

## 7. 复现方式

```bash
# 1) AGE 数据库
docker build -t lucent-db:18 Lucent/docker/postgres-age
cd Lucent && docker compose -f compose.dev.yaml up -d postgres-dev
docker exec lucent-postgres-dev psql -U postgres -c "CREATE DATABASE lucent_graph;"
docker exec lucent-postgres-dev psql -U postgres -d lucent_graph -c "CREATE EXTENSION IF NOT EXISTS age;"

# 2) 服务与测试
cd semantica-service
uv sync
uv run pytest                    # 61 passed
uv run python scripts/load_sample_graph.py   # 灌样本图
uv run uvicorn semantica_service.main:app --port 8099 &
uv run python scripts/check_e2e.py           # 14/14
```
