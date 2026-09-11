#!/usr/bin/env python3
"""Pagination investigation helpers for tests/api-verify.sh and audit scripts."""
from __future__ import annotations

import json
import sys
from typing import Any


def _load_json(raw: str) -> dict[str, Any]:
    data = json.loads(raw)
    return data if isinstance(data, dict) else {"items": data}


def page_meta(body: str) -> dict[str, Any]:
    data = _load_json(body)
    items = data.get("items", [])
    if not isinstance(items, list):
        items = []
    meta = data.get("_meta") or data.get("meta") or {}
    ids = [i.get("id") for i in items if isinstance(i, dict) and i.get("id") is not None]
    size_bytes = len(body.encode("utf-8"))
    return {
        "count": len(items),
        "nextPageToken": meta.get("nextPageToken") or "",
        "total": meta.get("total") or meta.get("totalElements") or "",
        "bytes": size_bytes,
        "firstId": ids[0] if ids else "",
        "lastId": ids[-1] if ids else "",
        "fatPage": size_bytes > 500_000,
    }


def ids_from_body(body: str) -> list[int]:
    data = _load_json(body)
    items = data.get("items", [])
    if not isinstance(items, list):
        return []
    out: list[int] = []
    for item in items:
        if isinstance(item, dict) and item.get("id") is not None:
            out.append(int(item["id"]))
    return out


def count_deprecated(body: str) -> int:
    data = _load_json(body)
    items = data.get("items", [])
    if not isinstance(items, list):
        return 0
    return sum(1 for i in items if isinstance(i, dict) and i.get("deprecated") is True)


def suite_descendants_from_items(items: list[Any], root_id: int) -> list[int]:
    by_parent: dict[int | None, list[int]] = {}
    for s in items:
        if not isinstance(s, dict):
            continue
        sid = s.get("id")
        if sid is None:
            continue
        pid = s.get("parentSuiteId")
        by_parent.setdefault(pid, []).append(int(sid))

    out: list[int] = [int(root_id)]

    def walk(parent: int) -> None:
        for child in by_parent.get(parent, []):
            out.append(child)
            walk(child)

    walk(int(root_id))
    return sorted(set(out))


def suite_descendant_ids(suites_body: str, root_id: int) -> list[int]:
    data = _load_json(suites_body)
    items = data.get("items", [])
    if not isinstance(items, list):
        return [root_id]
    return suite_descendants_from_items(items, root_id)


def suite_descendants_from_pages(pages_raw: str, root_id: int) -> list[int]:
    items: list[Any] = []
    for part in pages_raw.split("\n---PAGE---\n"):
        part = part.strip()
        if not part:
            continue
        data = _load_json(part)
        page_items = data.get("items", [])
        if isinstance(page_items, list):
            items.extend(page_items)
    return suite_descendants_from_items(items, root_id)


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "usage: pagination-walk.py <mode> [args...]\n"
            "modes: page_meta | ids | count_deprecated | suite_descendants | suite_descendants_pages",
            file=sys.stderr,
        )
        return 2

    mode = sys.argv[1]
    body = sys.stdin.read()

    if mode == "page_meta":
        print(json.dumps(page_meta(body), separators=(",", ":")))
        return 0

    if mode == "ids":
        for i in ids_from_body(body):
            print(i)
        return 0

    if mode == "count_deprecated":
        print(count_deprecated(body))
        return 0

    if mode == "suite_descendants":
        if len(sys.argv) < 3:
            print("suite_descendants requires root_suite_id arg", file=sys.stderr)
            return 2
        root_id = int(sys.argv[2])
        for sid in suite_descendant_ids(body, root_id):
            print(sid)
        return 0

    if mode == "suite_descendants_pages":
        if len(sys.argv) < 3:
            print("suite_descendants_pages requires root_suite_id arg", file=sys.stderr)
            return 2
        root_id = int(sys.argv[2])
        for sid in suite_descendants_from_pages(body, root_id):
            print(sid)
        return 0

    print(f"unknown mode: {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
