from __future__ import annotations

import re
from typing import List

from ui_analysis_tool.extractors.state_extractor import get_handler_context, _module_text_map
from ui_analysis_tool.models import EffectRecord, EventBindingRecord, JsModuleRecord
from ui_analysis_tool.utils.text_utils import line_no_at

PATTERNS: list[tuple[str, re.Pattern[str], str, float]] = [
    ("canvas_redraw", re.compile(r"\b(requestDraw|drawFlowCanvas|ctx\.(?:clearRect|fill|stroke|fillRect|fillText|drawImage)|canvas\.getContext)\b", re.M), "canvas", 0.78),
    ("layout_recalc", re.compile(r"\b(buildFlowModel|layoutNode|applyFlowViewportHeight|measureText|getBoundingClientRect)\b", re.M), "layout", 0.72),
    ("dom_update", re.compile(r"\.(innerHTML|textContent|className|hidden|value)\s*=|\.classList\.|\.style\.|\.setAttribute\(|\.appendChild\(|\.remove\(\)|\.focus\(\)|\b(showDialog|alert)\s*\(", re.M), "dom", 0.68),
    ("bridge_call", re.compile(r"\b(?:bridgeApi|window\.zizBridge|corePkg\.bridge)\.call\(\s*['\"]([^'\"]+)['\"]|\.postMessage\(", re.M), "bridge", 0.86),
    ("api_call", re.compile(r"\b(fetch|XMLHttpRequest)\s*\(", re.M), "api", 0.75),
    ("storage_write", re.compile(r"\b(?:sessionStorage|localStorage)\.(setItem|removeItem|clear)\s*\(", re.M), "storage", 0.9),
    ("cache_update", re.compile(r"\b([A-Z_]*CACHE|[A-Za-z_$][\w$]*Cache|cache[A-Za-z_$][\w$]*)\.(set|delete|clear)\s*\(", re.M), "cache", 0.72),
    ("route_change", re.compile(r"\b(?:window\.)?location\.(href|replace|assign)\b|window\.location\.href\s*=", re.M), "route", 0.88),
    ("log_output", re.compile(r"\bconsole\.(log|info|warn|error|debug)\s*\(", re.M), "console", 0.9),
    ("window_effect", re.compile(r"\bwindow\.(?:addEventListener|removeEventListener|dispatchEvent|requestAnimationFrame|cancelAnimationFrame|clearTimeout|setTimeout)\s*\(", re.M), "window", 0.6),
    ("document_effect", re.compile(r"\bdocument\.(?:addEventListener|removeEventListener|dispatchEvent|body|head|createElement|querySelector|getElementById)\b", re.M), "document", 0.56),
]

NATIVE_BRIDGE_PREFIXES = ("app.", "flow.", "result.")


def _line_context(text: str, start: int, span: int = 220) -> str:
    return re.sub(r"\s+", " ", text[start:start + span]).strip()


def _target_for(effect_type: str, pattern_name: str, match: re.Match[str], context: str) -> str:
    raw = match.group(0)
    if effect_type == "canvas_redraw":
        if "drawFlowCanvas" in raw:
            return "drawFlowCanvas"
        if "requestDraw" in raw:
            return "requestDraw"
        if "getContext" in raw:
            return "canvas.getContext"
        return "canvas_context"
    if effect_type == "layout_recalc":
        for name in ("buildFlowModel", "layoutNode", "applyFlowViewportHeight", "getBoundingClientRect", "measureText"):
            if name in raw:
                return name
        return "layout"
    if effect_type == "bridge_call":
        quoted = re.search(r"\.call\(\s*['\"]([^'\"]+)['\"]", raw)
        if quoted:
            return quoted.group(1)
        nearby = context[match.start():match.start() + 120]
        quoted = re.search(r"\.call\(\s*['\"]([^'\"]+)['\"]", nearby)
        if quoted:
            return quoted.group(1)
        return "postMessage" if "postMessage" in raw else "bridge_call"
    if effect_type == "native_call":
        return pattern_name
    if effect_type == "api_call":
        return "fetch" if "fetch" in raw else "XMLHttpRequest"
    if effect_type == "storage_write":
        return raw.split("(")[0].strip()
    if effect_type == "cache_update":
        return raw.split("(")[0].strip()
    if effect_type == "route_change":
        return "window.location"
    if effect_type == "log_output":
        return raw.split("(")[0].strip()
    if effect_type == "dom_update":
        if "showDialog" in raw or "alert" in raw:
            return "dialog"
        if "classList" in raw:
            return "classList"
        if "style" in raw:
            return "style"
        if "appendChild" in raw:
            return "appendChild"
        if "remove" in raw:
            return "remove"
        return "dom_property"
    return pattern_name


def _make_effect(
    *,
    effect_type: str,
    effect_target: str,
    binding: EventBindingRecord,
    context_text: str,
    context_start_line: int,
    match_start: int,
    confidence: float,
    notes: List[str] | None = None,
) -> EffectRecord:
    local_line = line_no_at(context_text, match_start)
    line = context_start_line + local_line - 1
    effect_id = f"effect::{binding.binding_id}::{effect_type}:{effect_target}:L{line}"
    return EffectRecord(
        effect_id=effect_id,
        effect_type=effect_type,
        effect_target=effect_target,
        handler_id=binding.handler.handler_id,
        binding_id=binding.binding_id,
        trigger_id=binding.trigger.trigger_id,
        source_id=binding.source.source_id,
        file_path=binding.handler.file_path,
        relative_path=binding.handler.relative_path,
        start_line=line,
        confidence=confidence,
        evidence=_line_context(context_text, match_start),
        notes=notes or [],
    )


def extract_effects(bindings: List[EventBindingRecord], js_modules: List[JsModuleRecord]) -> List[EffectRecord]:
    out: List[EffectRecord] = []
    seen = set()
    module_texts = _module_text_map(js_modules)
    body_cache = {}

    for binding in bindings:
        context, start_line = get_handler_context(binding, js_modules, module_texts, body_cache)

        for effect_type, pattern, target_hint, confidence in PATTERNS:
            for m in pattern.finditer(context):
                target = _target_for(effect_type, target_hint, m, context)
                record = _make_effect(
                    effect_type=effect_type,
                    effect_target=target,
                    binding=binding,
                    context_text=context,
                    context_start_line=start_line,
                    match_start=m.start(),
                    confidence=confidence,
                )
                key = (record.binding_id, record.effect_type, record.effect_target, record.start_line)
                if key not in seen:
                    seen.add(key)
                    out.append(record)

                # Bridge calls with native-like command names should also appear as native_call.
                if effect_type == "bridge_call" and target.startswith(NATIVE_BRIDGE_PREFIXES):
                    native = _make_effect(
                        effect_type="native_call",
                        effect_target=target,
                        binding=binding,
                        context_text=context,
                        context_start_line=start_line,
                        match_start=m.start(),
                        confidence=min(0.82, confidence),
                        notes=["derived from bridge command name"],
                    )
                    nkey = (native.binding_id, native.effect_type, native.effect_target, native.start_line)
                    if nkey not in seen:
                        seen.add(nkey)
                        out.append(native)

    return out
