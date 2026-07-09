#!/usr/bin/env python3
"""Assert widget SQL / TCM JSON response shapes for api-verify.sh."""
import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: widget-api-assert.py <mode> <json-body> [extra...]", file=sys.stderr)
        return 2

    mode = sys.argv[1]
    body = sys.argv[2]

    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        print("invalid JSON")
        return 1

    if mode == "json_array":
        keys = sys.argv[3].split("|") if len(sys.argv) > 3 else []
        rows = data if isinstance(data, list) else []
        if not rows:
            print("empty array")
            return 1
        for row in rows:
            if not isinstance(row, dict):
                print("row not object")
                return 1
            lower = {k.lower(): k for k in row.keys()}
            for k in keys:
                if k.lower() not in lower:
                    print(f"missing key {k}")
                    return 1
        print("ok")
        return 0

    if mode == "tcm_items":
        items = data.get("items", data) if isinstance(data, dict) else data
        if not isinstance(items, list):
            print("items not array")
            return 1
        for item in items:
            if not isinstance(item, dict):
                print("item not object")
                return 1
            if "label" not in item or "value" not in item:
                print("missing label/value")
                return 1
        print("ok")
        return 0

    if mode == "tcm_net_change":
        items = data.get("items", data) if isinstance(data, dict) else data
        if not isinstance(items, list) or not items:
            print("empty items")
            return 1
        for item in items:
            for k in ("period", "valueFrom", "valueTo"):
                if k not in item:
                    print(f"missing {k}")
                    return 1
        print("ok")
        return 0

    if mode == "extract_hashcode":
        rows = data if isinstance(data, list) else []
        import re
        for row in rows:
            if not isinstance(row, dict):
                continue
            col = row.get("#") or row.get("Failures") or ""
            m = re.search(r"hashcode=([^&\"']+)", str(col))
            if m:
                print(m.group(1))
                return 0
        print("")
        return 0

    if mode == "fields_boolean_id":
        fields = data.get("data", data)
        if isinstance(fields, dict):
            fields = fields.get("fields", [])
        for f in fields or []:
            if f.get("type") == "CUSTOM" and f.get("enabled") and str(f.get("dataType", "")).lower() == "boolean":
                print(f.get("id", ""))
                return 0
        print("")
        return 0

    if mode == "fields_manual_only_id":
        fields = data.get("data", data)
        if isinstance(fields, dict):
            fields = fields.get("fields", [])
        for f in fields or []:
            if f.get("enabled") and str(f.get("name", "")).strip().lower() == "manual only":
                print(f.get("id", ""))
                return 0
        print("")
        return 0

    if mode == "suite_ids":
        items = data.get("items", data) if isinstance(data, dict) else data
        if not isinstance(items, list):
            print("")
            return 0
        ids = [str(i.get("id")) for i in items[:3] if isinstance(i, dict) and i.get("id")]
        print(",".join(ids))
        return 0

    print(f"unknown mode {mode}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
