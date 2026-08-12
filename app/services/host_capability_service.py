import threading
from urllib.parse import urlsplit

from app.services.errors import ApplicationServiceError


def _safe_text(value):
    return str(value or "").strip()


class HostCapabilityService:
    def __init__(
        self,
        *,
        pick_file=None,
        pick_folder=None,
        edit_file=None,
        edit_folder=None,
        open_document=None,
        save_document=None,
        window_control=None,
        coordinate_capture=None,
        open_external=None,
        owner_thread_id=None,
    ):
        self._pick_file = pick_file
        self._pick_folder = pick_folder
        self._edit_file = edit_file
        self._edit_folder = edit_folder
        self._open_document = open_document
        self._save_document = save_document
        self._window_control = window_control
        self._coordinate_capture = coordinate_capture
        self._open_external = open_external
        self._owner_thread_id = int(
            owner_thread_id
            if owner_thread_id is not None
            else threading.get_ident()
        )

    @property
    def capabilities(self):
        output = set()
        if callable(self._pick_file) or callable(self._edit_file):
            output.add("file_picker")
        if callable(self._pick_folder) or callable(self._edit_folder):
            output.add("folder_picker")
        if callable(self._open_document):
            output.add("open_flow_dialog")
        if callable(self._save_document):
            output.add("save_flow_dialog")
        if callable(self._window_control):
            output.add("window_control")
        if callable(self._coordinate_capture):
            output.add("coordinate_capture")
        if callable(self._open_external):
            output.add("external_open")
        return frozenset(output)

    def supports(self, capability):
        return _safe_text(capability) in self.capabilities

    def pick_file(self, *, title, filters, current_value=""):
        current = _safe_text(current_value)
        if current and callable(self._edit_file):
            return self._invoke(
                "file_picker",
                self._edit_file,
                _safe_text(title),
                current,
                list(filters or []),
            )
        callback = self._pick_file or self._edit_file
        args = (
            (_safe_text(title), list(filters or []))
            if callback is self._pick_file
            else (_safe_text(title), current, list(filters or []))
        )
        return self._invoke("file_picker", callback, *args)

    def pick_folder(self, *, title, current_value="", edit_current=True):
        current = _safe_text(current_value)
        if edit_current and current and callable(self._edit_folder):
            return self._invoke(
                "folder_picker",
                self._edit_folder,
                _safe_text(title),
                current,
            )
        callback = self._pick_folder or self._edit_folder
        args = (
            (_safe_text(title),)
            if callback is self._pick_folder
            else (_safe_text(title), current)
        )
        return self._invoke("folder_picker", callback, *args)

    def open_document(self):
        return self._invoke(
            "open_flow_dialog",
            self._open_document,
        )

    def save_document(self, mode, suggested_name, current_path=None):
        return self._invoke(
            "save_flow_dialog",
            self._save_document,
            mode,
            suggested_name,
            current_path,
        )

    def control_window(self, action):
        normalized = _safe_text(action).lower()
        if normalized not in {"minimize", "maximize", "close", "drag"}:
            raise ValueError("action が不正です。")
        state = self._invoke(
            "window_control",
            self._window_control,
            normalized,
        )
        return {
            "accepted": True,
            "action": normalized,
            "state": _safe_text(state),
        }

    def start_coordinate_capture(self, capture_id):
        normalized = _safe_text(capture_id)
        if not normalized:
            raise ValueError("capture_id は必須です。")
        started = self._invoke(
            "coordinate_capture",
            self._coordinate_capture,
            normalized,
        )
        if started is False:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "座標取得を開始できませんでした。",
            )
        return {"started": True, "capture_id": normalized}

    def open_external(self, *, url, prefer="chrome"):
        normalized_url = self._validate_external_url(url)
        normalized_prefer = _safe_text(prefer).lower() or "chrome"
        if normalized_prefer not in {"chrome", "default", "default-browser"}:
            raise ValueError("prefer が不正です。")
        opened_via = self._invoke(
            "external_open",
            self._open_external,
            normalized_url,
            normalized_prefer,
        )
        return {
            "accepted": True,
            "url": normalized_url,
            "opened_via": _safe_text(opened_via),
        }

    def _invoke(self, capability, callback, *args):
        if not callable(callback):
            raise ApplicationServiceError(
                "E_NOT_READY",
                "必要なhost capabilityが利用できません。",
            )
        if threading.get_ident() != self._owner_thread_id:
            raise ApplicationServiceError(
                "E_NOT_READY",
                "host capabilityはGUI threadで実行してください。",
            )
        return callback(*args)

    def _validate_external_url(self, value):
        text = _safe_text(value)
        try:
            parsed = urlsplit(text)
        except ValueError as error:
            raise ValueError("url の形式が不正です。") from error
        if (
            parsed.scheme.lower() not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
        ):
            raise ValueError(
                "url は認証情報を含まない http/https URLで指定してください。"
            )
        return text
