import copy
import re
import threading
from pathlib import Path


SECRET_FIELD_KEYS = frozenset({
    "file_path",
    "folder_path",
    "output_path",
    "directory",
    "output_folder",
    "output_dir",
    "bucket",
    "access_token",
    "api_key",
    "authorization",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "refresh_token",
    "secret",
})


def _safe_text(value):
    return str(value or "").strip()


class HiddenValueService:
    def __init__(self, *, lock=None):
        self._lock = lock or threading.RLock()
        self._sessions = {}

    @property
    def sessions(self):
        return self._sessions

    def clear_session(self, doc_session_id):
        session_id = self._normalize_session_id(doc_session_id)
        with self._lock:
            self._sessions[session_id] = self._new_session()

    def delete_session(self, doc_session_id):
        session_id = self._normalize_session_id(doc_session_id)
        with self._lock:
            self._sessions.pop(session_id, None)

    def get_values(self, doc_session_id):
        return self._ensure_session(doc_session_id)["values"]

    def get_meta(self, doc_session_id):
        return self._ensure_session(doc_session_id)["meta"]

    def hide_values(self, value, *, doc_session_id, current_step="global"):
        if isinstance(value, list):
            return [
                self.hide_values(
                    item,
                    doc_session_id=doc_session_id,
                    current_step=current_step,
                )
                for item in value
            ]
        if isinstance(value, dict):
            next_step = _safe_text(value.get("step_id")) or current_step
            output = {}
            for key, item in value.items():
                if (
                    self.is_secret_key(key)
                    and isinstance(item, (str, int, float))
                    and _safe_text(item)
                ):
                    ref, _ = self.store_value(
                        doc_session_id=doc_session_id,
                        step_name=next_step,
                        field_key=key,
                        actual_value=str(item),
                    )
                    output[key] = ref
                    continue
                output[key] = self.hide_values(
                    item,
                    doc_session_id=doc_session_id,
                    current_step=next_step,
                )
            return output
        return value

    def restore_values(self, value, *, doc_session_id):
        if isinstance(value, list):
            return [
                self.restore_values(item, doc_session_id=doc_session_id)
                for item in value
            ]
        if isinstance(value, dict):
            return {
                key: self.restore_values(item, doc_session_id=doc_session_id)
                for key, item in value.items()
            }
        if self.is_hidden_ref(value):
            return self.get_values(doc_session_id).get(str(value), value)
        return value

    def store_value(
        self,
        *,
        doc_session_id,
        step_name,
        field_key,
        actual_value,
        current_ref=None,
    ):
        session = self._ensure_session(doc_session_id)
        values = session["values"]
        meta = session["meta"]
        ref = (
            current_ref
            if current_ref and current_ref in values
            else self._allocate_ref(session, step_name)
        )
        values[ref] = actual_value
        meta[ref] = self.build_meta(field_key, actual_value)
        return ref, copy.deepcopy(meta[ref])

    def resolve_picker_value(self, *, doc_session_id, current_ref, current_value):
        values = self.get_values(doc_session_id)
        if current_ref and current_ref in values:
            return values[current_ref]
        return str(current_value or "").strip()

    def build_meta(self, field_key, actual_value):
        text = _safe_text(actual_value)
        key = _safe_text(field_key)
        full_path = text
        if text:
            try:
                full_path = str(Path(text).expanduser().resolve())
            except OSError:
                full_path = text
        if key in {"file_path", "output_path"}:
            path = Path(text)
            return {
                "display_name": path.name or text,
                "display_hint": full_path,
            }
        if key in {"folder_path", "directory", "output_folder", "output_dir"}:
            path = Path(text)
            return {
                "display_name": path.name or text,
                "display_hint": full_path,
            }
        return {
            "display_name": key,
            "display_hint": "configured",
        }

    def collect_secret_values(self, value):
        collected = set()
        if isinstance(value, list):
            for item in value:
                collected.update(self.collect_secret_values(item))
            return collected
        if isinstance(value, dict):
            for key, item in value.items():
                if (
                    self.is_secret_key(key)
                    and isinstance(item, (str, int, float))
                    and _safe_text(item)
                ):
                    collected.add(str(item))
                collected.update(self.collect_secret_values(item))
        return collected

    def is_secret_key(self, key):
        return _safe_text(key) in SECRET_FIELD_KEYS

    def is_hidden_ref(self, value):
        return (
            isinstance(value, str)
            and re.fullmatch(r"\{\{hidden\.[^}]+\}\}", value.strip()) is not None
        )

    def _ensure_session(self, doc_session_id):
        session_id = self._normalize_session_id(doc_session_id)
        with self._lock:
            session = self._sessions.get(session_id)
            if not isinstance(session, dict):
                session = self._new_session()
                self._sessions[session_id] = session
            return session

    def _normalize_session_id(self, doc_session_id):
        session_id = _safe_text(doc_session_id)
        if not session_id:
            raise ValueError("doc_session_id は必須です。")
        return session_id

    def _allocate_ref(self, session, step_name):
        scope = re.sub(r"[^a-zA-Z0-9_]+", "_", _safe_text(step_name)) or "global"
        next_index = int(session["counters"].get(scope, 0)) + 1
        session["counters"][scope] = next_index
        return f"{{{{hidden.{scope}.var{next_index}}}}}"

    def _new_session(self):
        return {
            "values": {},
            "meta": {},
            "counters": {},
        }
