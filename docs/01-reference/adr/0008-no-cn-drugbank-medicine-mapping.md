# ADR-0008: No CN ↔ DrugBank Medicine Cross-Source Mapping

- **Status**: accepted
- **Date**: 2026-07-15
- **Deciders**: LuoMuLoyal

## Context

Lucent 药品知识库有两个独立数据源：

- **CN 药品**（`cn_medicine_products`）：来自国产药品数据，包含批准文号、说明书等中文字段
- **DrugBank 药品**（`drugbank_drugs`）：来自 DrugBank XML，包含英文药理、相互作用等结构化字段

`cn_medicine_products` 表中曾保留 `drugbank_ids`（JSONB）字段，意图作为 CN→DrugBank 的运行时桥接，用于交互检查和跨源去重。但该字段在本地 V2 数据中 0 行有值，从未被任何运行时代码用于实际交互检查或去重逻辑。

此前尝试过建立 CN↔DrugBank 映射关系，但遇到以下困难：

- **准确性要求极高**：医药领域映射错误可能导致用药安全事故，容错率为零
- **维护成本不可控**：两个数据源独立更新，映射关系需要持续人工维护
- **没有专业药学人力**：团队没有药师/药学专家审核映射准确性
- **LLM 已能自主跨源检索**：assistant 工具链已提供 `search_cn_medicine_products`、`get_cn_medicine_detail`、`resolve_drugbank_entity`、`get_drugbank_detail` 等工具，LLM 可自主决定是否需要跨源查询

## Decision

**不维护 CN↔DrugBank 药品映射关系。**

具体措施：

1. 删除 `cn_medicine_products.drugbank_ids` 数据库字段
2. 删除 `CnMedicineDetailDto.drugbankIds` DTO 字段
3. 删除 `CnMedicinesService.parseDrugbankIds()` 方法
4. 删除 CN 产品导入脚本中的 `drugbank_ids` 列
5. 跨源药品查询由 LLM 自主通过工具链完成，不依赖预建映射表

## Options Considered

| Option                          | Pros                                             | Cons                                                   |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| **不维护映射（本 ADR）**        | 零维护成本；无映射错误风险；LLM 已能自主跨源检索 | LLM 跨源检索结果不如预建映射确定性强                   |
| 预建映射表 + 人工审核           | 查询速度快；结果确定性高                         | 需专业药学人力持续维护；映射错误有安全风险；成本不可控 |
| 自动化映射（名称匹配/模糊匹配） | 无需人工                                         | 准确率不可接受；医药领域不可容忍假阳性                 |

## Consequences

- **变简单**：数据模型更简洁，无未使用的桥接字段；导入流程不再处理空列
- **变灵活**：LLM 根据上下文自主决定是否跨源查询，而非依赖固定映射
- **风险**：LLM 跨源检索结果可能不够精确，但通过 system prompt 和工具描述已可引导
- **不可逆**：删除字段后如未来需要映射，需重新导入数据。但鉴于映射维护成本和风险，此决策不会逆转
