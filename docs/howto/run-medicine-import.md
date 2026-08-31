---
status: active
owner: backend
quadrant: howto
updated: 2026-08-31
---

# How-To: 运行药品数据导入

## 前置

- 本地 Docker stack 已运行（`pnpm dev:stack`，需 `pgvector/pgvector:pg18`）
- 数据库已迁移（`pnpm db:migrate`）
- 数据集文件已准备在 `DrugDataBase/` 目录下
- 阅读 `docs/archive/01-reference/contracts/data-sources.md` 了解数据源边界与策略（策略现状以
  `src/modules/medicines/README.md` 与导入脚本为准）

## 可用导入命令

```bash
cd Lucent

# 查看 package.json 中的全部 import:* 脚本
pnpm run | grep import:
```

常用导入脚本：

| 数据源          | 命令                           | 说明                            |
| --------------- | ------------------------------ | ------------------------------- |
| 中国药品/说明书 | `pnpm import:cn-products`      | 产品 + 说明书 + 产品-说明书关联 |
| DrugBank        | `pnpm import:drugbank`         | 药品 + 外部链接 + 靶点          |
| 医疗问答        | `pnpm import:medical-qa`       | 安全标签过滤后的问答语料        |
| 食物成分        | `pnpm import:food-composition` | 食物成分表 + 混合菜品模板       |

## 导入后重建 RAG 索引

```bash
pnpm import:rebuild-rag
```

此脚本会重建：

- 中文说明书向量索引
- DrugBank 段落向量索引
- 医疗问答语料向量索引

## 验证

```bash
# 检查导入行数
pnpm prisma:studio  # 打开 Prisma Studio 浏览数据

# 或直接查询
psql -h 127.0.0.1 -p 15432 -U postgres -d lucent -c \
  "SELECT 'cn_products' AS t, count(*) FROM cn_medicine_products
   UNION ALL SELECT 'drugbank', count(*) FROM drugbank_drugs
   UNION ALL SELECT 'medical_qa', count(*) FROM medical_qa_corpus
   UNION ALL SELECT 'food_comp', count(*) FROM food_composition_items;"
```

## 注意事项

- DrugBank `full_database.xml` 约 1.9 GB，导入耗时较长，建议在后台运行
- 导入脚本的 env 文件解析顺序与运行时一致：`.env.<NODE_ENV>.local` → `.env.<NODE_ENV>`
- 如导入中断，重跑脚本即可（upsert 语义，不会产生重复行）
- 导入后行数与时间戳以导入脚本输出为准；`docs/archive/01-reference/contracts/data-sources.md` 为只进不出的归档快照，
  不再随导入更新
