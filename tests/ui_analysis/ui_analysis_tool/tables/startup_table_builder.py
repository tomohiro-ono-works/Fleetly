from __future__ import annotations

from typing import Any, Dict, List


def build_startup_dependency_table(startup_records: List[Dict[str, Any]]) -> Dict[str, Any]:
    rows = [r.get("startup_step", "") for r in startup_records]
    columns = sorted({dep for r in startup_records for dep in r.get("depends_on", [])} | {e.get("effect_key", f"{e.get('effect_type','')}:{e.get('effect_target','')}") for r in startup_records for e in r.get("effect_targets", [])})
    cells = []
    for r in startup_records:
        row = r.get("startup_step", "")
        deps = set(r.get("depends_on", []))
        effects = {e.get("effect_key", f"{e.get('effect_type','')}:{e.get('effect_target','')}") for e in r.get("effect_targets", [])}
        for col in columns:
            if col in deps or col in effects:
                cells.append({"row_key": row, "col_key": col, "depends": col in deps, "effect": col in effects, "notes": r.get("risk_notes", [])})
    return {"rows": rows, "columns": columns, "cells": cells, "summary": {"row_count": len(rows), "column_count": len(columns), "cell_count": len(cells)}}
