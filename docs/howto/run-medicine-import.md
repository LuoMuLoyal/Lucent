---
status: active
owner: backend
quadrant: howto
updated: 2026-09-17
---

# How-To: 运行药品数据导入

## 前置

- 本地 Docker stack 已运行（`pnpm dev:stack`，需 PostgreSQL 18）
- 数据库已迁移（`pnpm db:migrate`）
- 数据集文件已准备在 `DrugDataBase/` 目录下（V3 去重产物在 `DrugDataBase/DrugEntityDedup/`）
- 阅读 `src/modules/medicines/README.md` 了解导入策略与数据语义

## 可用导入命令

```bash
cd Lucent

# 查看 package.json 中的全部 import:* 脚本
pnpm run | grep import:
```

**全部导入**（推荐，一次跑完所有数据源）：

```bash
pnpm import:medicine:all
```

默认顺序：`drugbank-drugs` → `drugbank-links` → `drugbank-targets-all` → `drugbank-targets-active` → `drugbank-target-proteins` → `drugbank-target-genes` → `drugbank-drug-sequences` → `drugbank-structures` → `cn-v3-leaflets` → `cn-v3-products` → `cn-v3-product-leaflet-links`。

**按数据源分跑**（用 `--command` 指定）：

| 数据源               | 命令                                                                                       | 说明                                        |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 中国药品/说明书/链接 | `--command cn-v3-products` / `cn-v3-leaflets` / `cn-v3-product-leaflet-links`              | V3 去重 Parquet，产品纯目录、正文在说明书表 |
| DrugBank 药品        | `--command drugbank-drugs`                                                                 | XML 全量解析，含靶点 XML 动作富化           |
| DrugBank 外部链接    | `--command drugbank-links`                                                                 | drug links.csv                              |
| DrugBank 靶点        | `--command drugbank-targets-all` / `drugbank-targets-active`                               | all.csv / pharmacologically_active.csv      |
| DrugBank 序列        | `--command drugbank-target-proteins` / `drugbank-target-genes` / `drugbank-drug-sequences` | FASTA 文件                                  |
| DrugBank 结构描述符  | `--command drugbank-structures`                                                            | structures.sdf                              |

可用命令完整列表见 `import-medicine-knowledge.ts` 的 `COMMANDS` 注册表。

**可选参数**：

- `--source <path>` — 覆盖默认数据文件路径
- `--limit <n>` — 只导入前 N 条（冒烟测试用）
- `--batch-size <n>` — 每批 upsert 行数，默认 100

## 验证

```bash
# 检查导入行数（dev 库）
psql -h 127.0.0.1 -p 15432 -U postgres -d lucent -c \
  "SELECT 'cn_products' AS t, count(*) FROM cn_medicine_products
   UNION ALL SELECT 'cn_leaflets', count(*) FROM cn_medicine_leaflets
   UNION ALL SELECT 'cn_links', count(*) FROM cn_medicine_product_leaflet_links
   UNION ALL SELECT 'drugbank', count(*) FROM drugbank_drugs
   UNION ALL SELECT 'drugbank_targets', count(*) FROM drugbank_targets
   UNION ALL SELECT 'drugbank_structures', count(*) FROM drugbank_structures;"
```

## 导入后建立检索索引

中文散文（说明书字段 / 医学问答）的检索索引由 LightRAG sidecar 承担，先起
sidecar 再灌：

```bash
# 1. 起 sidecar（dev 放在 profile 里，默认不启动）
docker compose -f compose.dev.yaml --profile lightrag up -d lightrag

# 2. 把 chunk 表推进 LightRAG（含中文说明书字段级切分）
pnpm import:lightrag --workspace=leaflet

# 3. 医学问答语料（先写 chunk 表，再灌）
node scripts/import/medicine/import-medical-qa.ts --filter
pnpm import:lightrag --workspace=qa
```

`--reset` 按稳定 doc id 清空该 workspace 后再灌（幂等）；`--dry-run` 只打印
首个 doc id。灌入的 doc id 段序是跨进程契约（查询侧靠它反解溯源），详见
`src/modules/assistant/README.md`。

英文侧（DrugBank 叙事字段）仍走 Lucent 自己的 pgvector，与 LightRAG 无关：

```bash
# DrugBank 叙事字段向量索引（chunk + embed 两阶段）
node scripts/import/medicine/rebuild-drugbank-rag-index.ts --embed
```

> `rebuild-leaflet-index.ts` 现在**只重建 chunk 表**（`medicine_leaflet_chunks`），
> 那是 LightRAG 灌入的事实源；它不再建 `leaflet_embeddings`，该表及其调用已随
> LightRAG 落地删除。同理 `import-medical-qa.ts` 只保留 `--filter` 阶段。

## 注意事项

- DrugBank `full_database.xml` 约 1.9 GB，导入耗时较长，建议在后台运行
- 导入脚本的 env 文件解析顺序与运行时一致：`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>`
- 如导入中断，重跑脚本即可（upsert 语义，不会产生重复行）
- 导入后行数与时间戳以导入脚本输出为准；`docs/archive/01-reference/contracts/data-sources.md` 为只进不出的归档快照，
  不再随导入更新
