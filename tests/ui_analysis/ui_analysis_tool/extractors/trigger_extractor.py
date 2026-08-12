from __future__ import annotations

import re
from pathlib import Path
from typing import List

from ui_analysis_tool.extractors.source_extractor import SourceIndex, classify_source_ref, find_line_context
from ui_analysis_tool.models import EventBindingRecord, HandlerRecord, HtmlPageRecord, JsModuleRecord, SourceRecord, TriggerRecord
from ui_analysis_tool.utils.text_utils import compact_ws, line_no_at

ADD_EVENT_RE = re.compile(
    r"(?P<source>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.addEventListener\(\s*['\"](?P<event>[^'\"]+)['\"]\s*,\s*(?P<handler>[^\n\r,\)]{1,240})",
    re.M,
)
ASSIGN_EVENT_RE = re.compile(
    r"(?P<source>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.(?P<event>on[a-z]+)\s*=\s*(?P<handler>[^;\n]{1,240})",
    re.M,
)
OBJECT_INLINE_HANDLER_RE = re.compile(
    r"(?P<event>on[A-Za-z][A-Za-z0-9_]*)\s*:\s*(?P<handler>(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\(|[A-Za-z_$][\w$]*)",
    re.M,
)
SCHEDULER_RE = re.compile(
    r"(?P<scheduler>setTimeout|setInterval|requestAnimationFrame)\s*\(\s*(?P<handler>(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|function\s*\(|[A-Za-z_$][\w$]*)",
    re.M,
)
CUSTOM_EVENT_RE = re.compile(r"(?:new\s+)?CustomEvent\(\s*['\"](?P<event>[^'\"]+)['\"]", re.M)
DISPATCH_EVENT_RE = re.compile(r"(?P<source>window|document|[A-Za-z_$][\w$]*)\.dispatchEvent\(\s*new\s+CustomEvent\(\s*['\"](?P<event>[^'\"]+)['\"]", re.M)
BRIDGE_CONNECT_RE = re.compile(
    r"(?P<source>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\.connect\(\s*(?P<handler>[A-Za-z_$][\w$]*)\s*\)",
    re.M,
)
HTML_INLINE_EVENT_RE = re.compile(r"<(?P<tag>[A-Za-z][\w:-]*)(?P<attrs>[^>]*)\s(?P<event>on[a-z]+)\s*=\s*['\"](?P<handler>[^'\"]+)['\"]", re.I | re.M)
HTML_ID_RE = re.compile(r"\bid\s*=\s*['\"]([^'\"]+)['\"]", re.I)

USER_EVENTS = {
    "click", "dblclick", "mousedown", "mouseup", "mousemove", "mouseleave", "mouseenter", "mouseover", "mouseout",
    "keydown", "keyup", "keypress", "input", "change", "focus", "blur", "wheel", "scroll", "contextmenu", "submit",
    "pointerdown", "pointermove", "pointerup", "pointerleave", "drag", "dragstart", "dragend", "drop",
}
LIFECYCLE_EVENTS = {"load", "DOMContentLoaded", "beforeunload", "pageshow", "pagehide", "resize"}


def classify_trigger_type(event_name: str, binding_kind: str = "") -> str:
    name = str(event_name or "").strip()
    bare = name[2:].lower() if name.lower().startswith("on") else name.lower()
    if binding_kind == "scheduler" or bare in {"settimeout", "setinterval", "requestanimationframe"}:
        return "scheduler"
    if binding_kind in {"bridge_connect", "external_callback"}:
        return "external_event"
    if name.startswith("ziz:") or ":" in name or binding_kind in {"custom_event", "dispatch_event", "object_callback"}:
        return "internal_event"
    if bare in LIFECYCLE_EVENTS:
        return "lifecycle"
    if bare in USER_EVENTS:
        return "user_event"
    return "internal_event" if name.startswith("on") else "user_event"


def normalize_event_name(event_name: str) -> str:
    name = str(event_name or "").strip()
    if name.lower().startswith("on") and len(name) > 2:
        rest = name[2:]
        if rest[:1].isupper():
            return rest[:1].lower() + rest[1:]
        return rest
    return name


def classify_handler(handler_expr: str, fallback_name: str) -> tuple[str, str, float]:
    expr = compact_ws(handler_expr).rstrip(")").strip()
    if not expr:
        return fallback_name, "unknown", 0.35
    if "=>" in expr or expr.startswith("function") or expr.startswith("async"):
        return fallback_name, "inline_handler", 0.72
    m = re.match(r"([A-Za-z_$][\w$]*)", expr)
    if m:
        return m.group(1), "listener", 0.85
    return fallback_name, "callback", 0.45


def make_binding(
    *,
    module_path: str,
    file_path: str,
    text: str,
    match_start: int,
    source_expr: str,
    event_name: str,
    handler_expr: str,
    binding_kind: str,
    source_index: SourceIndex,
    source_override_type: str | None = None,
    source_override_ref: str | None = None,
) -> EventBindingRecord:
    line = line_no_at(text, match_start)
    normalized_event = normalize_event_name(event_name)
    source_type, source_ref, dom_id, source_conf, notes = classify_source_ref(source_expr, module_path, source_index)
    if source_override_type:
        source_type = source_override_type
    if source_override_ref:
        source_ref = source_override_ref
    binding_id = f"{module_path}::L{line}:{binding_kind}:{source_ref}:{normalized_event}"
    trigger_id = f"trigger::{binding_id}"
    source_id = f"source::{module_path}::L{line}:{source_type}:{source_ref}"
    fallback_handler = f"{binding_kind}_{normalized_event}_handler@L{line}"
    handler_name, handler_kind, handler_conf = classify_handler(handler_expr, fallback_handler)
    handler_id = f"handler::{module_path}::{handler_name}@L{line}"
    evidence = find_line_context(text, match_start)
    trigger = TriggerRecord(
        trigger_id=trigger_id,
        trigger_type=classify_trigger_type(normalized_event, binding_kind),
        trigger_name=normalized_event,
        event_name=normalized_event,
        source_id=source_id,
        handler_id=handler_id,
        file_path=file_path,
        relative_path=module_path,
        start_line=line,
        confidence=min(source_conf, handler_conf),
        evidence=evidence,
        notes=[],
    )
    source = SourceRecord(
        source_id=source_id,
        source_type=source_type,
        source_ref=source_ref,
        selector=source_ref if source_ref.startswith(("#", ".", "[")) else "",
        dom_id=dom_id,
        file_path=file_path,
        relative_path=module_path,
        start_line=line,
        confidence=source_conf,
        evidence=evidence,
        notes=notes,
    )
    handler = HandlerRecord(
        handler_id=handler_id,
        handler_name=handler_name,
        handler_kind=handler_kind,
        trigger_id=trigger_id,
        source_id=source_id,
        source_ref=source_ref,
        trigger_name=normalized_event,
        file_path=file_path,
        relative_path=module_path,
        start_line=line,
        end_line=line,
        confidence=handler_conf,
        evidence=evidence,
        notes=[],
    )
    return EventBindingRecord(binding_id=binding_id, trigger=trigger, source=source, handler=handler, binding_kind=binding_kind, evidence=evidence)


def extract_js_event_bindings(js_modules: List[JsModuleRecord], source_index: SourceIndex) -> List[EventBindingRecord]:
    out: List[EventBindingRecord] = []
    for module in js_modules:
        path = Path(module.file_path)
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = module.relative_path
        for m in ADD_EVENT_RE.finditer(text):
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr=m.group("source"), event_name=m.group("event"), handler_expr=m.group("handler"),
                binding_kind="add_event_listener", source_index=source_index,
            ))
        for m in ASSIGN_EVENT_RE.finditer(text):
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr=m.group("source"), event_name=m.group("event"), handler_expr=m.group("handler"),
                binding_kind="event_property_assignment", source_index=source_index,
            ))
        for m in OBJECT_INLINE_HANDLER_RE.finditer(text):
            event = m.group("event")
            # Lowercase onclick in object literals is generally created DOM; onToggle/onActionItem are internal callbacks.
            source_type = "dom" if event.islower() else "internal_bus"
            source_ref = f"object_callback:{event}"
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr=source_ref, event_name=event, handler_expr=m.group("handler"),
                binding_kind="object_callback", source_index=source_index,
                source_override_type=source_type, source_override_ref=source_ref,
            ))
        for m in SCHEDULER_RE.finditer(text):
            sched = m.group("scheduler")
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr=sched, event_name=sched, handler_expr=m.group("handler"),
                binding_kind="scheduler", source_index=source_index,
                source_override_type="internal_bus", source_override_ref=sched,
            ))
        for m in DISPATCH_EVENT_RE.finditer(text):
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr=m.group("source"), event_name=m.group("event"), handler_expr="dispatchEvent",
                binding_kind="dispatch_event", source_index=source_index,
                source_override_type="internal_bus", source_override_ref=f"CustomEvent:{m.group('event')}",
            ))
        for m in CUSTOM_EVENT_RE.finditer(text):
            # Keep CustomEvent construction even when dispatch source is not recognized.
            if text[max(0, m.start()-40):m.start()].find("dispatchEvent") >= 0:
                continue
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr="CustomEvent", event_name=m.group("event"), handler_expr="CustomEvent",
                binding_kind="custom_event", source_index=source_index,
                source_override_type="internal_bus", source_override_ref=f"CustomEvent:{m.group('event')}",
            ))
        for m in BRIDGE_CONNECT_RE.finditer(text):
            source_expr = m.group("source")
            if "message" not in source_expr.lower() and "backend" not in source_expr.lower() and "bridge" not in source_expr.lower():
                continue
            out.append(make_binding(
                module_path=rel, file_path=module.file_path, text=text, match_start=m.start(),
                source_expr=source_expr, event_name="external_message", handler_expr=m.group("handler"),
                binding_kind="bridge_connect", source_index=source_index,
                source_override_type="external_interface", source_override_ref=source_expr,
            ))
    return out


def extract_html_inline_event_bindings(html_pages: List[HtmlPageRecord], source_index: SourceIndex) -> List[EventBindingRecord]:
    out: List[EventBindingRecord] = []
    for page in html_pages:
        path = Path(page.file_path)
        text = path.read_text(encoding="utf-8", errors="replace")
        for m in HTML_INLINE_EVENT_RE.finditer(text):
            line = line_no_at(text, m.start())
            attrs = m.group("attrs") or ""
            id_m = HTML_ID_RE.search(attrs)
            dom_id = id_m.group(1) if id_m else ""
            tag = m.group("tag").lower()
            source_ref = f"#{dom_id}" if dom_id else f"<{tag}>@L{line}"
            source_type = "canvas" if tag == "canvas" or dom_id in source_index.html_canvas_ids else "dom"
            out.append(make_binding(
                module_path=page.relative_path, file_path=page.file_path, text=text, match_start=m.start(),
                source_expr=source_ref, event_name=m.group("event"), handler_expr=m.group("handler"),
                binding_kind="html_inline_event", source_index=source_index,
                source_override_type=source_type, source_override_ref=source_ref,
            ))
    return out


def extract_event_bindings(html_pages: List[HtmlPageRecord], js_modules: List[JsModuleRecord], source_index: SourceIndex) -> List[EventBindingRecord]:
    bindings = []
    bindings.extend(extract_js_event_bindings(js_modules, source_index))
    bindings.extend(extract_html_inline_event_bindings(html_pages, source_index))
    # Deduplicate by binding_id while preserving order.
    seen = set()
    unique = []
    for b in bindings:
        if b.binding_id in seen:
            continue
        seen.add(b.binding_id)
        unique.append(b)
    return unique
