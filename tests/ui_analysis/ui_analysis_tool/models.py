from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List

TOOL_VERSION = "0.7.0-phase1234567"
SCHEMA_VERSION = "1.0.0"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "__dataclass_fields__"):
        return asdict(value)
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    return value


@dataclass
class Envelope:
    project_root: str
    data: Any
    schema_version: str = SCHEMA_VERSION
    generated_at: str = field(default_factory=now_iso)
    tool_version: str = TOOL_VERSION

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "generated_at": self.generated_at,
            "project_root": self.project_root,
            "tool_version": self.tool_version,
            "data": to_jsonable(self.data),
        }


@dataclass
class FileRecord:
    file_id: str
    file_path: str
    relative_path: str
    file_type: str
    size_bytes: int
    sha1: str


@dataclass
class HtmlScriptRef:
    src: str
    resolved_path: str = ""
    relative_resolved_path: str = ""
    exists: bool = False
    order: int = 0


@dataclass
class HtmlPageRecord:
    page_id: str
    file_path: str
    relative_path: str
    title: str = ""
    body_dataset: Dict[str, str] = field(default_factory=dict)
    dom_ids: List[str] = field(default_factory=list)
    scripts: List[HtmlScriptRef] = field(default_factory=list)
    inline_script_count: int = 0
    canvas_nodes: List[str] = field(default_factory=list)
    data_attrs: Dict[str, Dict[str, str]] = field(default_factory=dict)


@dataclass
class JsFunctionRecord:
    handler_id: str
    handler_name: str
    handler_kind: str
    file_path: str
    relative_path: str
    start_line: int = 1
    end_line: int = 1
    confidence: float = 0.6


@dataclass
class JsModuleRecord:
    module_id: str
    file_path: str
    relative_path: str
    functions: List[JsFunctionRecord] = field(default_factory=list)
    imports: List[str] = field(default_factory=list)
    exports: List[str] = field(default_factory=list)
    global_assignments: List[str] = field(default_factory=list)
    package_assignments: List[str] = field(default_factory=list)
    event_like_terms: List[str] = field(default_factory=list)
    canvas_indicators: List[str] = field(default_factory=list)


@dataclass
class ProjectLinkRecord:
    from_ref: str
    to_ref: str
    link_type: str
    exists: bool = True
    notes: List[str] = field(default_factory=list)


@dataclass
class ProjectInventory:
    pages: List[str]
    modules: List[str]
    links: List[ProjectLinkRecord]
    unresolved_scripts: List[ProjectLinkRecord] = field(default_factory=list)
    counts: Dict[str, int] = field(default_factory=dict)


@dataclass
class AnalysisRunSummary:
    root_path: str
    out_path: str
    file_count: int
    html_count: int
    js_count: int
    html_script_count: int
    resolved_script_count: int
    unresolved_script_count: int
    function_count: int
    canvas_node_count: int
    trigger_count: int = 0
    source_count: int = 0
    handler_count: int = 0
    binding_count: int = 0
    canvas_source_count: int = 0
    window_source_count: int = 0
    document_source_count: int = 0
    state_operation_count: int = 0
    effect_count: int = 0
    storage_operation_count: int = 0
    cache_operation_count: int = 0
    canvas_redraw_effect_count: int = 0
    layout_recalc_effect_count: int = 0
    bridge_call_effect_count: int = 0
    dom_update_effect_count: int = 0


@dataclass
class TriggerRecord:
    trigger_id: str
    trigger_type: str
    trigger_name: str
    event_name: str = ""
    source_id: str = ""
    handler_id: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    confidence: float = 0.6
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class SourceRecord:
    source_id: str
    source_type: str
    source_ref: str
    selector: str = ""
    dom_id: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    confidence: float = 0.6
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class HandlerRecord:
    handler_id: str
    handler_name: str
    handler_kind: str
    trigger_id: str = ""
    source_id: str = ""
    source_ref: str = ""
    trigger_name: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    end_line: int = 1
    confidence: float = 0.6
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class EventBindingRecord:
    binding_id: str
    trigger: TriggerRecord
    source: SourceRecord
    handler: HandlerRecord
    binding_kind: str
    evidence: str = ""


@dataclass
class ExtractedRuntimeSummary:
    trigger_count: int
    source_count: int
    handler_count: int
    binding_count: int
    canvas_source_count: int
    window_source_count: int
    document_source_count: int
    internal_event_count: int
    scheduler_count: int


@dataclass
class StateOperationRecord:
    state_op_id: str
    state_ref: str
    state_kind: str
    change_kind: str
    handler_id: str = ""
    binding_id: str = ""
    trigger_id: str = ""
    source_id: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    confidence: float = 0.55
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class EffectRecord:
    effect_id: str
    effect_type: str
    effect_target: str
    handler_id: str = ""
    binding_id: str = ""
    trigger_id: str = ""
    source_id: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    confidence: float = 0.55
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class StorageOperationRecord:
    storage_op_id: str
    storage_ref: str
    operation: str
    state_kind: str = "storage_state"
    handler_id: str = ""
    binding_id: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    confidence: float = 0.7
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class CacheOperationRecord:
    cache_op_id: str
    cache_ref: str
    operation: str
    state_kind: str = "cache_state"
    handler_id: str = ""
    binding_id: str = ""
    file_path: str = ""
    relative_path: str = ""
    start_line: int = 1
    confidence: float = 0.65
    evidence: str = ""
    notes: List[str] = field(default_factory=list)


@dataclass
class StateEffectExtractionSummary:
    state_operation_count: int
    effect_count: int
    storage_operation_count: int
    cache_operation_count: int
    persistent_state_count: int
    view_state_count: int
    runtime_state_count: int
    storage_state_count: int
    cache_state_count: int
    dom_update_effect_count: int
    canvas_redraw_effect_count: int
    layout_recalc_effect_count: int
    bridge_call_effect_count: int
    native_call_effect_count: int
    api_call_effect_count: int
    route_change_effect_count: int
    log_output_effect_count: int
