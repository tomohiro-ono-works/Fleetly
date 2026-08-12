import copy
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

from app.services.errors import ApplicationServiceError
from app.services.yaml_document_serializer import dump_workflow_document
from core.flow_locator import (
    has_flow_extension,
    list_flows_local,
    list_templates_local,
    register_recent_flow,
)


MODE_EXTENSIONS = {
    "dataflow": ".zizd",
}


def _safe_text(value):
    return str(value or "").strip()


class DocumentService:
    def __init__(
        self,
        workspace_service,
        hidden_value_service,
        *,
        open_document_callback=None,
        save_document_callback=None,
        close_callback=None,
        lock=None,
        list_recent_documents=None,
        list_template_documents=None,
        register_recent_document=None,
    ):
        self.workspace_service = workspace_service
        self.hidden_value_service = hidden_value_service
        self.open_document_callback = open_document_callback
        self.save_document_callback = save_document_callback
        self.close_callback = close_callback
        self.list_recent_documents = list_recent_documents or list_flows_local
        self.list_template_documents = (
            list_template_documents or list_templates_local
        )
        self.register_recent_document = (
            register_recent_document or register_recent_flow
        )
        self._lock = lock or threading.RLock()
        self._document_tokens = {}
        self._sessions = {}

    def list_documents(self, *, scope="local", kind="recent"):
        normalized_scope = _safe_text(scope) or "local"
        normalized_kind = _safe_text(kind) or "recent"
        if normalized_scope not in {"local", "workspace"}:
            raise ValueError("scope が不正です。")
        if normalized_kind not in {"recent", "template"}:
            raise ValueError("kind が不正です。")
        source_items = (
            self.list_template_documents()
            if normalized_kind == "template"
            else self.list_recent_documents()
        )
        items = []
        for item in source_items:
            path = _safe_text(item.get("path"))
            if not path:
                continue
            items.append({
                "document_token": self._register_document_token(path),
                "display_name": _safe_text(item.get("filename")),
                "display_hint": _safe_text(item.get("directory")),
                "modified_at": self._to_iso_datetime(item.get("modified_at")),
            })
        return {
            "scope": normalized_scope,
            "kind": normalized_kind,
            "items": items,
        }

    def load_document(
        self,
        *,
        doc_session_id,
        document_token=None,
        scope=None,
        rel_path=None,
    ):
        session_id = self._require_session_id(doc_session_id)
        token = _safe_text(document_token)
        has_scope = bool(_safe_text(scope))
        has_rel_path = rel_path is not None and bool(_safe_text(rel_path))
        if has_scope != has_rel_path:
            raise ValueError("scope と rel_path は組で指定してください。")
        if token and has_scope:
            raise ValueError(
                "document_token と scope／rel_path は同時に指定できません。"
            )
        if token:
            document_path = self._document_tokens.get(token)
            if not document_path:
                raise FileNotFoundError("対象のdocumentが見つかりません。")
        elif has_rel_path:
            _, target, _ = self.workspace_service.resolve_path(
                scope=scope,
                rel_path=rel_path,
                require_exists=True,
                expect_file=True,
            )
            document_path = str(target)
        else:
            document_path = (
                self.open_document_callback()
                if self.open_document_callback
                else None
            )
        if not document_path:
            return {"selected": False}

        resolved_path = Path(document_path).resolve()
        if not resolved_path.exists() or not resolved_path.is_file():
            raise FileNotFoundError("documentが見つかりません。")
        if not has_flow_extension(str(resolved_path)):
            raise ValueError("対応していないdocument形式です。")
        with resolved_path.open("r", encoding="utf-8") as handle:
            document = yaml.safe_load(handle) or {}
        if not isinstance(document, dict):
            raise ValueError("documentは辞書形式である必要があります。")

        with self._lock:
            previous = self._sessions.get(session_id) or {}
            previous_path = _safe_text(previous.get("path"))
            document_ref = (
                _safe_text(previous.get("document_ref"))
                if previous_path == str(resolved_path)
                else ""
            ) or self._new_document_ref()
            self.hidden_value_service.clear_session(session_id)
            frontend_document = self.hidden_value_service.hide_values(
                document,
                doc_session_id=session_id,
            )
            self._sessions[session_id] = {
                "doc_session_id": session_id,
                "document_ref": document_ref,
                "path": str(resolved_path),
                "file_name": resolved_path.name,
                "mode": self._resolve_mode(document, resolved_path.name),
                "mtime_ns": str(int(resolved_path.stat().st_mtime_ns)),
            }
            hidden_bindings = copy.deepcopy(
                self.hidden_value_service.get_meta(session_id)
            )
            session = copy.deepcopy(self._sessions[session_id])

        self.register_recent_document(
            str(resolved_path),
            opened_at_iso=self._iso_now(),
        )
        return {
            "selected": True,
            "mode": session["mode"],
            "file_name": session["file_name"],
            "document_ref": session["document_ref"],
            "document": frontend_document,
            "hidden_bindings": hidden_bindings,
            "mtime_ns": session["mtime_ns"],
        }

    def save_document(
        self,
        *,
        doc_session_id,
        document,
        mode=None,
        document_ref=None,
        file_name=None,
        scope=None,
        rel_path=None,
    ):
        session_id = self._require_session_id(doc_session_id)
        if not isinstance(document, dict):
            raise ValueError("documentはオブジェクトで指定してください。")
        with self._lock:
            existing = copy.deepcopy(self._sessions.get(session_id) or {})
        supplied_ref = _safe_text(document_ref)
        existing_ref = _safe_text(existing.get("document_ref"))
        if supplied_ref and existing_ref and supplied_ref != existing_ref:
            raise ValueError("document_ref がdoc_session_idと一致しません。")
        has_scope = bool(_safe_text(scope))
        has_rel_path = rel_path is not None and bool(_safe_text(rel_path))
        if has_scope != has_rel_path:
            raise ValueError("scope と rel_path は組で指定してください。")

        normalized_mode = _safe_text(mode) or _safe_text(existing.get("mode")) or "dataflow"
        restored_document = self.hidden_value_service.restore_values(
            copy.deepcopy(document),
            doc_session_id=session_id,
        )
        suggested_name = (
            _safe_text(file_name)
            or _safe_text(existing.get("file_name"))
            or self._build_default_file_name(normalized_mode)
        )
        current_path = _safe_text(existing.get("path"))

        if has_scope:
            _, target, _ = self.workspace_service.resolve_path(
                scope=scope,
                rel_path=rel_path,
                require_exists=False,
                for_write=True,
            )
            target_path = str(target)
        elif self.save_document_callback:
            target_path = self.save_document_callback(
                normalized_mode,
                suggested_name,
                current_path or None,
            )
        else:
            target_path = current_path
        if not target_path:
            return {
                "saved": False,
                "file_name": suggested_name,
                "document_ref": existing_ref or supplied_ref,
            }

        resolved_path = Path(target_path).resolve()
        if not has_flow_extension(str(resolved_path)):
            raise ValueError("対応していないdocument形式です。")
        current_resolved_path = (
            Path(current_path).resolve()
            if current_path
            else None
        )
        if (
            current_resolved_path == resolved_path
            and resolved_path.exists()
            and _safe_text(existing.get("mtime_ns"))
        ):
            expected_mtime_ns = int(existing["mtime_ns"])
            actual_mtime_ns = int(resolved_path.stat().st_mtime_ns)
            if expected_mtime_ns != actual_mtime_ns:
                raise ApplicationServiceError(
                    "E_CONFLICT",
                    "documentは外部で更新されています。",
                )
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        with resolved_path.open("w", encoding="utf-8") as handle:
            dump_workflow_document(
                restored_document,
                handle,
            )
        mtime_ns = str(int(resolved_path.stat().st_mtime_ns))

        resolved_ref = existing_ref or supplied_ref or self._new_document_ref()
        with self._lock:
            self._sessions[session_id] = {
                "doc_session_id": session_id,
                "document_ref": resolved_ref,
                "path": str(resolved_path),
                "file_name": resolved_path.name,
                "mode": normalized_mode,
                "mtime_ns": mtime_ns,
            }
        self.register_recent_document(
            str(resolved_path),
            opened_at_iso=self._iso_now(),
        )
        return {
            "saved": True,
            "file_name": resolved_path.name,
            "document_ref": resolved_ref,
            "mtime_ns": mtime_ns,
        }

    def close_document(self, *, doc_session_id):
        session_id = self._require_session_id(doc_session_id)
        if self.close_callback:
            self.close_callback(session_id)
        with self._lock:
            self._sessions.pop(session_id, None)
        self.hidden_value_service.delete_session(session_id)
        return {
            "closed": True,
            "doc_session_id": session_id,
        }

    def get_session(self, doc_session_id):
        session_id = self._require_session_id(doc_session_id)
        with self._lock:
            session = self._sessions.get(session_id)
            return copy.deepcopy(session) if isinstance(session, dict) else None

    def _register_document_token(self, path):
        normalized_path = str(Path(path).resolve())
        with self._lock:
            for token, stored_path in self._document_tokens.items():
                if stored_path == normalized_path:
                    return token
            token = f"doctok_{uuid.uuid4().hex}"
            self._document_tokens[token] = normalized_path
            return token

    def _require_session_id(self, doc_session_id):
        session_id = _safe_text(doc_session_id)
        if not session_id:
            raise ValueError("doc_session_id は必須です。")
        return session_id

    def _new_document_ref(self):
        return f"docref_{uuid.uuid4().hex}"

    def _build_default_file_name(self, mode):
        return f"フロー{MODE_EXTENSIONS.get(mode, '.zizd')}"

    def _resolve_mode(self, document, file_name):
        metadata = document.get("metadata") if isinstance(document, dict) else {}
        raw_mode = _safe_text((metadata or {}).get("mode"))
        if raw_mode in MODE_EXTENSIONS:
            return raw_mode
        suffix = Path(file_name).suffix.lower()
        for mode, extension in MODE_EXTENSIONS.items():
            if extension == suffix:
                return mode
        return "dataflow"

    def _to_iso_datetime(self, timestamp):
        try:
            numeric = float(timestamp or 0)
        except (TypeError, ValueError):
            numeric = 0
        return (
            datetime.fromtimestamp(numeric, tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )

    def _iso_now(self):
        return datetime.now(timezone.utc).isoformat()
