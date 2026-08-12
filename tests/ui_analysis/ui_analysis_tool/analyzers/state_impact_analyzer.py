from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List


def analyze_state_impact(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    records: dict[tuple[str, str, str], dict[str, Any]] = {}
    for flow in flow_graph.get("flows", []):
        states = flow.get("state_writes", []) or flow.get("state_reads", [])
        effects = flow.get("effects", [])
        handler_id = flow.get("handler", {}).get("handler_id", "")
        row_key = flow.get("row_key", "")
        for state in states:
            for effect in effects:
                key = (state.get("state_ref", ""), effect.get("effect_type", ""), effect.get("effect_target", ""))
                rec = records.setdefault(key, {
                    "state_ref": key[0],
                    "state_kind": state.get("state_kind", ""),
                    "effect_type": key[1],
                    "effect_target": key[2],
                    "handlers": [],
                    "row_keys": [],
                    "change_kinds": [],
                    "confidence": min(state.get("confidence", 0), effect.get("confidence", 0)) if state and effect else 0,
                    "notes": [],
                })
                if handler_id and handler_id not in rec["handlers"]:
                    rec["handlers"].append(handler_id)
                if row_key and row_key not in rec["row_keys"]:
                    rec["row_keys"].append(row_key)
                ck = state.get("change_kind", "")
                if ck and ck not in rec["change_kinds"]:
                    rec["change_kinds"].append(ck)
    out = list(records.values())
    out.sort(key=lambda r: (r["state_ref"], r["effect_type"], r["effect_target"]))
    return out


def build_state_to_effect_links(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return analyze_state_impact(flow_graph)
