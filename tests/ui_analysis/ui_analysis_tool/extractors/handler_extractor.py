from __future__ import annotations

from typing import List, Tuple

from ui_analysis_tool.models import EventBindingRecord, HandlerRecord, SourceRecord, TriggerRecord


def split_bindings(bindings: List[EventBindingRecord]) -> Tuple[List[TriggerRecord], List[SourceRecord], List[HandlerRecord]]:
    """Return trigger/source/handler lists. Keep one-to-one records for traceability.

    Phase 3 intentionally does not aggressively deduplicate because the same
    handler function can be bound to multiple triggers or sources.
    """
    triggers = [b.trigger for b in bindings]
    sources = [b.source for b in bindings]
    handlers = [b.handler for b in bindings]
    return triggers, sources, handlers


def summarize_extracted_runtime(bindings: List[EventBindingRecord]) -> dict:
    sources = [b.source for b in bindings]
    triggers = [b.trigger for b in bindings]
    return {
        "binding_count": len(bindings),
        "trigger_count": len(triggers),
        "source_count": len(sources),
        "handler_count": len(bindings),
        "canvas_source_count": sum(1 for s in sources if s.source_type == "canvas"),
        "window_source_count": sum(1 for s in sources if s.source_type == "window"),
        "document_source_count": sum(1 for s in sources if s.source_type == "document"),
        "internal_event_count": sum(1 for t in triggers if t.trigger_type == "internal_event"),
        "scheduler_count": sum(1 for t in triggers if t.trigger_type == "scheduler"),
        "external_event_count": sum(1 for t in triggers if t.trigger_type == "external_event"),
        "user_event_count": sum(1 for t in triggers if t.trigger_type == "user_event"),
        "lifecycle_count": sum(1 for t in triggers if t.trigger_type == "lifecycle"),
    }
