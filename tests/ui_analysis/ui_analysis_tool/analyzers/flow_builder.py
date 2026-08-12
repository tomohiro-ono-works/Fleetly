from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List

from ui_analysis_tool.models import EffectRecord, EventBindingRecord, StateOperationRecord, to_jsonable

RENDER_EFFECT_TYPES = {"canvas_redraw", "layout_recalc", "dom_update"}
EXTERNAL_EFFECT_TYPES = {"bridge_call", "native_call", "api_call"}


def _state_payload(state: StateOperationRecord) -> Dict[str, Any]:
    return {
        "state_op_id": state.state_op_id,
        "state_ref": state.state_ref,
        "state_kind": state.state_kind,
        "change_kind": state.change_kind,
        "file": state.relative_path,
        "line": state.start_line,
        "confidence": state.confidence,
        "evidence": state.evidence,
        "notes": list(state.notes),
    }


def _effect_payload(effect: EffectRecord) -> Dict[str, Any]:
    return {
        "effect_id": effect.effect_id,
        "effect_type": effect.effect_type,
        "effect_target": effect.effect_target,
        "effect_key": f"{effect.effect_type}:{effect.effect_target}",
        "file": effect.relative_path,
        "line": effect.start_line,
        "confidence": effect.confidence,
        "evidence": effect.evidence,
        "notes": list(effect.notes),
    }


def build_execution_flow_graph(
    bindings: List[EventBindingRecord],
    state_operations: List[StateOperationRecord],
    effects: List[EffectRecord],
) -> Dict[str, Any]:
    """Connect Phase 3 bindings with Phase 4 state/effect records.

    This is still a static heuristic graph. The strongest join key is binding_id,
    because Phase 4 records are extracted from the handler context associated with
    each binding.
    """
    states_by_binding: dict[str, list[StateOperationRecord]] = defaultdict(list)
    effects_by_binding: dict[str, list[EffectRecord]] = defaultdict(list)
    for state in state_operations:
        states_by_binding[state.binding_id].append(state)
    for effect in effects:
        effects_by_binding[effect.binding_id].append(effect)

    graph_nodes: dict[str, dict[str, Any]] = {}
    graph_edges: list[dict[str, Any]] = []
    flow_records: list[dict[str, Any]] = []

    for binding in bindings:
        trigger = binding.trigger
        source = binding.source
        handler = binding.handler
        states = states_by_binding.get(binding.binding_id, [])
        effects_for_binding = effects_by_binding.get(binding.binding_id, [])
        state_reads = [s for s in states if s.change_kind == "read"]
        state_writes = [s for s in states if s.change_kind != "read"]

        row_key = "|".join([
            trigger.trigger_type,
            trigger.trigger_name,
            source.source_type,
            source.source_ref,
            handler.handler_id,
        ])

        graph_nodes.setdefault(trigger.trigger_id, {
            "node_id": trigger.trigger_id,
            "node_type": "trigger",
            "label": f"{trigger.trigger_type}:{trigger.trigger_name}",
        })
        graph_nodes.setdefault(source.source_id, {
            "node_id": source.source_id,
            "node_type": "source",
            "label": f"{source.source_type}:{source.source_ref}",
        })
        graph_nodes.setdefault(handler.handler_id, {
            "node_id": handler.handler_id,
            "node_type": "handler",
            "label": handler.handler_name,
        })
        graph_edges.append({"from": trigger.trigger_id, "to": source.source_id, "edge_type": "fires_on"})
        graph_edges.append({"from": source.source_id, "to": handler.handler_id, "edge_type": "handled_by"})

        for state in states:
            graph_nodes.setdefault(state.state_op_id, {
                "node_id": state.state_op_id,
                "node_type": "state",
                "label": f"{state.change_kind}:{state.state_ref}",
            })
            graph_edges.append({"from": handler.handler_id, "to": state.state_op_id, "edge_type": state.change_kind})
        for effect in effects_for_binding:
            graph_nodes.setdefault(effect.effect_id, {
                "node_id": effect.effect_id,
                "node_type": "effect",
                "label": f"{effect.effect_type}:{effect.effect_target}",
            })
            graph_edges.append({"from": handler.handler_id, "to": effect.effect_id, "edge_type": "causes"})
            for state in state_writes or state_reads:
                graph_edges.append({"from": state.state_op_id, "to": effect.effect_id, "edge_type": "may_affect"})

        has_high_frequency_trigger = trigger.trigger_name in {
            "mousemove", "pointermove", "wheel", "scroll", "resize", "requestAnimationFrame", "setInterval"
        }
        has_render_effect = any(e.effect_type in RENDER_EFFECT_TYPES for e in effects_for_binding)
        has_external_effect = any(e.effect_type in EXTERNAL_EFFECT_TYPES for e in effects_for_binding)
        max_conf = 0.0
        values = [trigger.confidence, source.confidence, handler.confidence]
        values += [s.confidence for s in states]
        values += [e.confidence for e in effects_for_binding]
        if values:
            max_conf = min(values)

        flow_records.append({
            "flow_id": f"flow::{binding.binding_id}",
            "binding_id": binding.binding_id,
            "row_key": row_key,
            "trigger": {
                "trigger_id": trigger.trigger_id,
                "trigger_type": trigger.trigger_type,
                "trigger_name": trigger.trigger_name,
                "event_name": trigger.event_name,
                "file": trigger.relative_path,
                "line": trigger.start_line,
                "confidence": trigger.confidence,
            },
            "source": {
                "source_id": source.source_id,
                "source_type": source.source_type,
                "source_ref": source.source_ref,
                "selector": source.selector,
                "dom_id": source.dom_id,
                "file": source.relative_path,
                "line": source.start_line,
                "confidence": source.confidence,
            },
            "handler": {
                "handler_id": handler.handler_id,
                "handler_name": handler.handler_name,
                "handler_kind": handler.handler_kind,
                "file": handler.relative_path,
                "line": handler.start_line,
                "confidence": handler.confidence,
            },
            "state_reads": [_state_payload(s) for s in state_reads],
            "state_writes": [_state_payload(s) for s in state_writes],
            "effects": [_effect_payload(e) for e in effects_for_binding],
            "flags": {
                "high_frequency_trigger": has_high_frequency_trigger,
                "has_render_effect": has_render_effect,
                "has_external_effect": has_external_effect,
                "has_state_write": bool(state_writes),
                "has_canvas_redraw": any(e.effect_type == "canvas_redraw" for e in effects_for_binding),
                "has_layout_recalc": any(e.effect_type == "layout_recalc" for e in effects_for_binding),
                "has_dom_update": any(e.effect_type == "dom_update" for e in effects_for_binding),
            },
            "confidence": round(max_conf, 3),
            "notes": ["static heuristic flow; handler context is the join boundary"],
        })

    return {
        "nodes": list(graph_nodes.values()),
        "edges": graph_edges,
        "flows": flow_records,
        "summary": {
            "node_count": len(graph_nodes),
            "edge_count": len(graph_edges),
            "flow_count": len(flow_records),
            "flows_with_state_write": sum(1 for f in flow_records if f["flags"]["has_state_write"]),
            "flows_with_canvas_redraw": sum(1 for f in flow_records if f["flags"]["has_canvas_redraw"]),
            "flows_with_layout_recalc": sum(1 for f in flow_records if f["flags"]["has_layout_recalc"]),
            "high_frequency_render_flows": sum(
                1 for f in flow_records
                if f["flags"]["high_frequency_trigger"] and f["flags"]["has_render_effect"]
            ),
        },
    }


def build_flow_records(flow_graph: Dict[str, Any]) -> List[Dict[str, Any]]:
    return list(flow_graph.get("flows", []))
