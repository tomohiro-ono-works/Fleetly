from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List


def _row_from_flow(flow: Dict[str, Any]) -> Dict[str, Any]:
    trigger = flow.get("trigger", {})
    source = flow.get("source", {})
    handler = flow.get("handler", {})
    return {
        "row_key": flow.get("row_key", ""),
        "flow_id": flow.get("flow_id", ""),
        "trigger_type": trigger.get("trigger_type", ""),
        "trigger_name": trigger.get("trigger_name", ""),
        "source_type": source.get("source_type", ""),
        "source_ref": source.get("source_ref", ""),
        "handler_id": handler.get("handler_id", ""),
        "handler_name": handler.get("handler_name", ""),
        "file": handler.get("file", ""),
        "line": handler.get("line", 0),
        "flags": flow.get("flags", {}),
        "confidence": flow.get("confidence", 0),
    }


def build_main_cross_table(flow_graph: Dict[str, Any]) -> Dict[str, Any]:
    flows = flow_graph.get("flows", [])
    rows = [_row_from_flow(flow) for flow in flows]

    col_map: dict[str, dict[str, str]] = {}
    cell_map: dict[tuple[str, str], dict[str, Any]] = {}
    for flow in flows:
        row_key = flow.get("row_key", "")
        state_reads = [s.get("state_ref", "") for s in flow.get("state_reads", [])]
        state_writes = [s.get("state_ref", "") for s in flow.get("state_writes", [])]
        state_kinds = sorted({s.get("state_kind", "") for s in flow.get("state_reads", []) + flow.get("state_writes", []) if s.get("state_kind")})
        change_kinds = sorted({s.get("change_kind", "") for s in flow.get("state_reads", []) + flow.get("state_writes", []) if s.get("change_kind")})
        for effect in flow.get("effects", []):
            effect_type = effect.get("effect_type", "")
            effect_target = effect.get("effect_target", "")
            col_key = f"{effect_type}:{effect_target}"
            col_map.setdefault(col_key, {
                "col_key": col_key,
                "effect_type": effect_type,
                "effect_target": effect_target,
            })
            key = (row_key, col_key)
            if key not in cell_map:
                cell_map[key] = {
                    "row_key": row_key,
                    "col_key": col_key,
                    "state_reads": [],
                    "state_writes": [],
                    "state_kind": [],
                    "change_kind": [],
                    "effect_count": 0,
                    "confidence": effect.get("confidence", flow.get("confidence", 0)),
                    "notes": [],
                }
            cell = cell_map[key]
            cell["state_reads"] = sorted(set(cell["state_reads"]) | set(state_reads))
            cell["state_writes"] = sorted(set(cell["state_writes"]) | set(state_writes))
            cell["state_kind"] = sorted(set(cell["state_kind"]) | set(state_kinds))
            cell["change_kind"] = sorted(set(cell["change_kind"]) | set(change_kinds))
            cell["effect_count"] += 1

    return {
        "rows": rows,
        "columns": sorted(col_map.values(), key=lambda c: (c["effect_type"], c["effect_target"])),
        "cells": sorted(cell_map.values(), key=lambda c: (c["row_key"], c["col_key"])),
        "summary": {
            "row_count": len(rows),
            "column_count": len(col_map),
            "cell_count": len(cell_map),
        },
    }
