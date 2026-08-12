from __future__ import annotations

import re
from pathlib import Path
from typing import List

from ui_analysis_tool.models import FileRecord, JsFunctionRecord, JsModuleRecord
from ui_analysis_tool.utils.text_utils import line_no_at

FUNC_DECL_RE = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
ARROW_OR_FUNC_ASSIGN_RE = re.compile(
    r"\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\s*)?\(?[^=;{}]*\)?\s*=>|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*function\s*\(",
    re.M,
)
OBJECT_METHOD_RE = re.compile(r"(^|[,{]\s*)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{", re.M)
IMPORT_RE = re.compile(r"\bimport\s+(?:[^'\"]+\s+from\s+)?['\"]([^'\"]+)['\"]")
EXPORT_RE = re.compile(r"\bexport\s+(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)")
WINDOW_ASSIGN_RE = re.compile(r"\bwindow\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=")
PACKAGE_ASSIGN_RE = re.compile(r"\b(?:packages|uiPkg|corePkg|nodeCanvasParts|shared)\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=")
EVENT_LIKE_RE = re.compile(r"\b(addEventListener|dispatchEvent|CustomEvent|setTimeout|setInterval|requestAnimationFrame)\b")
CANVAS_INDICATOR_RE = re.compile(r"\b(createElement\(['\"]canvas['\"]\)|getContext\(['\"]2d['\"]\)|\.className\s*=\s*['\"]flow-canvas['\"]|drawFlowCanvas|requestDraw)\b")


def _function_record(name: str, path: Path, relative_path: str, text: str, match_start: int, kind: str) -> JsFunctionRecord:
    start_line = line_no_at(text, match_start)
    return JsFunctionRecord(
        handler_id=f"{relative_path}::{name}@L{start_line}",
        handler_name=name,
        handler_kind=kind,
        file_path=str(path),
        relative_path=relative_path,
        start_line=start_line,
        end_line=start_line,
        confidence=0.65,
    )


def extract_js_functions(text: str, path: Path, relative_path: str) -> List[JsFunctionRecord]:
    records: List[JsFunctionRecord] = []
    seen = set()

    for m in FUNC_DECL_RE.finditer(text):
        name = m.group(1)
        key = (name, m.start())
        if key not in seen:
            records.append(_function_record(name, path, relative_path, text, m.start(), "function"))
            seen.add(key)

    for m in ARROW_OR_FUNC_ASSIGN_RE.finditer(text):
        name = m.group(1) or m.group(2)
        if not name:
            continue
        key = (name, m.start())
        if key not in seen:
            records.append(_function_record(name, path, relative_path, text, m.start(), "assigned_function"))
            seen.add(key)

    # Conservative object-method detection: useful for public API object literals.
    for m in OBJECT_METHOD_RE.finditer(text):
        name = m.group(2)
        if name in {"if", "for", "while", "switch", "catch", "function"}:
            continue
        key = (name, m.start())
        if key not in seen:
            records.append(_function_record(name, path, relative_path, text, m.start(), "object_method"))
            seen.add(key)

    records.sort(key=lambda r: (r.start_line, r.handler_name))
    return records


def collect_js_inventory(files: List[FileRecord]) -> List[JsModuleRecord]:
    modules: List[JsModuleRecord] = []
    for f in files:
        if f.file_type != "js":
            continue
        path = Path(f.file_path)
        text = path.read_text(encoding="utf-8", errors="replace")
        imports = sorted(set(IMPORT_RE.findall(text)))
        exports = sorted(set(EXPORT_RE.findall(text)))
        global_assignments = sorted(set(WINDOW_ASSIGN_RE.findall(text)))
        package_assignments = sorted(set(PACKAGE_ASSIGN_RE.findall(text)))
        event_like_terms = sorted(set(EVENT_LIKE_RE.findall(text)))
        canvas_indicators = sorted(set(m.group(0) for m in CANVAS_INDICATOR_RE.finditer(text)))
        modules.append(
            JsModuleRecord(
                module_id=f.relative_path,
                file_path=f.file_path,
                relative_path=f.relative_path,
                functions=extract_js_functions(text, path, f.relative_path),
                imports=imports,
                exports=exports,
                global_assignments=global_assignments,
                package_assignments=package_assignments,
                event_like_terms=event_like_terms,
                canvas_indicators=canvas_indicators,
            )
        )
    return modules
