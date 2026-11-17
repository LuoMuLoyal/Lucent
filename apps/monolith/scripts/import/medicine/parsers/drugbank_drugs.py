"""DrugBank 药品解析器 —— 读 `DrugDataBase/derived/drugbank/drugbank_drugs.parquet`。

为什么改用 Parquet
------------------
原先本文件直接流式解析 `full database.xml`，以标签名 `<drug>` 匹配药品。但 XML 里
`<pathways><pathway><drugs><drug>` 是**同名元素**（约 99.4 万条引用，每条只有 id +
name），于是每次导入都会多出近百万条残缺行（`raw_row_count` = 1,014,340），真药只有
19,842 条；引用行先于真药写入，真记录即便随后 upsert 覆盖，也只在部分列上生效。

Parquet 导出侧在抽取时就用父元素判定（`<drugbank>` 的直接子元素 `<drug>`），只保留
真药，因此本解析器一条不多、一条不少。字段语义与旧 XML 解析器逐字段对拍一致。

Parquet 取值约定
----------------
- 叶子字段（`name` / `description` / `state` / `cas_number` / …）就是纯文本，
  文本清洗与旧路径完全相同（仍走 `clean_narrative_text`，只作用于散文列）
- 结构化字段是 JSON：容器元素名 → 其子元素。**单个子元素不是数组**，需归一化
- 带属性的子元素被导出成 `{"@": {...}, "#": 文本}`；旧解析器刻意丢弃属性的列
  （`synonyms` / `categories` / `food_interactions` / `atc_codes`）取 `#` 或 `@`

范围
----
只保留旧解析器原本就写入 `drugbank_drugs` 的列。Parquet 里另有 25 个
`drugbank_drugs` 没有对应表列的字段（`prices` / `manufacturers` / `patents` /
`dosages` / `pathways` / `snp_effects` / `reactions` / `msds` / `fda_label` …），
需要建列迁移后才能导入，此处不处理。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from typing import Any, Iterator

from common import (
    build_search_text,
    clean_narrative_text,
    emit_error,
    emit_record,
    normalize_list,
    normalize_text,
)

# 散文字段：需要解码实体、去掉内联标记。其余字段保持原样。
NARRATIVE_FIELDS = (
    "description",
    "indication",
    "pharmacodynamics",
    "mechanism_of_action",
    "toxicity",
    "metabolism",
    "absorption",
    "half_life",
    "protein_binding",
    "route_of_elimination",
    "volume_of_distribution",
    "clearance",
)

# 容器列 → 其中承载条目的子元素名（JSON 里的 key）。
CONTAINER_CHILDREN = {
    "groups": "group",
    "synonyms": "synonym",
    "categories": "category",
    "food_interactions": "food-interaction",
    "drug_interactions": "drug-interaction",
    "external_identifiers": "external-identifier",
    "external_links": "external-link",
    "atc_codes": "atc-code",
    "targets": "target",
    "enzymes": "enzyme",
    "carriers": "carrier",
    "transporters": "transporter",
}

# 靶点关系四组：Parquet 列 → 单数元素名。旧解析器用它作为 `relation_kind`。
RELATION_GROUPS = (
    ("targets", "target"),
    ("enzymes", "enzyme"),
    ("carriers", "carrier"),
    ("transporters", "transporter"),
)

PARQUET_BATCH_ROWS = 2048


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def as_json(value: Any) -> Any:
    """解析结构化列；非 JSON 文本返回 None。

    只在首字符是 `{` / `[` 时才尝试 `json.loads`：药名里本来就有
    `{(4Z)-2-[(1R,2R)-…}acetic acid`、`[Leu1, Thr2]-63-desulfohirudin` 这种以括号
    起头的纯文本，无条件解析会误判（前者还是合法 JSON 对象，会直接丢掉整个药名）。
    """
    if not isinstance(value, str):
        return None

    if value.lstrip()[:1] not in ("{", "["):
        return None

    try:
        return json.loads(value)
    except ValueError:
        return None


def container_items(value: Any, child_name: str) -> list[Any]:
    """顶层容器列（JSON 字符串）→ 条目列表。"""
    return items_of(as_json(value), child_name)


def items_of(payload: Any, child_name: str) -> list[Any]:
    """容器对象 → 条目列表（单个条目不是数组，统一成列表）。

    与 `container_items` 分开：嵌套节点的取值已经是解析好的对象，不能再走
    `as_json`（它只认字符串）。
    """
    if not isinstance(payload, dict):
        return []

    items = payload.get(child_name)
    if items is None:
        return []
    return items if isinstance(items, list) else [items]


def leaf_text(value: Any) -> str | None:
    """子元素 → 文本。带属性的元素是 `{"@": …, "#": 文本}`，取 `#`。"""
    if isinstance(value, dict):
        return normalize_text(value.get("#"))
    if isinstance(value, list):
        return None
    return normalize_text(value)


def category_text(value: Any) -> str | None:
    """`<categories><category>` 里还嵌着一层 `<category>`，那才是名字。

    旧解析器用 `descendant_texts(…, "category")` 取所有后代文本，等价于取内层
    `<category>`；只有 `mesh-id`、没有内层的那种两边都取不到。
    """
    if isinstance(value, dict):
        inner = value.get("category")
        if inner is not None:
            return leaf_text(inner)
        return normalize_text(value.get("#"))
    return normalize_text(value)


def atc_code(value: Any) -> str | None:
    """`<atc-code code="…">` 的 `code` 属性 —— 旧解析器只取属性，不取元素文本。"""
    if isinstance(value, dict):
        attrib = value.get("@")
        if isinstance(attrib, dict):
            return normalize_text(attrib.get("code"))
    return None


def parse_iso_datetime(value: Any) -> str | None:
    normalized = normalize_text(value)
    if normalized is None:
        return None

    try:
        return dt.datetime.fromisoformat(normalized).isoformat()
    except ValueError:
        return normalized


def parse_relation_actions(value: Any) -> list[str]:
    """`<actions>` 节点（已解析的嵌套对象）→ action 文本列表。"""
    return normalize_list(
        [leaf_text(item) for item in items_of(value, "action")]
    )


def parse_xml_targets(row: dict[str, Any]) -> list[dict[str, Any]]:
    """重建 `<targets>` / `<enzymes>` / `<carriers>` / `<transporters>` 关系。

    这些是 CSV 导出件完全没有的药理信息：每条带 `BE…` 靶点 id、名称、物种，以及
    `<actions>`（inhibitor / agonist / antagonist / substrate …）。XML 的靶点 id
    空间与 `all.csv` 的数字 id 不重叠，因此仍按 `name` + `organism` 交给导入侧
    去 `drugbank_targets` 里解析。
    """
    relations: list[dict[str, Any]] = []

    for column, item_name in RELATION_GROUPS:
        for item in container_items(row.get(column), item_name):
            if not isinstance(item, dict):
                # 旧解析器要求这些条目有 <name> 子元素；纯文本条目等效于缺名。
                continue

            name = normalize_text(item.get("name"))
            if name is None:
                continue

            relations.append(
                {
                    "source_target_id": normalize_text(item.get("id")),
                    "name": name,
                    "organism": normalize_text(item.get("organism")),
                    "actions": parse_relation_actions(item.get("actions")),
                    "relation_kind": item_name,
                    "known_action": normalize_text(item.get("known-action")),
                }
            )

    return relations


def parse_drug_interactions(value: Any) -> list[dict[str, str | None]]:
    interactions = []
    for item in container_items(value, "drug-interaction"):
        if not isinstance(item, dict):
            continue
        interactions.append(
            {
                "drugbankId": normalize_text(item.get("drugbank-id")),
                "name": normalize_text(item.get("name")),
                "description": normalize_text(item.get("description")),
            }
        )
    return interactions


def parse_external_identifiers(value: Any) -> list[dict[str, str | None]]:
    identifiers = []
    for item in container_items(value, "external-identifier"):
        if not isinstance(item, dict):
            continue
        identifiers.append(
            {
                "resource": normalize_text(item.get("resource")),
                "identifier": normalize_text(item.get("identifier")),
            }
        )
    return identifiers


def parse_external_links(value: Any) -> list[dict[str, str | None]]:
    links = []
    for item in container_items(value, "external-link"):
        if not isinstance(item, dict):
            continue
        links.append(
            {
                "resource": normalize_text(item.get("resource")),
                "url": normalize_text(item.get("url")),
            }
        )
    return links


def build_record(row: dict[str, Any], row_number: int) -> dict[str, Any] | None:
    primary_id = normalize_text(row.get("drugbank_id"))
    if primary_id is None:
        emit_error("Missing DrugBank identifier", row_number)
        return None

    name = normalize_text(row.get("name"))
    if name is None:
        emit_error(f"Missing drug name for {primary_id}", row_number)
        return None

    all_ids_payload = as_json(row.get("drugbank_ids"))
    all_ids = (
        [normalize_text(item) for item in all_ids_payload]
        if isinstance(all_ids_payload, list)
        else []
    )
    all_ids = [item for item in all_ids if item is not None]

    # 主键那一项不进 secondary；其余（含重复项）全部保留，与旧解析器的位置逻辑一致。
    try:
        primary_index = all_ids.index(primary_id)
    except ValueError:
        primary_index = -1
    secondary_ids = [
        item for index, item in enumerate(all_ids) if index != primary_index
    ]

    cas_number = normalize_text(row.get("cas_number"))
    unii = normalize_text(row.get("unii"))

    groups = normalize_list(
        [leaf_text(item) for item in container_items(row.get("groups"), "group")]
    )
    synonyms = normalize_list(
        [
            leaf_text(item)
            for item in container_items(row.get("synonyms"), "synonym")
        ]
    )
    categories = normalize_list(
        [
            category_text(item)
            for item in container_items(row.get("categories"), "category")
        ]
    )
    food_interactions = normalize_list(
        [
            leaf_text(item)
            for item in container_items(
                row.get("food_interactions"), "food-interaction"
            )
        ]
    )
    atc_codes = normalize_list(
        [
            atc_code(item)
            for item in container_items(row.get("atc_codes"), "atc-code")
        ]
    )

    narrative = {
        field: clean_narrative_text(row.get(field)) for field in NARRATIVE_FIELDS
    }

    record: dict[str, Any] = {
        "drugbank_id": primary_id,
        "secondary_drugbank_ids": secondary_ids or None,
        "drug_type": normalize_text(row.get("type")),
        "source_created_at": parse_iso_datetime(row.get("created")),
        "source_updated_at": parse_iso_datetime(row.get("updated")),
        "name": name,
        "cas_number": cas_number,
        "unii": unii,
        "state": normalize_text(row.get("state")),
        "groups": groups or None,
        "classification": as_json(row.get("classification")),
        "synonyms": synonyms or None,
        "products": as_json(row.get("products")),
        "international_brands": as_json(row.get("international_brands")),
        "categories": categories or None,
        "atc_codes": atc_codes or None,
        "food_interactions": food_interactions or None,
        "drug_interactions": parse_drug_interactions(row.get("drug_interactions"))
        or None,
        "external_identifiers": parse_external_identifiers(
            row.get("external_identifiers")
        )
        or None,
        "external_links": parse_external_links(row.get("external_links")) or None,
        "xml_targets": parse_xml_targets(row) or None,
        "search_text": build_search_text(
            [name, primary_id, cas_number, unii]
            + secondary_ids
            + groups
            + synonyms[:20]
        ),
    }
    record.update(narrative)

    return record


def iter_rows(source_path: str) -> Iterator[tuple[int, dict[str, Any]]]:
    """按批流式读取 Parquet，保持文件行序（即 XML 文档序）。"""
    try:
        import pyarrow.parquet as pq
    except ModuleNotFoundError:
        raise SystemExit(
            "pyarrow is required for the DrugBank Parquet import. "
            "Run `pip install -r scripts/import/medicine/requirements.txt`."
        )

    parquet = pq.ParquetFile(source_path)
    row_number = 0
    for batch in parquet.iter_batches(batch_size=PARQUET_BATCH_ROWS):
        for row in batch.to_pylist():
            row_number += 1
            yield row_number, row


def main() -> None:
    args = parse_args()

    emitted = 0
    for row_number, row in iter_rows(args.source_path):
        record = build_record(row, row_number)
        if record is None:
            continue

        emit_record(record)
        emitted += 1
        if args.limit is not None and emitted >= args.limit:
            break


if __name__ == "__main__":
    main()
