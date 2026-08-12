from __future__ import annotations

from typing import Any, Dict, List

RENDER_TYPES = {"dom_update", "canvas_redraw", "layout_recalc"}


def _hotspot_score(flow: Dict[str, Any], render_targets: List[Dict[str, Any]]) -> float:
    score = 0.0
    flags = flow.get("flags", {})
    trigger = flow.get("trigger", {})
    source = flow.get("source", {})
    if flags.get("high_frequency_trigger"):
        score += 4.0
    if any(e.get("effect_type") == "canvas_redraw" for e in render_targets):
        score += 3.0
    if any(e.get("effect_type") == "layout_recalc" for e in render_targets):
        score += 3.0
    if any(e.get("effect_type") == "dom_update" for e in render_targets):
        score += 1.0
    if flags.get("has_state_write"):
        score += 1.5
    if source.get("source_type") in {"window", "document", "canvas"}:
        score += 0.8
    if trigger.get("trigger_name") in {"mousemove", "pointermove", "scroll", "wheel", "resize", "requestAnimationFrame"}:
        score += 1.0
    return round(score, 2)


def analyze_render_scope(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = []
    for flow in flow_graph.get("flows", []):
        render_targets = [e for e in flow.get("effects", []) if e.get("effect_type") in RENDER_TYPES]
        if not render_targets:
            continue
        score = _hotspot_score(flow, render_targets)
        notes = []
        if flow.get("flags", {}).get("high_frequency_trigger"):
            notes.append("high-frequency trigger reaches render/layout target")
        if any(e.get("effect_type") == "layout_recalc" for e in render_targets):
            notes.append("layout recalculation candidate")
        if any(e.get("effect_type") == "canvas_redraw" for e in render_targets):
            notes.append("canvas redraw candidate")
        records.append({
            "row_key": flow.get("row_key", ""),
            "flow_id": flow.get("flow_id", ""),
            "trigger": flow.get("trigger", {}),
            "source": flow.get("source", {}),
            "handler": flow.get("handler", {}),
            "render_targets": render_targets,
            "is_full_redraw_candidate": any(e.get("effect_target") in {"renderApp", "drawFlowCanvas", "requestDraw"} for e in render_targets),
            "is_layout_recalc_candidate": any(e.get("effect_type") == "layout_recalc" for e in render_targets),
            "hotspot_score": score,
            "notes": notes,
        })
    records.sort(key=lambda r: r.get("hotspot_score", 0), reverse=True)
    return records


def detect_full_redraw_candidates(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [r for r in analyze_render_scope(flow_graph) if r.get("is_full_redraw_candidate")]


def detect_layout_recalc_candidates(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [r for r in analyze_render_scope(flow_graph) if r.get("is_layout_recalc_candidate")]
