from __future__ import annotations

import argparse
import datetime as dt
import xml.etree.ElementTree as ET
from typing import Any

from common import build_search_text, emit_error, emit_record, normalize_list, normalize_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-path", required=True)
    parser.add_argument("--limit", type=int)
    return parser.parse_args()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_elements(parent: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in parent if local_name(child.tag) == name]


def first_child(parent: ET.Element, name: str) -> ET.Element | None:
    for child in parent:
        if local_name(child.tag) == name:
            return child
    return None


def child_text(parent: ET.Element, name: str) -> str | None:
    child = first_child(parent, name)
    return normalize_text(child.text if child is not None else None)


def descendant_texts(parent: ET.Element | None, child_name: str) -> list[str]:
    if parent is None:
        return []

    texts = []
    for descendant in parent.iter():
        if local_name(descendant.tag) != child_name:
            continue
        text = normalize_text(descendant.text)
        if text is not None:
            texts.append(text)
    return normalize_list(texts)


def parse_iso_datetime(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = normalize_text(value)
    if normalized is None:
        return None

    try:
        return dt.datetime.fromisoformat(normalized).isoformat()
    except ValueError:
        return normalized


def element_to_data(element: ET.Element | None) -> Any:
    if element is None:
        return None

    children = list(element)
    if not children:
        if element.attrib:
            payload = dict(element.attrib)
            text = normalize_text(element.text)
            if text is not None:
                payload["value"] = text
            return payload
        return normalize_text(element.text)

    grouped: dict[str, list[Any]] = {}
    for child in children:
        grouped.setdefault(local_name(child.tag), []).append(element_to_data(child))

    payload: dict[str, Any] = dict(element.attrib)
    for key, values in grouped.items():
        payload[key] = values if len(values) > 1 else values[0]

    text = normalize_text(element.text)
    if text is not None:
        payload["value"] = text

    return payload


def parse_drug_interactions(parent: ET.Element | None) -> list[dict[str, str | None]]:
    if parent is None:
        return []

    interactions = []
    for child in child_elements(parent, "drug-interaction"):
        interactions.append(
            {
                "drugbankId": child_text(child, "drugbank-id"),
                "name": child_text(child, "name"),
                "description": child_text(child, "description"),
            }
        )
    return interactions


def parse_external_identifiers(parent: ET.Element | None) -> list[dict[str, str | None]]:
    if parent is None:
        return []

    identifiers = []
    for child in child_elements(parent, "external-identifier"):
        identifiers.append(
            {
                "resource": child_text(child, "resource"),
                "identifier": child_text(child, "identifier"),
            }
        )
    return identifiers


def parse_external_links(parent: ET.Element | None) -> list[dict[str, str | None]]:
    if parent is None:
        return []

    links = []
    for child in child_elements(parent, "external-link"):
        links.append(
            {
                "resource": child_text(child, "resource"),
                "url": child_text(child, "url"),
            }
        )
    return links


def parse_atc_codes(parent: ET.Element | None) -> list[str]:
    if parent is None:
        return []

    codes = []
    for child in child_elements(parent, "atc-code"):
        code = normalize_text(child.attrib.get("code"))
        if code is not None:
            codes.append(code)
    return normalize_list(codes)


def build_record(drug: ET.Element) -> dict[str, Any] | None:
    drugbank_ids = child_elements(drug, "drugbank-id")
    id_values = [normalize_text(item.text) for item in drugbank_ids]
    id_values = [item for item in id_values if item is not None]
    if not id_values:
        emit_error("Missing DrugBank identifier")
        return None

    primary_id = None
    secondary_ids: list[str] = []
    for index, item in enumerate(drugbank_ids):
        current_id = normalize_text(item.text)
        if current_id is None:
            continue

        is_primary = normalize_text(item.attrib.get("primary")) == "true"
        if primary_id is None and (is_primary or index == 0):
            primary_id = current_id
        else:
            secondary_ids.append(current_id)

    primary_id = primary_id or id_values[0]
    name = child_text(drug, "name")
    if name is None:
        emit_error(f"Missing drug name for {primary_id}")
        return None

    groups = descendant_texts(first_child(drug, "groups"), "group")
    synonyms = descendant_texts(first_child(drug, "synonyms"), "synonym")
    categories = descendant_texts(first_child(drug, "categories"), "category")
    food_interactions = descendant_texts(
        first_child(drug, "food-interactions"), "food-interaction"
    )

    record = {
        "drugbank_id": primary_id,
        "secondary_drugbank_ids": secondary_ids or None,
        "drug_type": normalize_text(drug.attrib.get("type")),
        "source_created_at": parse_iso_datetime(drug.attrib.get("created")),
        "source_updated_at": parse_iso_datetime(drug.attrib.get("updated")),
        "name": name,
        "description": child_text(drug, "description"),
        "cas_number": child_text(drug, "cas-number"),
        "unii": child_text(drug, "unii"),
        "state": child_text(drug, "state"),
        "groups": groups or None,
        "indication": child_text(drug, "indication"),
        "pharmacodynamics": child_text(drug, "pharmacodynamics"),
        "mechanism_of_action": child_text(drug, "mechanism-of-action"),
        "toxicity": child_text(drug, "toxicity"),
        "metabolism": child_text(drug, "metabolism"),
        "absorption": child_text(drug, "absorption"),
        "half_life": child_text(drug, "half-life"),
        "protein_binding": child_text(drug, "protein-binding"),
        "route_of_elimination": child_text(drug, "route-of-elimination"),
        "volume_of_distribution": child_text(drug, "volume-of-distribution"),
        "clearance": child_text(drug, "clearance"),
        "classification": element_to_data(first_child(drug, "classification")),
        "synonyms": synonyms or None,
        "products": element_to_data(first_child(drug, "products")),
        "international_brands": element_to_data(first_child(drug, "international-brands")),
        "categories": categories or None,
        "atc_codes": parse_atc_codes(first_child(drug, "atc-codes")) or None,
        "food_interactions": food_interactions or None,
        "drug_interactions": parse_drug_interactions(
            first_child(drug, "drug-interactions")
        )
        or None,
        "external_identifiers": parse_external_identifiers(
            first_child(drug, "external-identifiers")
        )
        or None,
        "external_links": parse_external_links(first_child(drug, "external-links"))
        or None,
        "search_text": build_search_text(
            [name, primary_id, child_text(drug, "cas-number"), child_text(drug, "unii")]
            + secondary_ids
            + groups
            + synonyms[:20]
        ),
    }

    return record


def main() -> None:
    args = parse_args()
    context = ET.iterparse(args.source_path, events=("start", "end"))
    _, root = next(context)

    emitted = 0
    for event, element in context:
        if event != "end" or local_name(element.tag) != "drug":
            continue

        record = build_record(element)
        if record is not None:
            emit_record(record)
            emitted += 1
            if args.limit is not None and emitted >= args.limit:
                break

        element.clear()
        root.clear()


if __name__ == "__main__":
    main()
