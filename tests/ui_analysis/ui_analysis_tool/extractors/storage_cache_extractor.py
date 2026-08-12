from __future__ import annotations

import re
from typing import List

from ui_analysis_tool.extractors.state_extractor import get_handler_context, _module_text_map
from ui_analysis_tool.models import CacheOperationRecord, EventBindingRecord, JsModuleRecord, StorageOperationRecord
from ui_analysis_tool.utils.text_utils import line_no_at

STORAGE_RE = re.compile(r"\b(?P<storage>sessionStorage|localStorage)\.(?P<operation>getItem|setItem|removeItem|clear)\s*\((?P<args>[^)]*)\)", re.M)
CACHE_RE = re.compile(r"\b(?P<cache>[A-Z_]*CACHE|[A-Za-z_$][\w$]*Cache|cache[A-Za-z_$][\w$]*)\.(?P<operation>get|set|has|delete|clear)\s*\(", re.M)
NEW_MAP_RE = re.compile(r"\b(?P<name>[A-Za-z_$][\w$]*CACHE|[A-Za-z_$][\w$]*Cache|cache[A-Za-z_$][\w$]*)\s*=\s*new\s+(Map|Set)\s*\(", re.M)


def _line_context(text: str, start: int, span: int = 220) -> str:
    return re.sub(r"\s+", " ", text[start:start + span]).strip()


def _extract_storage_key(args: str) -> str:
    m = re.search(r"['\"]([^'\"]+)['\"]", args or "")
    return m.group(1) if m else ""


def extract_storage_operations(bindings: List[EventBindingRecord], js_modules: List[JsModuleRecord]) -> List[StorageOperationRecord]:
    out: List[StorageOperationRecord] = []
    seen = set()
    module_texts = _module_text_map(js_modules)
    body_cache = {}
    for binding in bindings:
        context, start_line = get_handler_context(binding, js_modules, module_texts, body_cache)
        for m in STORAGE_RE.finditer(context):
            storage = m.group("storage")
            operation = m.group("operation")
            key = _extract_storage_key(m.group("args"))
            storage_ref = f"{storage}.{key}" if key else storage
            local_line = line_no_at(context, m.start())
            line = start_line + local_line - 1
            rec = StorageOperationRecord(
                storage_op_id=f"storage::{binding.binding_id}:{storage_ref}:{operation}:L{line}",
                storage_ref=storage_ref,
                operation=operation,
                handler_id=binding.handler.handler_id,
                binding_id=binding.binding_id,
                file_path=binding.handler.file_path,
                relative_path=binding.handler.relative_path,
                start_line=line,
                confidence=0.9 if key else 0.75,
                evidence=_line_context(context, m.start()),
            )
            dedupe = (rec.binding_id, rec.storage_ref, rec.operation, rec.start_line)
            if dedupe not in seen:
                seen.add(dedupe)
                out.append(rec)
    return out


def extract_cache_operations(bindings: List[EventBindingRecord], js_modules: List[JsModuleRecord]) -> List[CacheOperationRecord]:
    out: List[CacheOperationRecord] = []
    seen = set()
    module_texts = _module_text_map(js_modules)
    body_cache = {}
    for binding in bindings:
        context, start_line = get_handler_context(binding, js_modules, module_texts, body_cache)
        for m in CACHE_RE.finditer(context):
            cache_ref = m.group("cache")
            operation = m.group("operation")
            local_line = line_no_at(context, m.start())
            line = start_line + local_line - 1
            rec = CacheOperationRecord(
                cache_op_id=f"cache::{binding.binding_id}:{cache_ref}:{operation}:L{line}",
                cache_ref=cache_ref,
                operation=operation,
                handler_id=binding.handler.handler_id,
                binding_id=binding.binding_id,
                file_path=binding.handler.file_path,
                relative_path=binding.handler.relative_path,
                start_line=line,
                confidence=0.75,
                evidence=_line_context(context, m.start()),
            )
            dedupe = (rec.binding_id, rec.cache_ref, rec.operation, rec.start_line)
            if dedupe not in seen:
                seen.add(dedupe)
                out.append(rec)
        for m in NEW_MAP_RE.finditer(context):
            cache_ref = m.group("name")
            operation = "create"
            local_line = line_no_at(context, m.start())
            line = start_line + local_line - 1
            rec = CacheOperationRecord(
                cache_op_id=f"cache::{binding.binding_id}:{cache_ref}:{operation}:L{line}",
                cache_ref=cache_ref,
                operation=operation,
                handler_id=binding.handler.handler_id,
                binding_id=binding.binding_id,
                file_path=binding.handler.file_path,
                relative_path=binding.handler.relative_path,
                start_line=line,
                confidence=0.7,
                evidence=_line_context(context, m.start()),
            )
            dedupe = (rec.binding_id, rec.cache_ref, rec.operation, rec.start_line)
            if dedupe not in seen:
                seen.add(dedupe)
                out.append(rec)
    return out
