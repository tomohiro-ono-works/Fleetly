from __future__ import annotations

from typing import Any, Dict, List


def score_hotspot(flow_record: Dict[str, Any]) -> float:
    score = 0.0
    flags = flow_record.get("flags", {})
    trigger = flow_record.get("trigger", {})
    source = flow_record.get("source", {})
    effects = flow_record.get("effects", [])
    if flags.get("high_frequency_trigger"):
        score += 4
    if flags.get("has_layout_recalc"):
        score += 3
    if flags.get("has_canvas_redraw"):
        score += 3
    if flags.get("has_dom_update"):
        score += 1
    if flags.get("has_state_write"):
        score += 1.5
    if source.get("source_type") in {"window", "document"}:
        score += 1
    if trigger.get("trigger_name") in {"mousemove", "pointermove", "wheel", "scroll", "resize", "requestAnimationFrame"}:
        score += 1
    if len(effects) > 5:
        score += 1
    return round(score, 2)


def analyze_hotspots(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    out = []
    for flow in flow_graph.get("flows", []):
        score = score_hotspot(flow)
        if score <= 0:
            continue
        reasons = []
        flags = flow.get("flags", {})
        if flags.get("high_frequency_trigger"):
            reasons.append("high_frequency_trigger")
        if flags.get("has_layout_recalc"):
            reasons.append("layout_recalc")
        if flags.get("has_canvas_redraw"):
            reasons.append("canvas_redraw")
        if flags.get("has_state_write"):
            reasons.append("state_write")
        if flow.get("source", {}).get("source_type") in {"window", "document"}:
            reasons.append("global_source")
        out.append({
            "row_key": flow.get("row_key", ""),
            "flow_id": flow.get("flow_id", ""),
            "score": score,
            "reasons": reasons,
            "trigger": flow.get("trigger", {}),
            "source": flow.get("source", {}),
            "handler": flow.get("handler", {}),
            "related_effects": flow.get("effects", []),
            "state_writes": flow.get("state_writes", []),
        })
    out.sort(key=lambda r: r["score"], reverse=True)
    return out
