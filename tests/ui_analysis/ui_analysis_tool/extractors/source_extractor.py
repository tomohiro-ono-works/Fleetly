from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

from ui_analysis_tool.models import HtmlPageRecord, JsModuleRecord
from ui_analysis_tool.utils.text_utils import line_no_at

VAR_ASSIGN_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)",
    re.M,
)
GET_BY_ID_RE = re.compile(r"document\.getElementById\(\s*['\"]([^'\"]+)['\"]\s*\)")
QUERY_SELECTOR_RE = re.compile(r"(?:document|[^.\s]+)\.querySelector\(\s*['\"]([^'\"]+)['\"]\s*\)")
CREATE_ELEMENT_RE = re.compile(r"document\.createElement\(\s*['\"]([^'\"]+)['\"]\s*\)")
GET_CONTEXT_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.getContext\(\s*['\"]2d['\"]\s*\)")
CLASS_CANVAS_RE = re.compile(r"\b([A-Za-z_$][\w$]*)\.className\s*=\s*['\"][^'\"]*canvas[^'\"]*['\"]")


@dataclass
class SourceIndex:
    html_canvas_ids: set[str] = field(default_factory=set)
    html_dom_ids: set[str] = field(default_factory=set)
    # relative_path -> variable -> (source_type, source_ref, dom_id, confidence)
    js_var_sources: Dict[str, Dict[str, Tuple[str, str, str, float]]] = field(default_factory=dict)


def build_source_index(html_pages: List[HtmlPageRecord], js_modules: List[JsModuleRecord]) -> SourceIndex:
    index = SourceIndex()
    for page in html_pages:
        index.html_dom_ids.update(page.dom_ids)
        for canvas in page.canvas_nodes:
            if canvas and not canvas.startswith("canvas["):
                index.html_canvas_ids.add(canvas)

    for module in js_modules:
        path = Path(module.file_path)
        text = path.read_text(encoding="utf-8", errors="replace")
        var_map: Dict[str, Tuple[str, str, str, float]] = {}
        for m in VAR_ASSIGN_RE.finditer(text):
            var_name = m.group(1)
            expr = m.group(2).strip()
            source_type, source_ref, dom_id, confidence = classify_expression(expr, index)
            if source_ref:
                var_map[var_name] = (source_type, source_ref, dom_id, confidence)
        for m in GET_CONTEXT_RE.finditer(text):
            var_name = m.group(1)
            current = var_map.get(var_name)
            if current:
                var_map[var_name] = ("canvas", current[1], current[2], max(current[3], 0.95))
            else:
                var_map[var_name] = ("canvas", var_name, "", 0.8)
        for m in CLASS_CANVAS_RE.finditer(text):
            var_name = m.group(1)
            current = var_map.get(var_name)
            if current:
                var_map[var_name] = ("canvas", current[1], current[2], max(current[3], 0.9))
            else:
                var_map[var_name] = ("canvas", var_name, "", 0.75)
        index.js_var_sources[module.relative_path] = var_map
    return index


def classify_expression(expr: str, index: SourceIndex) -> Tuple[str, str, str, float]:
    expr = str(expr or "").strip()
    if not expr:
        return "dom", "", "", 0.0
    if expr == "window" or expr.startswith("window."):
        return "window", "window", "", 1.0
    if expr == "document" or expr.startswith("document."):
        # querySelector/getElementById/createElement below can refine this.
        pass
    m = CREATE_ELEMENT_RE.search(expr)
    if m:
        tag = m.group(1).lower()
        if tag == "canvas":
            return "canvas", "created:<canvas>", "", 0.98
        return "dom", f"created:<{tag}>", "", 0.9
    m = GET_BY_ID_RE.search(expr)
    if m:
        dom_id = m.group(1)
        if dom_id in index.html_canvas_ids:
            return "canvas", f"#{dom_id}", dom_id, 0.98
        return "dom", f"#{dom_id}", dom_id, 0.9
    m = QUERY_SELECTOR_RE.search(expr)
    if m:
        sel = m.group(1)
        if "canvas" in sel.lower():
            return "canvas", sel, "", 0.9
        if sel.startswith("#"):
            dom_id = sel[1:]
            if dom_id in index.html_canvas_ids:
                return "canvas", sel, dom_id, 0.95
        return "dom", sel, sel[1:] if sel.startswith("#") else "", 0.8
    if expr in {"window", "document"}:
        return expr, expr, "", 1.0
    if expr.lower() == "canvas" or "canvas" in expr.lower():
        return "canvas", expr, "", 0.7
    return "dom", expr, "", 0.45


def classify_source_ref(source_expr: str, relative_path: str, source_index: SourceIndex) -> Tuple[str, str, str, float, List[str]]:
    expr = str(source_expr or "").strip()
    notes: List[str] = []
    if expr == "window":
        return "window", "window", "", 1.0, notes
    if expr == "document":
        return "document", "document", "", 1.0, notes
    if expr in source_index.js_var_sources.get(relative_path, {}):
        source_type, ref, dom_id, confidence = source_index.js_var_sources[relative_path][expr]
        return source_type, ref, dom_id, confidence, notes
    source_type, ref, dom_id, confidence = classify_expression(expr, source_index)
    if confidence < 0.6:
        notes.append("source type is heuristic; variable origin was not fully resolved")
    return source_type, ref or expr, dom_id, confidence, notes


def find_line_context(text: str, start: int, span: int = 220) -> str:
    raw = text[start:start + span]
    return re.sub(r"\s+", " ", raw).strip()
