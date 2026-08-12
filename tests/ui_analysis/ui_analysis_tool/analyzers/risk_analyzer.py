from __future__ import annotations

from typing import Any, Dict, List


def analyze_failure_risks(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    risks: List[Dict[str, Any]] = []
    rid = 1
    for flow in flow_graph.get("flows", []):
        flags = flow.get("flags", {})
        trigger = flow.get("trigger", {})
        source = flow.get("source", {})
        handler = flow.get("handler", {})
        effects = flow.get("effects", [])
        states = flow.get("state_writes", [])

        if states and not effects:
            risks.append({
                "risk_id": f"risk-{rid:04d}",
                "title": "state changes without visible/effect target",
                "severity": "medium",
                "row_keys": [flow.get("row_key", "")],
                "description": "A handler appears to write state, but no DOM/canvas/layout/external effect was detected in the same context. It may rely on indirect rendering or may miss a repaint.",
                "recommendations": ["Check whether this state write eventually calls onStateChanged/render/requestDraw.", "If intentional, add an explicit render/effect marker or refactor to make the path visible."],
                "handler": handler,
            })
            rid += 1

        if flags.get("high_frequency_trigger") and flags.get("has_layout_recalc"):
            risks.append({
                "risk_id": f"risk-{rid:04d}",
                "title": "high-frequency trigger reaches layout recalculation",
                "severity": "high",
                "row_keys": [flow.get("row_key", "")],
                "description": "A high-frequency event such as mousemove/resize/requestAnimationFrame reaches layout recalculation. This can cause jank.",
                "recommendations": ["Throttle/debounce or gate unchanged values.", "Move expensive layout calculation outside the high-frequency path when possible."],
                "handler": handler,
            })
            rid += 1

        if flags.get("high_frequency_trigger") and flags.get("has_canvas_redraw"):
            risks.append({
                "risk_id": f"risk-{rid:04d}",
                "title": "high-frequency trigger reaches canvas redraw",
                "severity": "medium",
                "row_keys": [flow.get("row_key", "")],
                "description": "A high-frequency event reaches canvas redraw. This is normal for canvas UIs, but should be requestAnimationFrame-gated and diff-aware.",
                "recommendations": ["Ensure redraw is requestAnimationFrame-coalesced.", "Skip redraw when hover/drop/drag state did not change."],
                "handler": handler,
            })
            rid += 1

        if source.get("source_type") in {"window", "document"} and trigger.get("trigger_name") in {"mousemove", "pointermove", "scroll", "resize"}:
            risks.append({
                "risk_id": f"risk-{rid:04d}",
                "title": "global high-frequency listener",
                "severity": "medium",
                "row_keys": [flow.get("row_key", "")],
                "description": "A high-frequency listener is attached to window/document. It may be legitimate for dragging, but should exit early when inactive.",
                "recommendations": ["Check for early return guards.", "Register only during active drag when possible."],
                "handler": handler,
            })
            rid += 1
    return risks


def detect_missing_render_paths(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [r for r in analyze_failure_risks(flow_graph) if "without visible" in r.get("title", "")]


def detect_order_dependency_risks(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [r for r in analyze_failure_risks(flow_graph) if "startup" in r.get("description", "").lower()]
