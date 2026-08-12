from __future__ import annotations

from typing import List

from ui_analysis_tool.models import CacheOperationRecord, EffectRecord, StateOperationRecord, StorageOperationRecord


def summarize_state_effect_extraction(
    states: List[StateOperationRecord],
    effects: List[EffectRecord],
    storage_ops: List[StorageOperationRecord],
    cache_ops: List[CacheOperationRecord],
) -> dict:
    return {
        "state_operation_count": len(states),
        "effect_count": len(effects),
        "storage_operation_count": len(storage_ops),
        "cache_operation_count": len(cache_ops),
        "persistent_state_count": sum(1 for s in states if s.state_kind == "persistent_state"),
        "view_state_count": sum(1 for s in states if s.state_kind == "view_state"),
        "runtime_state_count": sum(1 for s in states if s.state_kind == "runtime_state"),
        "storage_state_count": sum(1 for s in states if s.state_kind == "storage_state"),
        "cache_state_count": sum(1 for s in states if s.state_kind == "cache_state"),
        "dom_update_effect_count": sum(1 for e in effects if e.effect_type == "dom_update"),
        "canvas_redraw_effect_count": sum(1 for e in effects if e.effect_type == "canvas_redraw"),
        "layout_recalc_effect_count": sum(1 for e in effects if e.effect_type == "layout_recalc"),
        "bridge_call_effect_count": sum(1 for e in effects if e.effect_type == "bridge_call"),
        "native_call_effect_count": sum(1 for e in effects if e.effect_type == "native_call"),
        "api_call_effect_count": sum(1 for e in effects if e.effect_type == "api_call"),
        "route_change_effect_count": sum(1 for e in effects if e.effect_type == "route_change"),
        "log_output_effect_count": sum(1 for e in effects if e.effect_type == "log_output"),
    }
