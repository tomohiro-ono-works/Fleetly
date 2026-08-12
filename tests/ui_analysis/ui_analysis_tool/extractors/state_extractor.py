from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from ui_analysis_tool.models import EventBindingRecord, JsModuleRecord, StateOperationRecord
from ui_analysis_tool.utils.text_utils import compact_ws, line_no_at

STATE_REF_RE = re.compile(
    r"\b(?P<prefix>state|view|runtime|homeViewModel|dialogState|bridgeState|stateOps|modeStates)\.(?P<prop>[A-Za-z_$][\w$]*)",
    re.M,
)
WINDOW_STATE_RE = re.compile(r"\bwindow\.(?P<prop>__[A-Za-z_$][\w$]*|ziz[A-Za-z_$][\w$]*|ui[A-Za-z_$][\w$]*)", re.M)
STORAGE_REF_RE = re.compile(r"\b(?P<storage>sessionStorage|localStorage)\.(?P<op>getItem|setItem|removeItem|clear)\s*\(", re.M)
CACHE_NAME_RE = re.compile(r"\b(?P<name>[A-Z_]*CACHE|[A-Za-z_$][\w$]*Cache|cache[A-Za-z_$][\w$]*)\b", re.M)
DIRECT_RUNTIME_RE = re.compile(r"\b(?P<name>pending|ready|backend|currentRunId|lastRunSummary|persistTimer|activeMode|copiedNodeSnapshot)\b", re.M)

ASSIGN_AFTER_RE = re.compile(r"^\s*(?:=|\+\=|\-\=|\|\||&&|\?\?)")
MUTATION_AFTER_RE = re.compile(r"^\s*\.(?:push|pop|shift|unshift|splice|set|delete|clear|add)\s*\(")


def _module_text_map(js_modules: List[JsModuleRecord]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for module in js_modules:
        try:
            out[module.relative_path] = Path(module.file_path).read_text(encoding="utf-8", errors="replace")
        except OSError:
            out[module.relative_path] = ""
    return out


def _find_matching_brace(text: str, open_pos: int) -> int:
    depth = 0
    quote = ""
    esc = False
    i = open_pos
    while i < len(text):
        ch = text[i]
        if quote:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == quote:
                quote = ""
            i += 1
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            i += 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth <= 0:
                return i + 1
        i += 1
    return min(len(text), open_pos + 2000)


def _extract_braced_from(text: str, start: int, max_chars: int = 8000) -> str:
    open_pos = text.find("{", start)
    if open_pos < 0 or open_pos - start > max_chars:
        return text[start:start + min(max_chars, len(text) - start)]
    end = _find_matching_brace(text, open_pos)
    return text[start:min(end, start + max_chars)]


def _find_named_handler_body(text: str, handler_name: str) -> Tuple[str, int]:
    if not handler_name or "@" in handler_name:
        return "", 1
    escaped = re.escape(handler_name)
    patterns = [
        re.compile(rf"\bfunction\s+{escaped}\s*\([^)]*\)\s*\{{", re.M),
        re.compile(rf"\b(?:const|let|var)\s+{escaped}\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{{", re.M),
        re.compile(rf"\b(?:const|let|var)\s+{escaped}\s*=\s*function\s*\([^)]*\)\s*\{{", re.M),
        re.compile(rf"\b{escaped}\s*:\s*(?:async\s*)?function\s*\([^)]*\)\s*\{{", re.M),
        re.compile(rf"\b{escaped}\s*\([^)]*\)\s*\{{", re.M),
    ]
    for pat in patterns:
        m = pat.search(text)
        if m:
            return _extract_braced_from(text, m.start()), line_no_at(text, m.start())
    return "", 1


def _line_context(text: str, start: int, span: int = 220) -> str:
    return re.sub(r"\s+", " ", text[start:start + span]).strip()


def get_handler_context(
    binding: EventBindingRecord,
    js_modules: List[JsModuleRecord],
    module_texts: Dict[str, str] | None = None,
    body_cache: Dict[tuple[str, str], Tuple[str, int]] | None = None,
) -> Tuple[str, int]:
    """Return text context for a binding's handler.

    Prefer named function body when resolvable. Fall back to a local window around
    the event binding line. This keeps Phase 4 useful without requiring a full JS AST.

    module_texts/body_cache are optional performance caches used by Phase 4 extractors.
    """
    if module_texts is None:
        module_texts = _module_text_map(js_modules)
    if body_cache is None:
        body_cache = {}

    text = module_texts.get(binding.handler.relative_path, "")
    if not text:
        return binding.evidence, binding.handler.start_line

    cache_key = (binding.handler.relative_path, binding.handler.handler_name)
    if cache_key in body_cache:
        body, line = body_cache[cache_key]
    else:
        body, line = _find_named_handler_body(text, binding.handler.handler_name)
        body_cache[cache_key] = (body, line)

    if body:
        return body, line

    lines = text.splitlines()
    start = max(0, binding.handler.start_line - 6)
    end = min(len(lines), binding.handler.start_line + 25)
    return "\n".join(lines[start:end]), start + 1


def classify_state_kind(state_ref: str) -> str:
    ref = str(state_ref or "")
    if ref.startswith("state.") or ref.startswith("modeStates") or ref.startswith("stateOps."):
        return "persistent_state"
    if ref.startswith("view.") or ref.startswith("homeViewModel.") or ref.startswith("dialogState."):
        return "view_state"
    if ref.startswith("sessionStorage") or ref.startswith("localStorage"):
        return "storage_state"
    if "CACHE" in ref or "Cache" in ref or ref.lower().startswith("cache"):
        return "cache_state"
    return "runtime_state"


def _change_kind(context_after: str, context_before: str = "") -> str:
    after = context_after or ""
    before = context_before or ""
    if ASSIGN_AFTER_RE.match(after):
        return "write"
    if MUTATION_AFTER_RE.match(after):
        return "write"
    if before.rstrip().endswith("delete"):
        return "delete"
    return "read"


def _make_state_op(
    *,
    state_ref: str,
    change_kind: str,
    binding: EventBindingRecord,
    context_text: str,
    context_start_line: int,
    match_start: int,
    confidence: float,
    notes: List[str] | None = None,
) -> StateOperationRecord:
    local_line = line_no_at(context_text, match_start)
    line = context_start_line + local_line - 1
    op_id = f"stateop::{binding.binding_id}::{state_ref}:{change_kind}:L{line}"
    return StateOperationRecord(
        state_op_id=op_id,
        state_ref=state_ref,
        state_kind=classify_state_kind(state_ref),
        change_kind=change_kind,
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


def extract_state_operations(bindings: List[EventBindingRecord], js_modules: List[JsModuleRecord]) -> List[StateOperationRecord]:
    out: List[StateOperationRecord] = []
    seen = set()
    module_texts = _module_text_map(js_modules)
    body_cache: Dict[tuple[str, str], Tuple[str, int]] = {}

    for binding in bindings:
        context, start_line = get_handler_context(binding, js_modules, module_texts, body_cache)

        for m in STATE_REF_RE.finditer(context):
            state_ref = f"{m.group('prefix')}.{m.group('prop')}"
            after = context[m.end():m.end() + 40]
            before = context[max(0, m.start() - 20):m.start()]
            change = _change_kind(after, before)
            record = _make_state_op(
                state_ref=state_ref,
                change_kind=change,
                binding=binding,
                context_text=context,
                context_start_line=start_line,
                match_start=m.start(),
                confidence=0.76 if change != "read" else 0.62,
            )
            key = (record.binding_id, record.state_ref, record.change_kind, record.start_line)
            if key not in seen:
                seen.add(key)
                out.append(record)

        for m in WINDOW_STATE_RE.finditer(context):
            state_ref = f"window.{m.group('prop')}"
            after = context[m.end():m.end() + 40]
            record = _make_state_op(
                state_ref=state_ref,
                change_kind=_change_kind(after),
                binding=binding,
                context_text=context,
                context_start_line=start_line,
                match_start=m.start(),
                confidence=0.58,
                notes=["window global state; classify as runtime_state unless refined later"],
            )
            key = (record.binding_id, record.state_ref, record.change_kind, record.start_line)
            if key not in seen:
                seen.add(key)
                out.append(record)

        for m in STORAGE_REF_RE.finditer(context):
            storage_ref = f"{m.group('storage')}.{m.group('op')}"
            op = m.group("op")
            change = "write" if op in {"setItem", "removeItem", "clear"} else "read"
            record = _make_state_op(
                state_ref=storage_ref,
                change_kind=change,
                binding=binding,
                context_text=context,
                context_start_line=start_line,
                match_start=m.start(),
                confidence=0.9,
            )
            key = (record.binding_id, record.state_ref, record.change_kind, record.start_line)
            if key not in seen:
                seen.add(key)
                out.append(record)

        for m in CACHE_NAME_RE.finditer(context):
            name = m.group("name")
            after = context[m.end():m.end() + 40]
            if not re.match(r"^\s*\.(?:get|set|has|delete|clear)\s*\(", after):
                continue
            record = _make_state_op(
                state_ref=name,
                change_kind=_change_kind(after),
                binding=binding,
                context_text=context,
                context_start_line=start_line,
                match_start=m.start(),
                confidence=0.7,
            )
            key = (record.binding_id, record.state_ref, record.change_kind, record.start_line)
            if key not in seen:
                seen.add(key)
                out.append(record)

        for m in DIRECT_RUNTIME_RE.finditer(context):
            name = m.group("name")
            # Avoid duplicating property references already captured as prefix.prop.
            before = context[max(0, m.start() - 1):m.start()]
            after = context[m.end():m.end() + 40]
            if before == ".":
                continue
            record = _make_state_op(
                state_ref=name,
                change_kind=_change_kind(after),
                binding=binding,
                context_text=context,
                context_start_line=start_line,
                match_start=m.start(),
                confidence=0.46,
                notes=["bare runtime variable; heuristic"],
            )
            key = (record.binding_id, record.state_ref, record.change_kind, record.start_line)
            if key not in seen:
                seen.add(key)
                out.append(record)

    return out
