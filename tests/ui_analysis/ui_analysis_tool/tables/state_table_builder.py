from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List


def build_state_impact_table(state_impact_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = sorted({r.get("state_ref", "") for r in state_impact_records if r.get("state_ref")})
    columns = sorted({f"{r.get('effect_type','')}:{r.get('effect_target','')}" for r in state_impact_records})
    cells: dict[tuple[str, str], dict[str, Any]] = {}
    for r in state_impact_records:
        row = r.get("state_ref", "")
        col = f"{r.get('effect_type','')}:{r.get('effect_target','')}"
        key = (row, col)
        cells.setdefault(key, {
            "row_key": row,
            "col_key": col,
            "handler_ids": [],
            "row_keys": [],
            "confidence": r.get("confidence", 0),
            "notes": [],
        })
        cell = cells[key]
        for hid in r.get("handlers", []):
            if hid and hid not in cell["handler_ids"]:
                cell["handler_ids"].append(hid)
        for rk in r.get("row_keys", []):
            if rk and rk not in cell["row_keys"]:
                cell["row_keys"].append(rk)
    return {"rows": rows, "columns": columns, "cells": list(cells.values()), "summary": {"row_count": len(rows), "column_count": len(columns), "cell_count": len(cells)}}
