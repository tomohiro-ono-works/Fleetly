from __future__ import annotations

from typing import Any, Dict, List

RENDER_EFFECTS = {"dom_update", "canvas_redraw", "layout_recalc"}


def build_render_scope_table(render_scope_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = [r.get("row_key", "") for r in render_scope_records]
    columns = sorted({e.get("effect_key", f"{e.get('effect_type','')}:{e.get('effect_target','')}") for r in render_scope_records for e in r.get("render_targets", [])})
    cells = []
    for r in render_scope_records:
        row_key = r.get("row_key", "")
        targets = r.get("render_targets", [])
        target_keys = {e.get("effect_key", f"{e.get('effect_type','')}:{e.get('effect_target','')}") for e in targets}
        for col in columns:
            if col in target_keys:
                cells.append({
                    "row_key": row_key,
                    "col_key": col,
                    "is_hit": True,
                    "hotspot_score": r.get("hotspot_score", 0),
                    "notes": r.get("notes", []),
                })
    return {"rows": rows, "columns": columns, "cells": cells, "summary": {"row_count": len(rows), "column_count": len(columns), "cell_count": len(cells)}}
