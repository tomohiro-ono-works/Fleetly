from __future__ import annotations

from typing import Any, Dict, List

STARTUP_TRIGGER_TYPES = {"lifecycle", "scheduler", "external_event", "internal_event"}
STARTUP_TRIGGER_NAMES = {"load", "DOMContentLoaded", "resize", "ziz:bridge-ready", "requestAnimationFrame", "setTimeout"}


def analyze_startup_path(project_inventory: Any, flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    records = []
    for flow in flow_graph.get("flows", []):
        trigger = flow.get("trigger", {})
        if trigger.get("trigger_type") not in STARTUP_TRIGGER_TYPES and trigger.get("trigger_name") not in STARTUP_TRIGGER_NAMES:
            continue
        effects = flow.get("effects", [])
        deps = []
        if trigger.get("trigger_type") == "lifecycle":
            deps.append("browser_lifecycle")
        if trigger.get("trigger_name") == "ziz:bridge-ready":
            deps.append("bridge_ready")
        if trigger.get("trigger_type") == "scheduler":
            deps.append("scheduler")
        records.append({
            "startup_step": flow.get("row_key", ""),
            "depends_on": deps,
            "effect_targets": effects,
            "risk_notes": ["startup/lifecycle related flow"],
            "handler": flow.get("handler", {}),
            "trigger": trigger,
        })
    return records


def detect_startup_dependency_chain(project_inventory: Any) -> List[Dict[str, Any]]:
    # Lightweight placeholder for script/link chain. The project_inventory object is
    # still emitted separately in inventory/project_inventory.json.
    return []
