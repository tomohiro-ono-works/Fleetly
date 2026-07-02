import copy
import csv
import faulthandler
import getpass
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

import yaml
import pandas as pd
from PySide6.QtCore import QObject, Signal, Slot

from connectors.excel_connector import ExcelConnector
from core.type_registry import build_dataframe_schema
from core.workflow_engine import WorkflowEngine
from core.flow_locator import has_flow_extension, list_flows_local, list_templates_local, register_recent_flow
from core.security_policies import load_security_policies

logger = logging.getLogger("ziz.gui_bridge")


SECRET_FIELD_KEYS = {
    "file_path",
    "folder_path",
    "output_path",
    "directory",
    "output_folder",
    "output_dir",
    "bucket",
}

MODE_EXTENSIONS = {
    "dataflow": ".zizd",
}


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def _safe_text(value):
    return str(value or "").strip()


def _is_hidden_ref(value):
    return isinstance(value, str) and re.fullmatch(r"\{\{hidden\.[^}]+\}\}", value.strip()) is not None


def _sanitize_hidden_scope(step_name):
    text = re.sub(r"[^a-zA-Z0-9_]+", "_", _safe_text(step_name))
    return text or "global"


class BridgeApiError(Exception):
    def __init__(self, code, message):
        super().__init__(str(message or ""))
        self.code = str(code or "E_INTERNAL")
        self.message = str(message or "")


class _RunLogHandler(logging.Handler):
    def __init__(self, runtime, run_id):
        super().__init__(level=logging.INFO)
        self._runtime = runtime
        self._run_id = run_id

    def emit(self, record):
        try:
            message = self._runtime.mask_log_message(self._run_id, record.getMessage())
            self._runtime.emit_event("run.log", {
                "run_id": self._run_id,
                "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
                "level": record.levelname,
                "message": message,
            })
        except Exception:
            # ログ送信失敗で実行全体を落とさない
            return


class BridgeRuntime:
    PROTOCOL_VERSION = "1.0"

    def __init__(
        self,
        base_dir,
        *,
        debug=False,
        pick_file_callback=None,
        pick_folder_callback=None,
        edit_file_callback=None,
        edit_folder_callback=None,
        open_flow_callback=None,
        save_flow_callback=None,
        window_control_callback=None,
        coordinate_capture_callback=None,
    ):
        self.base_dir = Path(base_dir).resolve()
        self.debug = bool(debug)
        self.pick_file_callback = pick_file_callback
        self.pick_folder_callback = pick_folder_callback
        self.edit_file_callback = edit_file_callback
        self.edit_folder_callback = edit_folder_callback
        self.open_flow_callback = open_flow_callback
        self.save_flow_callback = save_flow_callback
        self.window_control_callback = window_control_callback
        self.coordinate_capture_callback = coordinate_capture_callback
        self._flow_tokens = {}
        self._event_sink = None
        self._lock = threading.RLock()

        self.current_flow_path = None
        self.current_file_name = ""
        self.current_mode = ""
        self._hidden_sessions = {}
        self.runs = {}
        self.latest_by_flow = {}
        self.active_run_by_flow = {}
        self._unsaved_flow_uuid = uuid.uuid4().hex
        self._execution_log_path = (self.base_dir / "logs" / "execution.log").resolve()
        self._execution_log_path.parent.mkdir(parents=True, exist_ok=True)
        self.workspace_root = None
        self.config_root = (self.base_dir / "config").resolve()

    def set_event_sink(self, callback):
        self._event_sink = callback

    def emit_event(self, message_type, payload):
        if not self._event_sink:
            return
        message = {
            "v": self.PROTOCOL_VERSION,
            "kind": "evt",
            "type": message_type,
            "ts": _iso_now(),
            "payload": payload or {},
        }
        self._event_sink(message)

    def handle_message(self, raw_text):
        try:
            message = json.loads(str(raw_text or ""))
        except Exception:
            return self._error_response(None, "unknown", "E_VALIDATION", "メッセージが JSON ではありません。")

        message_id = str(message.get("id") or "")
        message_type = str(message.get("type") or "")
        version = str(message.get("v") or "")
        kind = str(message.get("kind") or "")
        payload = message.get("payload") or {}
        workspace_error_types = {"workspace.getRoot", "workspace.setRoot", "workspace.readText", "workspace.writeText"}

        def _log_workspace_api_error(code, message_text):
            if message_type not in workspace_error_types:
                return
            safe_payload = payload if isinstance(payload, dict) else {}
            logger.error(
                "[workspace-api-error] type=%s code=%s message=%s scope=%s rel_path=%s root_path=%s",
                message_type,
                str(code or ""),
                str(message_text or ""),
                str(safe_payload.get("scope") or ""),
                str(safe_payload.get("rel_path") or ""),
                str(safe_payload.get("root_path") or ""),
            )

        if version != self.PROTOCOL_VERSION:
            return self._error_response(message_id, message_type, "E_CONTRACT_VERSION_MISMATCH", "プロトコルバージョンが一致しません。")
        if kind != "cmd":
            return self._error_response(message_id, message_type, "E_VALIDATION", "cmd メッセージのみ受け付けます。")

        try:
            if message_type in {"flow.save", "workspace.writeText"}:
                logger.info(
                    "[save-trace][bridge] recv type=%s payload=%s",
                    message_type,
                    json.dumps(payload, ensure_ascii=False, default=str),
                )
            if message_type == "app.getStatus":
                return self._success_response(message_id, message_type, self._handle_app_get_status())
            if message_type == "app.logUiEvent":
                return self._success_response(message_id, message_type, self._handle_app_log_ui_event(payload))
            if message_type == "app.windowControl":
                return self._success_response(message_id, message_type, self._handle_app_window_control(payload))
            if message_type == "mouse.coordinateCapture.start":
                return self._success_response(message_id, message_type, self._handle_mouse_coordinate_capture_start(payload))
            if message_type == "app.openExternal":
                return self._success_response(message_id, message_type, self._handle_app_open_external(payload))
            if message_type == "app.googleAuthLogin":
                return self._success_response(message_id, message_type, self._handle_app_google_auth_login(payload))
            if message_type == "app.googleAuthStatus":
                return self._success_response(message_id, message_type, self._handle_app_google_auth_status(payload))
            if message_type == "app.getSuggestIndex":
                return self._success_response(message_id, message_type, self._handle_app_get_suggest_index(payload))
            if message_type == "flow.list":
                return self._success_response(message_id, message_type, self._handle_flow_list(payload))
            if message_type == "flow.load":
                return self._success_response(message_id, message_type, self._handle_flow_load(payload))
            if message_type == "flow.save":
                return self._success_response(message_id, message_type, self._handle_flow_save(payload))
            if message_type == "flow.run":
                return self._success_response(message_id, message_type, self._handle_flow_run(payload))
            if message_type == "flow.tabClosed":
                return self._success_response(message_id, message_type, self._handle_flow_tab_closed(payload))
            if message_type == "run.cancel":
                return self._success_response(message_id, message_type, self._handle_run_cancel(payload))
            if message_type == "result.getSummary":
                return self._success_response(message_id, message_type, self._handle_result_get_summary(payload))
            if message_type == "result.getSchema":
                return self._success_response(message_id, message_type, self._handle_result_get_schema(payload))
            if message_type == "result.getPreview":
                return self._success_response(message_id, message_type, self._handle_result_get_preview(payload))
            if message_type == "result.getDatavolume":
                return self._success_response(message_id, message_type, self._handle_result_get_datavolume(payload))
            if message_type == "file.pickFile":
                return self._success_response(message_id, message_type, self._handle_file_pick_file(payload))
            if message_type == "file.pickFolder":
                return self._success_response(message_id, message_type, self._handle_file_pick_folder(payload))
            if message_type == "workspace.pickRoot":
                return self._success_response(message_id, message_type, self._handle_workspace_pick_root(payload))
            if message_type == "workspace.getRoot":
                return self._success_response(message_id, message_type, self._handle_workspace_get_root(payload))
            if message_type == "workspace.setRoot":
                return self._success_response(message_id, message_type, self._handle_workspace_set_root(payload))
            if message_type == "workspace.list":
                return self._success_response(message_id, message_type, self._handle_workspace_list(payload))
            if message_type == "workspace.stat":
                return self._success_response(message_id, message_type, self._handle_workspace_stat(payload))
            if message_type == "workspace.readText":
                return self._success_response(message_id, message_type, self._handle_workspace_read_text(payload))
            if message_type == "workspace.writeText":
                return self._success_response(message_id, message_type, self._handle_workspace_write_text(payload))
            if message_type == "workspace.mkdir":
                return self._success_response(message_id, message_type, self._handle_workspace_mkdir(payload))
            if message_type == "workspace.delete":
                return self._success_response(message_id, message_type, self._handle_workspace_delete(payload))
            if message_type == "preview.readExcel":
                return self._success_response(message_id, message_type, self._handle_preview_read_excel(payload))
            if message_type == "preview.readCsv":
                return self._success_response(message_id, message_type, self._handle_preview_read_csv(payload))
        except ValueError as error:
            _log_workspace_api_error("E_VALIDATION", str(error))
            return self._error_response(message_id, message_type, "E_VALIDATION", str(error))
        except BridgeApiError as error:
            _log_workspace_api_error(error.code, error.message)
            return self._error_response(message_id, message_type, error.code, error.message)
        except FileNotFoundError as error:
            _log_workspace_api_error("E_NOT_FOUND", str(error))
            return self._error_response(message_id, message_type, "E_NOT_FOUND", str(error))
        except PermissionError as error:
            _log_workspace_api_error("E_ACCESS_DENIED", str(error))
            return self._error_response(message_id, message_type, "E_ACCESS_DENIED", str(error))
        except Exception as error:
            _log_workspace_api_error("E_INTERNAL", str(error))
            return self._error_response(message_id, message_type, "E_INTERNAL", "内部エラーが発生しました。")

        return self._error_response(message_id, message_type, "E_ACCESS_DENIED", "未許可の API です。")

    def _handle_app_get_status(self):
        policies = load_security_policies(self.base_dir)
        return {
            "app": "zizai",
            "host": "pyside6-qtwebengine",
            "protocol_version": self.PROTOCOL_VERSION,
            "gui_mode": "webview",
            "security": {
                "external_requests_blocked": True,
                "navigation_locked": True,
                "devtools_context_menu_disabled": not self.debug,
                "devtools_enabled": self.debug,
                "remote_debugging_disabled": True,
            },
            "capabilities": [
                "app.getStatus",
                "app.logUiEvent",
                "app.windowControl",
                "mouse.coordinateCapture.start",
                "app.openExternal",
                "app.googleAuthLogin",
                "app.googleAuthStatus",
                "app.getSuggestIndex",
                "flow.list",
                "flow.load",
                "flow.save",
                "flow.run",
                "flow.tabClosed",
                "run.cancel",
                "result.getSummary",
                "result.getSchema",
                "result.getPreview",
                "result.getDatavolume",
                "file.pickFile",
                "file.pickFolder",
                "workspace.pickRoot",
                "workspace.getRoot",
                "workspace.setRoot",
                "workspace.list",
                "workspace.stat",
                "workspace.readText",
                "workspace.writeText",
                "workspace.mkdir",
                "workspace.delete",
                "preview.readExcel",
                "preview.readCsv",
            ],
            "security_policies": {
                "loaded": bool(policies.get("loaded")),
                "path": str(policies.get("path") or ""),
                "api_profile_count": len(policies.get("apis", {}).get("profiles", {})),
                "web_allowlist_count": len(policies.get("web", {}).get("allowlist", [])),
            },
            "runtime_context_defaults": self._build_runtime_context_defaults(),
        }

    def _handle_app_get_suggest_index(self, payload):
        connector_name = _safe_text((payload or {}).get("connector"))
        if not connector_name:
            raise ValueError("connector は必須です。")
        if not re.fullmatch(r"[A-Za-z0-9_]+", connector_name):
            raise ValueError("connector は英数字と _ のみ使用できます。")

        suggest_dir = self.base_dir / "config" / "suggest_index"
        suggest_path = suggest_dir / f"suggest_index_{connector_name}.yml"
        if not suggest_path.exists():
            return {
                "connector": connector_name,
                "entries": [],
                "path": str(suggest_path),
                "loaded": False,
            }

        with suggest_path.open("r", encoding="utf-8") as handle:
            raw = yaml.safe_load(handle) or []

        entries = []
        rows = raw.get("entries") if isinstance(raw, dict) else raw
        if not isinstance(rows, list):
            raise ValueError("suggest index YAML の形式が不正です。")
        for row in rows:
            if not isinstance(row, dict):
                continue
            index = _safe_text(row.get("index"))
            if not index:
                continue
            suggest_word = row.get("suggest_word")
            if isinstance(suggest_word, list):
                words = [_safe_text(item) for item in suggest_word if _safe_text(item)]
            else:
                word = _safe_text(suggest_word)
                words = [word] if word else []
            if not words:
                continue
            entries.append({
                "index": index,
                "suggest_word": words if len(words) > 1 else words[0],
            })
        return {
            "connector": connector_name,
            "entries": entries,
            "path": str(suggest_path),
            "loaded": True,
        }

    def _resolve_runtime_user_name(self):
        candidates = [
            os.environ.get("ZIZ_USER_NAME"),
            os.environ.get("USERNAME"),
            os.environ.get("USER"),
        ]
        try:
            candidates.append(getpass.getuser())
        except Exception:
            pass
        try:
            candidates.append(os.getlogin())
        except Exception:
            pass
        for candidate in candidates:
            text = _safe_text(candidate)
            if text:
                return text
        return "unknown"

    def _build_runtime_context_defaults(self):
        return {
            "current_date": datetime.now().strftime("%Y-%m-%d"),
            "user_name": self._resolve_runtime_user_name(),
        }

    def _handle_app_log_ui_event(self, payload):
        action = _safe_text((payload or {}).get("action")) or "unknown"
        source = _safe_text((payload or {}).get("source")) or "ui"
        elapsed_ms = (payload or {}).get("elapsed_ms")
        detail = payload.get("detail") if isinstance(payload, dict) else None
        detail_suffix = ""
        if isinstance(detail, dict) and detail:
            parts = []
            for key, value in detail.items():
                text = _safe_text(value)
                if text:
                    parts.append(f"{key}={text}")
            if parts:
                detail_suffix = " " + " ".join(parts)
        elapsed_suffix = f" elapsed_ms={elapsed_ms}" if elapsed_ms is not None else ""
        logger.info("[ui-event] source=%s action=%s%s%s", source, action, elapsed_suffix, detail_suffix)
        if action.startswith("run."):
            event_payload = {
                "action": action,
                "source": source,
            }
            if elapsed_ms is not None:
                event_payload["elapsed_ms"] = elapsed_ms
            if isinstance(detail, dict):
                for key in (
                    "run_id",
                    "status",
                    "event_ts",
                    "terminal_event_latency_ms",
                    "summary_fetch_ms",
                    "event_to_paint_ms",
                    "summary_to_paint_ms",
                    "render_last_ms",
                ):
                    if key in detail:
                        event_payload[key] = detail.get(key)
            self._append_execution_log("run.ui", event_payload)
        return {"logged": True}

    def _handle_app_window_control(self, payload):
        action = _safe_text((payload or {}).get("action"))
        if action not in {"minimize", "maximize", "close", "drag"}:
            raise ValueError("action が不正です。")
        if not callable(self.window_control_callback):
            raise ValueError("window control は利用できません。")
        state = self.window_control_callback(action)
        return {
            "accepted": True,
            "action": action,
            "state": str(state or ""),
        }

    def _handle_mouse_coordinate_capture_start(self, payload):
        capture_id = _safe_text((payload or {}).get("capture_id"))
        if not capture_id:
            raise ValueError("capture_id は必須です。")
        if not callable(self.coordinate_capture_callback):
            raise ValueError("座標取得はこの実行環境で利用できません。")
        started = self.coordinate_capture_callback(capture_id)
        if started is False:
            raise ValueError("座標取得を開始できませんでした。")
        return {
            "started": True,
            "capture_id": capture_id,
        }

    def _resolve_chrome_executable(self):
        if os.name != "nt":
            return shutil.which("google-chrome") or shutil.which("chromium") or shutil.which("chrome")
        candidates = [
            shutil.which("chrome"),
            shutil.which("chrome.exe"),
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            str(Path.home() / r"AppData\Local\Google\Chrome\Application\chrome.exe"),
        ]
        for candidate in candidates:
            text = _safe_text(candidate)
            if text and Path(text).exists():
                return text
        return None

    def _handle_app_open_external(self, payload):
        url = _safe_text((payload or {}).get("url"))
        prefer = _safe_text((payload or {}).get("prefer")).lower() or "chrome"
        if not re.match(r"^https?://", url):
            raise ValueError("url は http/https 形式で指定してください。")

        opened_via = ""
        try:
            if prefer == "chrome":
                chrome_exe = self._resolve_chrome_executable()
                if chrome_exe:
                    subprocess.Popen([chrome_exe, url], shell=False)
                    opened_via = "chrome"
                elif os.name == "nt":
                    # Windows の App Paths 解決を使って chrome 起動を試みる
                    subprocess.Popen(["cmd.exe", "/c", "start", "", "chrome", url], shell=False)
                    opened_via = "chrome-cmd-start"
                else:
                    webbrowser.open(url, new=2)
                    opened_via = "default-browser"
            else:
                webbrowser.open(url, new=2)
                opened_via = "default-browser"
        except Exception as error:
            logger.exception("[bridge] app.openExternal failed url=%s prefer=%s", url, prefer)
            raise ValueError(f"外部ブラウザ起動に失敗しました: {error}")

        logger.info("[bridge] app.openExternal accepted url=%s prefer=%s opened_via=%s", url, prefer, opened_via)
        return {
            "accepted": True,
            "url": url,
            "opened_via": opened_via,
        }

    def _handle_app_google_auth_login(self, payload):
        mode = _safe_text((payload or {}).get("mode")) or "application-default"
        if mode != "application-default":
            raise ValueError("mode が不正です。")
        command = ["gcloud", "auth", "application-default", "login"]
        try:
            if os.name == "nt":
                create_new_console = int(getattr(subprocess, "CREATE_NEW_CONSOLE", 0x00000010))
                subprocess.Popen(
                    ["cmd.exe", "/k"] + command,
                    creationflags=create_new_console,
                    shell=False,
                )
            else:
                subprocess.Popen(command, shell=False)
        except FileNotFoundError:
            raise ValueError("gcloud コマンドが見つかりません。Cloud SDK のインストールと PATH 設定を確認してください。")
        except Exception as error:
            raise ValueError(f"Googleログインを起動できませんでした: {error}")
        return {
            "launched": True,
            "command": "gcloud auth application-default login",
            "mode": mode,
        }

    def _handle_app_google_auth_status(self, payload):
        mode = _safe_text((payload or {}).get("mode")) or "application-default"
        if mode != "application-default":
            raise ValueError("mode が不正です。")

        account = ""
        account_error = ""
        auth_error = ""
        authenticated = False

        try:
            account_result = subprocess.run(
                ["gcloud", "config", "get-value", "account"],
                capture_output=True,
                text=True,
                timeout=10,
                shell=False,
            )
            if account_result.returncode == 0:
                value = _safe_text(account_result.stdout)
                if value and value != "(unset)":
                    account = value
            else:
                account_error = _safe_text(account_result.stderr) or "failed to get account"
        except FileNotFoundError:
            raise ValueError("gcloud コマンドが見つかりません。Cloud SDK のインストールと PATH 設定を確認してください。")
        except Exception as error:
            account_error = str(error)

        try:
            auth_result = subprocess.run(
                ["gcloud", "auth", "application-default", "print-access-token"],
                capture_output=True,
                text=True,
                timeout=20,
                shell=False,
            )
            authenticated = auth_result.returncode == 0 and bool(_safe_text(auth_result.stdout))
            if not authenticated:
                auth_error = _safe_text(auth_result.stderr) or "ADC is not authenticated"
        except Exception as error:
            authenticated = False
            auth_error = str(error)

        return {
            "mode": mode,
            "authenticated": bool(authenticated),
            "account": account,
            "account_error": account_error,
            "error": auth_error,
        }

    def _handle_flow_list(self, payload):
        started = time.perf_counter()
        scope = str((payload or {}).get("scope") or "local")
        kind = str((payload or {}).get("kind") or "recent")
        if scope not in {"local", "workspace"}:
            raise ValueError("scope が不正です。")
        if kind not in {"recent", "template"}:
            raise ValueError("kind が不正です。")

        items = []
        source_items = list_templates_local() if kind == "template" else list_flows_local()
        for item in source_items:
            path = str(item.get("path") or "")
            token = self._register_flow_token(path)
            directory = str(item.get("directory") or "")
            items.append({
                "flow_token": token,
                "display_name": str(item.get("filename") or ""),
                "display_hint": directory,
                "modified_at": datetime.fromtimestamp(float(item.get("modified_at") or 0), tz=timezone.utc).isoformat(),
            })
        response = {
            "scope": scope,
            "kind": kind,
            "items": items,
        }
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info("[bridge] flow.list kind=%s count=%s elapsed_ms=%s", kind, len(items), elapsed_ms)
        return response

    def _handle_flow_load(self, payload):
        started = time.perf_counter()
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=False)
        ref = _safe_text((payload or {}).get("ref") or (payload or {}).get("flow_token"))
        if ref:
            flow_path = self._flow_tokens.get(ref)
        elif (payload or {}).get("rel_path") is not None:
            scope = _safe_text((payload or {}).get("scope")) or "root"
            rel_path = str((payload or {}).get("rel_path") or "").strip()
            _, target = self._resolve_workspace_path(
                scope=scope,
                rel_path=rel_path,
                require_exists=True,
                expect_file=True,
            )
            flow_path = str(target)
        else:
            flow_path = self.open_flow_callback() if self.open_flow_callback else None

        if not flow_path:
            response = {
                "selected": False,
            }
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            logger.info("[bridge] flow.load cancelled elapsed_ms=%s", elapsed_ms)
            return response

        resolved_path = Path(flow_path).resolve()
        if not resolved_path.exists():
            raise FileNotFoundError(f"フローが見つかりません: {resolved_path}")
        if not has_flow_extension(str(resolved_path)):
            raise ValueError("対応していないフロー形式です。")

        with resolved_path.open("r", encoding="utf-8") as handle:
            config = yaml.safe_load(handle) or {}
        if not isinstance(config, dict):
            raise ValueError("フロー定義は辞書形式である必要があります。")

        with self._lock:
            self.current_flow_path = str(resolved_path)
            self.current_file_name = resolved_path.name
            self.current_mode = self._resolve_mode(config, resolved_path.name)
            self._clear_hidden_session(workspace_tab_id)
            web_flow = self._hide_sensitive_values(config, workspace_tab_id=workspace_tab_id)
            hidden_meta = self._get_hidden_meta(workspace_tab_id)
        register_recent_flow(str(resolved_path), opened_at_iso=_iso_now())

        response = {
            "selected": True,
            "mode": self.current_mode,
            "file_name": self.current_file_name,
            "flow": web_flow,
            "hidden_bindings": copy.deepcopy(hidden_meta),
        }
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info("[bridge] flow.load file=%s mode=%s tab_id=%s hidden=%s elapsed_ms=%s", self.current_file_name, self.current_mode, workspace_tab_id, len(hidden_meta), elapsed_ms)
        return response

    def _handle_flow_save(self, payload):
        started = time.perf_counter()
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        mode = _safe_text((payload or {}).get("mode")) or self.current_mode or "dataflow"
        flow = copy.deepcopy((payload or {}).get("flow") or {})
        if not isinstance(flow, dict):
            raise ValueError("flow はオブジェクトで指定してください。")
        previous_flow_key = self._build_flow_key(mode, self.current_flow_path)
        scope = _safe_text((payload or {}).get("scope")) or ""
        rel_path = str((payload or {}).get("rel_path") or "").strip()

        restored_flow = self._restore_hidden_values(flow, workspace_tab_id=workspace_tab_id)
        suggested_name = _safe_text((payload or {}).get("file_name")) or self.current_file_name or self._build_default_flow_file_name(mode)
        current_path = self.current_flow_path
        logger.info(
            "[bridge] flow.save begin mode=%s suggested_name=%s current_flow_path=%s",
            mode,
            suggested_name,
            current_path or "",
        )
        if scope and rel_path:
            _, target = self._resolve_workspace_path(
                scope=scope,
                rel_path=rel_path,
                require_exists=False,
                for_write=True,
            )
            target_path = str(target)
            logger.info(
                "[save-trace][bridge] flow.save.resolve scope=%s rel_path=%s target=%s",
                scope,
                rel_path,
                target_path,
            )
        elif self.save_flow_callback:
            target_path = self.save_flow_callback(mode, suggested_name, current_path)
        else:
            target_path = current_path
        if not target_path:
            response = {
                "saved": False,
                "file_name": suggested_name,
            }
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            logger.info("[bridge] flow.save cancelled mode=%s elapsed_ms=%s", mode, elapsed_ms)
            return response

        resolved_path = Path(target_path).resolve()
        if not has_flow_extension(str(resolved_path)):
            raise ValueError("対応していないフロー形式です。")
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        with resolved_path.open("w", encoding="utf-8") as handle:
            yaml.safe_dump(restored_flow, handle, allow_unicode=True, sort_keys=False)

        with self._lock:
            self.current_flow_path = str(resolved_path)
            self.current_file_name = resolved_path.name
            self.current_mode = mode
        saved_flow_key = self._build_flow_key(mode, str(resolved_path))
        self._migrate_flow_state(previous_flow_key, saved_flow_key)
        register_recent_flow(str(resolved_path), opened_at_iso=_iso_now())

        response = {
            "saved": True,
            "file_name": resolved_path.name,
        }
        logger.info(
            "[save-trace][bridge] flow.save.saved file=%s abs=%s",
            resolved_path.name,
            str(resolved_path),
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info("[bridge] flow.save file=%s mode=%s elapsed_ms=%s", resolved_path.name, mode, elapsed_ms)
        return response

    def _handle_flow_run(self, payload):
        started = time.perf_counter()
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        mode = _safe_text((payload or {}).get("mode")) or self.current_mode or "dataflow"
        flow = copy.deepcopy((payload or {}).get("flow") or {})
        if not isinstance(flow, dict):
            raise ValueError("flow はオブジェクトで指定してください。")

        requested_step_id = _safe_text((payload or {}).get("step_id"))
        resolved_flow = self._restore_hidden_values(flow, workspace_tab_id=workspace_tab_id)
        run_id = f"run_{uuid.uuid4().hex[:12]}"
        trace_id = f"trace_{uuid.uuid4().hex[:12]}"
        started_at = _iso_now()
        cancel_event = threading.Event()
        flow_name = _safe_text(((resolved_flow.get("metadata") or {}).get("name"))) or "Untitled"
        secret_values = self._collect_secret_values(resolved_flow)
        flow_key = self._build_flow_key(mode, self.current_flow_path)
        seed_context = self._get_latest_flow_context(flow_key) if requested_step_id else {}
        if not isinstance(seed_context, dict):
            seed_context = {}
        else:
            seed_context = copy.copy(seed_context)
        seed_context["__run_id"] = run_id
        seed_context["__workspace_tab_id"] = workspace_tab_id
        if self.workspace_root:
            seed_context["__workspace_root"] = str(self.workspace_root)
        if self.current_flow_path and self.current_flow_path != "<unsaved>":
            try:
                seed_context["__flow_dir"] = str(Path(self.current_flow_path).resolve().parent)
            except Exception:
                pass
        if self.current_flow_path:
            secret_values.add(self.current_flow_path)

        session = {
            "run_id": run_id,
            "workspace_tab_id": workspace_tab_id,
            "trace_id": trace_id,
            "status": "running",
            "started_at": started_at,
            "finished_at": None,
            "flow_name": flow_name,
            "mode": mode,
            "flow_path": self.current_flow_path or "<unsaved>",
            "step_count": 1 if requested_step_id else len((resolved_flow.get("steps") or []) if isinstance(resolved_flow.get("steps"), list) else []),
            "report": None,
            "cancel_event": cancel_event,
            "error": None,
            "secret_values": secret_values,
            "requested_step_id": requested_step_id,
            "seed_context": seed_context,
            "flow_key": flow_key,
        }
        with self._lock:
            active_run_id = _safe_text(self.active_run_by_flow.get(flow_key))
            active_session = self.runs.get(active_run_id) if active_run_id else None
            is_conflict = bool(active_session and str(active_session.get("status") or "") == "running")
            if is_conflict:
                raise BridgeApiError("E_CONFLICT", "同じフローが実行中です。完了またはキャンセル後に再実行してください。")
            if active_run_id:
                self.active_run_by_flow.pop(flow_key, None)
            self.runs[run_id] = session
            self.active_run_by_flow[flow_key] = run_id
            self.current_mode = mode

        self._append_execution_log("run.start", {
            "run_id": run_id,
            "flow_key": flow_key,
            "mode": mode,
            "step_id": requested_step_id or "",
            "flow_name": flow_name,
        })

        worker = threading.Thread(
            target=self._run_flow_worker,
            args=(run_id, resolved_flow),
            daemon=True,
        )
        session["thread"] = worker
        worker.start()

        response = {
            "run_id": run_id,
            "accepted": True,
        }
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info("[bridge] flow.run accepted run_id=%s mode=%s step_id=%s elapsed_ms=%s", run_id, mode, requested_step_id or "-", elapsed_ms)
        return response

    def _handle_flow_tab_closed(self, payload):
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        self._delete_hidden_session(workspace_tab_id)
        return {
            "closed": True,
            "workspace_tab_id": workspace_tab_id,
        }

    def _handle_run_cancel(self, payload):
        run_id = _safe_text((payload or {}).get("run_id"))
        if not run_id:
            raise ValueError("run_id は必須です。")
        with self._lock:
            session = self.runs.get(run_id)
        if not session:
            raise FileNotFoundError("対象の実行が見つかりません。")
        session["cancel_event"].set()
        self.emit_event("run.progress", {
            "run_id": run_id,
            "stage": "cancel_requested",
            "percent": None,
            "message": "キャンセル要求を受け付けました。",
        })
        return {
            "run_id": run_id,
            "accepted": True,
        }

    def _handle_result_get_summary(self, payload):
        session = self._require_run_session((payload or {}).get("run_id"))
        report = session.get("report") or {}
        steps = report.get("steps") or []
        return {
            "flow_name": session.get("flow_name") or report.get("flow_name") or "Untitled",
            "status": session.get("status") or report.get("status") or "error",
            "started_at": session.get("started_at"),
            "finished_at": session.get("finished_at"),
            "duration_ms": self._compute_duration_ms(session.get("started_at"), session.get("finished_at")),
            "step_count": session.get("step_count") or len(steps),
            "success_count": sum(1 for step in steps if step.get("status") == "success"),
            "error_count": sum(1 for step in steps if step.get("status") == "error"),
            "run_id": session.get("run_id"),
            "trace_id": session.get("trace_id"),
            "error": session.get("error"),
        }

    def _handle_result_get_schema(self, payload):
        step_payload = self._get_latest_step_payload(payload)
        dataframe = step_payload.get("result")
        ui_cache = step_payload.get("ui_cache") if isinstance(step_payload.get("ui_cache"), dict) else None
        if not hasattr(dataframe, "columns") or not hasattr(dataframe, "attrs"):
            if ui_cache and isinstance((ui_cache.get("schema") or {}).get("columns"), list):
                return {"columns": list((ui_cache.get("schema") or {}).get("columns") or [])}
            raise ValueError("指定ステップの結果は表データではありません。")

        existing_schema = dataframe.attrs.get("ziz_schema")
        if isinstance(existing_schema, list) and existing_schema:
            schema_items = existing_schema
        else:
            schema_items = build_dataframe_schema(dataframe)
        return {
            "columns": [
                {
                    "origin_name": str(item.get("origin_name") or item.get("name_ja") or item.get("name_en") or ""),
                    "new_name": str(item.get("new_name") or item.get("name_en") or item.get("origin_name") or ""),
                    "description": str(item.get("description") or item.get("name_ja") or item.get("origin_name") or ""),
                    "ziz_datatype": str(item.get("ziz_datatype") or ""),
                }
                for item in schema_items
            ]
        }

    def _handle_result_get_preview(self, payload):
        step_payload = self._get_latest_step_payload(payload)
        dataframe = step_payload.get("result")
        ui_cache = step_payload.get("ui_cache") if isinstance(step_payload.get("ui_cache"), dict) else None
        if not hasattr(dataframe, "columns") or not hasattr(dataframe, "head"):
            preview = (ui_cache or {}).get("preview") if isinstance(ui_cache, dict) else None
            if isinstance(preview, dict):
                return {
                    "columns": list(preview.get("columns") or []),
                    "rows": list(preview.get("rows") or []),
                    "row_count": int(preview.get("row_count") or 0),
                    "truncated": bool(preview.get("truncated")),
                }
            raise ValueError("指定ステップの結果は表データではありません。")

        preview = dataframe.head(100).copy()
        columns = [str(column) for column in preview.columns]
        rows = []
        for _, row in preview.iterrows():
            values = []
            for value in row.tolist():
                if self._is_missing_preview_value(value):
                    values.append("")
                    continue
                values.append(str(value))
            rows.append(values)

        return {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "truncated": bool(len(dataframe.index) > len(rows)),
        }

    def _handle_result_get_datavolume(self, payload):
        step_payload = self._get_latest_step_payload(payload)
        dataframe = step_payload.get("result")
        ui_cache = step_payload.get("ui_cache") if isinstance(step_payload.get("ui_cache"), dict) else None
        if not hasattr(dataframe, "columns") or not hasattr(dataframe, "index"):
            schema_columns = (((ui_cache or {}).get("schema") or {}).get("columns") or []) if isinstance(ui_cache, dict) else []
            top_n = int((payload or {}).get("top_n") or 5)
            top_n = max(1, min(top_n, 20))
            return {
                "row_count": int((ui_cache or {}).get("row_count") or 0) if isinstance(ui_cache, dict) else 0,
                "columns": [
                    {
                        "name": str(item.get("new_name") or item.get("origin_name") or ""),
                        "dtype": str(item.get("ziz_datatype") or ""),
                        "items": [],
                    }
                    for item in schema_columns
                ],
                "top_n": top_n,
            }

        total_rows = len(dataframe.index)
        top_n = int((payload or {}).get("top_n") or 5)
        top_n = max(1, min(top_n, 20))
        columns = []
        for column in dataframe.columns:
            series = dataframe[column]
            normalized = self._normalize_datavolume_series(series)
            counts = normalized.value_counts(dropna=False).head(top_n)
            items = []
            for item_value, item_count in counts.items():
                ratio = (int(item_count) / total_rows) * 100 if total_rows else 0
                items.append({
                    "value": str(item_value),
                    "count": int(item_count),
                    "ratio": round(ratio, 1),
                })
            columns.append({
                "name": str(column),
                "dtype": str(series.dtype),
                "items": items,
            })

        return {
            "row_count": total_rows,
            "columns": columns,
            "top_n": top_n,
        }

    def _is_missing_preview_value(self, value):
        if value is None:
            return True
        try:
            result = pd.isna(value)
        except Exception:
            return False
        if isinstance(result, bool):
            return result
        return False

    def _normalize_datavolume_series(self, series):
        object_series = series.astype(object)
        return object_series.where(pd.notna(object_series), "NULL").astype(str)

    def _handle_file_pick_file(self, payload):
        if not self.pick_file_callback and not self.edit_file_callback:
            raise RuntimeError("ファイル選択ダイアログが利用できません。")
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        title = _safe_text((payload or {}).get("title")) or "ファイルを選択"
        filters = (payload or {}).get("filters") or []
        current_ref = _safe_text((payload or {}).get("current_ref")) or None
        current_value = self._resolve_picker_initial_value(payload, current_ref, workspace_tab_id=workspace_tab_id)
        if self.edit_file_callback:
            selected_path = self.edit_file_callback(title, current_value, filters)
        else:
            selected_path = self.pick_file_callback(title, filters)
        if not selected_path:
            return {"selected": False}
        ref, meta = self._store_hidden_value(
            step_name=_safe_text((payload or {}).get("step_name")) or "global",
            field_key=_safe_text((payload or {}).get("field_key")) or "file_path",
            actual_value=str(selected_path),
            current_ref=current_ref,
            workspace_tab_id=workspace_tab_id,
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or "",
            "display_hint": meta.get("display_hint") or "",
            "selected": True,
        }

    def _handle_file_pick_folder(self, payload):
        if not self.pick_folder_callback and not self.edit_folder_callback:
            raise RuntimeError("フォルダ選択ダイアログが利用できません。")
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        title = _safe_text((payload or {}).get("title")) or "フォルダを選択"
        current_ref = _safe_text((payload or {}).get("current_ref")) or None
        current_value = self._resolve_picker_initial_value(payload, current_ref, workspace_tab_id=workspace_tab_id)
        if current_ref and current_value and self.edit_folder_callback:
            selected_path = self.edit_folder_callback(title, current_value)
        elif self.pick_folder_callback:
            selected_path = self.pick_folder_callback(title)
        else:
            selected_path = self.edit_folder_callback(title, current_value)
        if not selected_path:
            return {"selected": False}
        ref, meta = self._store_hidden_value(
            step_name=_safe_text((payload or {}).get("step_name")) or "global",
            field_key=_safe_text((payload or {}).get("field_key")) or "folder_path",
            actual_value=str(selected_path),
            current_ref=current_ref,
            workspace_tab_id=workspace_tab_id,
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or "",
            "display_hint": meta.get("display_hint") or "",
            "selected": True,
        }

    def _handle_workspace_pick_root(self, payload):
        if not self.pick_folder_callback and not self.edit_folder_callback:
            raise RuntimeError("フォルダ選択ダイアログが利用できません。")
        title = _safe_text((payload or {}).get("title")) or "ワークスペースルートを選択"
        if self.pick_folder_callback:
            selected_path = self.pick_folder_callback(title)
        else:
            current_value = _safe_text((payload or {}).get("current_value")) or str(self.workspace_root or "")
            selected_path = self.edit_folder_callback(title, current_value)
        if not selected_path:
            return {
                "selected": False,
                "root_path": str(self.workspace_root or ""),
                "config_path": str(self.config_root),
            }
        raw = Path(str(selected_path))
        if raw.is_symlink():
            self._deny_workspace_access(
                reason="workspace root symlink is not allowed",
                scope="root",
                rel_path="",
                resolved_path=raw,
            )
        resolved = raw.resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError(f"フォルダが見つかりません: {resolved}")
        if self._path_has_symlink(resolved, resolved):
            self._deny_workspace_access(
                reason="workspace root contains symlink",
                scope="root",
                rel_path="",
                resolved_path=resolved,
            )
        self.workspace_root = resolved
        return {
            "selected": True,
            "root_path": str(resolved),
            "config_path": str(self.config_root),
        }

    def _handle_workspace_get_root(self, payload):
        if self.workspace_root is None:
            default_root = (self.base_dir / "workflows").resolve()
            if default_root.exists() and default_root.is_dir():
                applied = self._handle_workspace_set_root({"root_path": str(default_root)})
                return {
                    "has_root": bool(applied.get("has_root")),
                    "root_path": str(applied.get("root_path") or ""),
                    "config_path": str(applied.get("config_path") or self.config_root),
                }
            picked = self._handle_workspace_pick_root({
                "title": "プロジェクトルートを選択",
                "current_value": "",
            })
            if picked.get("selected"):
                applied = self._handle_workspace_set_root({"root_path": str(picked.get("root_path") or "")})
                return {
                    "has_root": bool(applied.get("has_root")),
                    "root_path": str(applied.get("root_path") or ""),
                    "config_path": str(applied.get("config_path") or self.config_root),
                }
        return {
            "has_root": self.workspace_root is not None,
            "root_path": str(self.workspace_root or ""),
            "config_path": str(self.config_root),
        }

    def _handle_workspace_set_root(self, payload):
        root_path = _safe_text((payload or {}).get("root_path"))
        if not root_path:
            self.workspace_root = None
            return {
                "has_root": False,
                "root_path": "",
                "config_path": str(self.config_root),
            }
        raw = Path(root_path)
        if raw.is_symlink():
            self._deny_workspace_access(
                reason="workspace root symlink is not allowed",
                scope="root",
                rel_path="",
                resolved_path=raw,
            )
        resolved = raw.resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise FileNotFoundError(f"フォルダが見つかりません: {resolved}")
        if self._path_has_symlink(resolved, resolved):
            self._deny_workspace_access(
                reason="workspace root contains symlink",
                scope="root",
                rel_path="",
                resolved_path=resolved,
            )
        self.workspace_root = resolved
        return {
            "has_root": True,
            "root_path": str(resolved),
            "config_path": str(self.config_root),
        }

    def _handle_workspace_list(self, payload):
        scope = _safe_text((payload or {}).get("scope")) or "root"
        rel_path = str((payload or {}).get("rel_path") or "").strip()
        base, target = self._resolve_workspace_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
            expect_dir=True,
        )
        entries = []
        for child in target.iterdir():
            if child.is_symlink():
                logger.warning("[workspace] skip symlink entry: %s", child)
                continue
            is_dir = child.is_dir()
            has_children = False
            if is_dir:
                try:
                    has_children = any(True for _ in child.iterdir())
                except Exception:
                    has_children = False
            rel = child.relative_to(base).as_posix()
            entries.append({
                "name": child.name,
                "rel_path": rel,
                "kind": "dir" if is_dir else "file",
                "has_children": bool(has_children),
                "size": int(child.stat().st_size) if child.exists() and child.is_file() else 0,
                "modified_at": int(child.stat().st_mtime_ns) if child.exists() else 0,
            })
        entries.sort(key=lambda item: (0 if item["kind"] == "dir" else 1, item["name"].lower()))
        return {
            "scope": scope,
            "base_path": str(base),
            "path": str(target),
            "rel_path": target.relative_to(base).as_posix() if target != base else "",
            "entries": entries,
        }

    def _handle_workspace_read_text(self, payload):
        scope = _safe_text((payload or {}).get("scope")) or "root"
        rel_path = str((payload or {}).get("rel_path") or "").strip()
        _, target = self._resolve_workspace_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
            expect_file=True,
        )
        if target.suffix.lower() not in {".md", ".sql", ".py", ".json", ".zizd"}:
            raise ValueError("対応していないファイル形式です。")
        content, encoding = self._read_text_with_fallback(target)
        stat = target.stat()
        return {
            "scope": scope,
            "rel_path": rel_path.replace("\\", "/"),
            "file_name": target.name,
            "content": content,
            "encoding": encoding,
            "mtime_ns": str(int(stat.st_mtime_ns)),
            "size": int(stat.st_size),
        }

    def _handle_workspace_stat(self, payload):
        scope = _safe_text((payload or {}).get("scope")) or "root"
        rel_path = str((payload or {}).get("rel_path") or "").strip()
        _, target = self._resolve_workspace_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
            expect_file=True,
        )
        stat = target.stat()
        return {
            "scope": scope,
            "rel_path": rel_path.replace("\\", "/"),
            "file_name": target.name,
            "mtime_ns": str(int(stat.st_mtime_ns)),
            "size": int(stat.st_size),
            "exists": True,
        }

    def _handle_workspace_write_text(self, payload):
        scope = _safe_text((payload or {}).get("scope")) or "root"
        rel_path = str((payload or {}).get("rel_path") or "").strip()
        content = str((payload or {}).get("content") or "")
        force = bool((payload or {}).get("force"))
        expected_mtime_ns = (payload or {}).get("expected_mtime_ns")
        _, target = self._resolve_workspace_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=False,
            for_write=True,
        )
        logger.info(
            "[save-trace][bridge] workspace.writeText.resolve scope=%s rel_path=%s force=%s expected_mtime_ns=%s target=%s content_len=%s",
            scope,
            rel_path,
            force,
            str(expected_mtime_ns),
            str(target),
            len(content),
        )
        if target.exists() and target.is_dir():
            raise ValueError("保存先がフォルダです。")
        if target.exists() and target.suffix.lower() not in {".md", ".sql", ".py", ".yml", ".yaml", ".json", ".txt", ".ini", ".cfg", ".env", ".js", ".zizd"}:
            raise ValueError("この拡張子への保存は許可されていません。")
        if target.exists() and expected_mtime_ns is not None and not force:
            current_mtime_ns = int(target.stat().st_mtime_ns)
            if int(expected_mtime_ns) != current_mtime_ns:
                raise BridgeApiError("E_CONFLICT", "ファイルが外部で更新されています。")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8", newline="") as handle:
            handle.write(content)
        stat = target.stat()
        return {
            "scope": scope,
            "rel_path": rel_path.replace("\\", "/"),
            "file_name": target.name,
            "mtime_ns": str(int(stat.st_mtime_ns)),
            "size": int(stat.st_size),
            "saved": True,
        }

    def _handle_workspace_mkdir(self, payload):
        scope = _safe_text((payload or {}).get("scope")) or "root"
        rel_path = str((payload or {}).get("rel_path") or "").strip()
        if not rel_path:
            raise ValueError("作成先パスが未指定です。")
        _, target = self._resolve_workspace_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=False,
            for_write=True,
        )
        if target.exists():
            if target.is_dir():
                raise ValueError("同名のフォルダが既に存在します。")
            raise ValueError("同名のファイルが存在します。")
        target.mkdir(parents=True, exist_ok=False)
        return {
            "scope": scope,
            "rel_path": rel_path.replace("\\", "/"),
            "name": target.name,
            "created": True,
            "kind": "dir",
        }

    def _handle_workspace_delete(self, payload):
        scope = _safe_text((payload or {}).get("scope")) or "root"
        rel_path = str((payload or {}).get("rel_path") or "").strip()
        if not rel_path:
            raise ValueError("削除対象パスが未指定です。")
        _, target = self._resolve_workspace_path(
            scope=scope,
            rel_path=rel_path,
            require_exists=True,
        )
        if target.is_symlink():
            self._deny_workspace_access(
                reason="delete target symlink is not allowed",
                scope=scope,
                rel_path=rel_path,
                resolved_path=target,
            )
        if target.is_dir():
            shutil.rmtree(target)
            deleted_kind = "dir"
        elif target.is_file():
            target.unlink()
            deleted_kind = "file"
        else:
            raise ValueError("削除対象が不正です。")
        return {
            "scope": scope,
            "rel_path": rel_path.replace("\\", "/"),
            "deleted": True,
            "kind": deleted_kind,
        }

    def _resolve_workspace_base(self, scope):
        normalized = _safe_text(scope) or "root"
        if normalized in {"root", "workspace"}:
            if self.workspace_root is None:
                raise ValueError("ワークスペースルートが未選択です。")
            return self.workspace_root
        if normalized == "config":
            return self.config_root
        raise ValueError("scope が不正です。")

    def _resolve_workspace_path(
        self,
        *,
        scope,
        rel_path,
        require_exists,
        expect_dir=False,
        expect_file=False,
        for_write=False,
    ):
        base = self._resolve_workspace_base(scope)
        text = str(rel_path or "").replace("\\", "/").strip()
        raw_candidate = base / text if text else base
        candidate = raw_candidate.resolve(strict=False)
        if not self._is_relative_to(candidate, base):
            self._deny_workspace_access(
                reason="path escapes allowed base",
                scope=scope,
                rel_path=rel_path,
                resolved_path=candidate,
            )
        if self._path_has_symlink(base, raw_candidate):
            self._deny_workspace_access(
                reason="symlink path is not allowed",
                scope=scope,
                rel_path=rel_path,
                resolved_path=candidate,
            )
        if require_exists and not candidate.exists():
            raise FileNotFoundError(f"対象が見つかりません: {candidate}")
        if expect_dir and candidate.exists() and not candidate.is_dir():
            raise ValueError("対象がフォルダではありません。")
        if expect_file and candidate.exists() and not candidate.is_file():
            raise ValueError("対象がファイルではありません。")
        if for_write and candidate.exists() and candidate.is_symlink():
            self._deny_workspace_access(
                reason="write target symlink is not allowed",
                scope=scope,
                rel_path=rel_path,
                resolved_path=candidate,
            )
        return base, candidate

    def _is_relative_to(self, candidate, base):
        try:
            candidate.relative_to(base)
            return True
        except Exception:
            return False

    def _path_has_symlink(self, base, target):
        if base.exists() and base.is_symlink():
            return True
        if target == base:
            return False
        try:
            rel = target.relative_to(base)
        except Exception:
            return True
        cursor = base
        for part in rel.parts:
            cursor = cursor / part
            if cursor.exists() and cursor.is_symlink():
                return True
        return False

    def _deny_workspace_access(self, *, reason, scope, rel_path, resolved_path):
        logger.warning(
            "[workspace] access denied: reason=%s scope=%s rel_path=%s resolved=%s",
            str(reason or ""),
            str(scope or ""),
            str(rel_path or ""),
            str(resolved_path or ""),
        )
        raise PermissionError("アクセスが拒否されました。")

    def _read_text_with_fallback(self, path_obj):
        encodings = ["utf-8", "cp932", "shift_jis"]
        last_error = None
        for encoding in encodings:
            try:
                with path_obj.open("r", encoding=encoding) as handle:
                    return handle.read(), encoding
            except UnicodeDecodeError as error:
                last_error = error
                continue
        if last_error:
            raise ValueError("テキストを読み込めません。文字コードを確認してください。")
        with path_obj.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.read(), "utf-8"

    def _handle_preview_read_excel(self, payload):
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        actual_path, ref, meta = self._resolve_hidden_or_current_path(
            payload,
            field_key=_safe_text((payload or {}).get("field_key")) or "file_path",
            workspace_tab_id=workspace_tab_id,
        )
        if not actual_path:
            raise ValueError("Excel ファイルが選択されていません。")

        preview = ExcelConnector().preview_excel(
            actual_path,
            sheet_name=_safe_text((payload or {}).get("sheet_name")),
            max_rows=30,
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or Path(actual_path).name,
            "display_hint": meta.get("display_hint") or "",
            "file_name": Path(actual_path).name,
            **preview,
        }

    def _handle_preview_read_csv(self, payload):
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        actual_path, ref, meta = self._resolve_hidden_or_current_path(
            payload,
            field_key=_safe_text((payload or {}).get("field_key")) or "file_path",
            workspace_tab_id=workspace_tab_id,
        )
        if not actual_path:
            raise ValueError("CSV ファイルが選択されていません。")

        encoding = self._normalize_preview_encoding((payload or {}).get("encoding"))
        delimiter = self._normalize_preview_delimiter((payload or {}).get("delimiter"))
        rows = self._load_csv_rows(actual_path, encoding, delimiter, max_rows=100)
        preview_rows = rows[:30]
        col_count = max((len(row) for row in rows), default=0)
        columns = [self._col_index_to_letters(index) for index in range(col_count)]
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or Path(actual_path).name,
            "display_hint": meta.get("display_hint") or "",
            "file_name": Path(actual_path).name,
            "encoding": encoding,
            "delimiter": delimiter,
            "columns": columns,
            "rows2d": [self._pad_row(row, col_count) for row in preview_rows],
            "schema_rows2d": [self._pad_row(row, col_count) for row in rows],
            "base_row": 0,
            "col_count": col_count,
        }

    def _resolve_picker_initial_value(self, payload, current_ref, *, workspace_tab_id):
        hidden_values = self._get_hidden_values(workspace_tab_id)
        if current_ref and current_ref in hidden_values:
            return str(hidden_values.get(current_ref) or "")
        return _safe_text((payload or {}).get("current_value"))

    def _resolve_hidden_or_current_path(self, payload, *, field_key, workspace_tab_id):
        current_ref = _safe_text((payload or {}).get("current_ref")) or None
        current_value = self._resolve_picker_initial_value(payload, current_ref, workspace_tab_id=workspace_tab_id)
        actual_path = str(current_value or "")
        if not actual_path:
            raise ValueError("対象パスが未設定です。")
        path_obj = Path(actual_path).resolve()
        if not path_obj.exists():
            raise FileNotFoundError(f"ファイルが見つかりません: {path_obj}")
        hidden_meta = self._get_hidden_meta(workspace_tab_id)
        meta = hidden_meta.get(current_ref) if current_ref and current_ref in hidden_meta else self._build_hidden_meta(field_key, actual_path)
        return str(path_obj), current_ref or "", meta

    def _load_csv_rows(self, actual_path, encoding, delimiter, *, max_rows):
        normalized_encoding = self._normalize_preview_encoding(encoding)
        normalized_delimiter = self._normalize_preview_delimiter(delimiter)
        rows = []
        with open(actual_path, "r", encoding=normalized_encoding, newline="") as handle:
            reader = csv.reader(handle, delimiter=normalized_delimiter)
            for row_index, row in enumerate(reader):
                if row_index >= max_rows:
                    break
                rows.append([cell if cell != "" else None for cell in row])
        return rows

    def _normalize_preview_encoding(self, value):
        raw = _safe_text(value).lower() or "utf-8"
        if raw == "utf8":
            return "utf-8"
        if raw == "cp932":
            return "cp932"
        return raw

    def _normalize_preview_delimiter(self, value):
        raw = str(value or ",")
        if raw == "\\t" or raw.lower() == "tab":
            return "\t"
        return raw

    def _col_index_to_letters(self, idx0):
        n = int(idx0) + 1
        text = ""
        while n > 0:
            r = (n - 1) % 26
            text = chr(65 + r) + text
            n = (n - 1) // 26
        return text

    def _pad_row(self, row, col_count):
        return [(row[index] if index < len(row) else None) for index in range(col_count)]

    def _run_flow_worker(self, run_id, resolved_flow):
        with self._lock:
            session = self.runs.get(run_id)
        if not session:
            return

        logger = self._create_run_logger(run_id)
        log_handler = _RunLogHandler(self, run_id)
        logger.addHandler(log_handler)
        engine = WorkflowEngine(
            logger,
            step_status_callback=lambda detail: self._emit_step_status(run_id, detail),
            performance_callback=lambda event, detail: self._handle_run_performance_event(run_id, event, detail),
        )
        self.emit_event("run.progress", {
            "run_id": run_id,
            "stage": "running",
            "percent": None,
            "message": "実行を開始しました。",
        })

        core_started = time.perf_counter()
        try:
            report = engine.run_flow_from_config(
                resolved_flow,
                flow_path=session.get("flow_path") or "<gui>",
                cancel_event=session.get("cancel_event"),
                initial_context=session.get("seed_context") or {},
                only_step_id=session.get("requested_step_id") or None,
            )
            core_elapsed_ms = round((time.perf_counter() - core_started) * 1000, 1)
            self._append_execution_log("run.core.finish", {
                "run_id": run_id,
                "flow_key": session.get("flow_key") or "",
                "status": str(report.get("status") or ""),
                "elapsed_ms": core_elapsed_ms,
            })
            logger.info(
                "[bridge-perf] run.core.finish run_id=%s status=%s elapsed_ms=%s",
                run_id,
                str(report.get("status") or ""),
                core_elapsed_ms,
            )
            session["report"] = {
                "status": str(report.get("status") or ""),
                "error": str(report.get("error") or ""),
                "steps": [
                    {
                        "step_id": _safe_text(step.get("step_id")),
                        "status": _safe_text(step.get("status")),
                    }
                    for step in (report.get("steps") or [])
                ],
                "flow_name": _safe_text(report.get("flow_name") or session.get("flow_name") or "Untitled"),
            }
            session["finished_at"] = _iso_now()
            store_started = time.perf_counter()
            self._update_latest_by_flow(
                session.get("flow_key"),
                session.get("seed_context"),
                report,
                final_context=getattr(engine, "context", None),
            )
            store_elapsed_ms = round((time.perf_counter() - store_started) * 1000, 1)
            self._append_execution_log("run.result.store", {
                "run_id": run_id,
                "flow_key": session.get("flow_key") or "",
                "elapsed_ms": store_elapsed_ms,
            })
            self._append_execution_log("run.finish", {
                "run_id": run_id,
                "flow_key": session.get("flow_key") or "",
                "status": str(report.get("status") or ""),
                "step_count": len(report.get("steps") or []),
                "error": self._normalize_log_error(report.get("error")),
            })
            for step in (report.get("steps") or []):
                self._append_execution_log("run.step", {
                    "run_id": run_id,
                    "flow_key": session.get("flow_key") or "",
                    "step_id": _safe_text(step.get("step_id")),
                    "status": _safe_text(step.get("status")),
                    "error": self._normalize_log_error(step.get("error")),
                })

            if report.get("status") == "success":
                session["status"] = "success"
                self._append_execution_log("run.terminal_event.emit", {
                    "run_id": run_id,
                    "flow_key": session.get("flow_key") or "",
                    "status": "success",
                    "event_type": "run.completed",
                })
                self.emit_event("run.completed", {
                    "run_id": run_id,
                    "status": "success",
                    "trace_id": session.get("trace_id"),
                })
            elif report.get("status") == "cancelled" or report.get("cancelled"):
                session["status"] = "cancelled"
                session["error"] = {
                    "code": "E_CANCELLED",
                    "message": "実行がキャンセルされました。",
                    "detail": {},
                    "retryable": False,
                    "trace_id": session.get("trace_id"),
                }
                self._append_execution_log("run.terminal_event.emit", {
                    "run_id": run_id,
                    "flow_key": session.get("flow_key") or "",
                    "status": "cancelled",
                    "event_type": "run.failed",
                })
                self.emit_event("run.failed", {
                    "run_id": run_id,
                    "status": "cancelled",
                    "trace_id": session.get("trace_id"),
                })
            else:
                session["status"] = "error"
                session["error"] = {
                    "code": "E_INTERNAL",
                    "message": str(report.get("error") or "実行に失敗しました。"),
                    "detail": {},
                    "retryable": False,
                    "trace_id": session.get("trace_id"),
                }
                self._append_execution_log("run.terminal_event.emit", {
                    "run_id": run_id,
                    "flow_key": session.get("flow_key") or "",
                    "status": "error",
                    "event_type": "run.failed",
                })
                self.emit_event("run.failed", {
                    "run_id": run_id,
                    "status": "error",
                    "trace_id": session.get("trace_id"),
                })
        except Exception:
            session["finished_at"] = _iso_now()
            session["status"] = "error"
            session["report"] = {
                "status": "error",
                "error": "内部エラーが発生しました。",
                "steps": [],
                "flow_name": _safe_text(session.get("flow_name") or "Untitled"),
            }
            session["error"] = {
                "code": "E_INTERNAL",
                "message": "内部エラーが発生しました。",
                "detail": {},
                "retryable": False,
                "trace_id": session.get("trace_id"),
            }
            self._append_execution_log("run.finish", {
                "run_id": run_id,
                "flow_key": session.get("flow_key") or "",
                "status": "error",
                "step_count": 0,
                "error": "内部エラーが発生しました。",
            })
            self._append_execution_log("run.terminal_event.emit", {
                "run_id": run_id,
                "flow_key": session.get("flow_key") or "",
                "status": "error",
                "event_type": "run.failed",
            })
            self.emit_event("run.failed", {
                "run_id": run_id,
                "status": "error",
                "trace_id": session.get("trace_id"),
            })
        finally:
            self._cleanup_selenium_session_runtime(session)
            flow_key = _safe_text(session.get("flow_key"))
            with self._lock:
                if self.active_run_by_flow.get(flow_key) == run_id:
                    self.active_run_by_flow.pop(flow_key, None)
            logger.removeHandler(log_handler)
            log_handler.close()

    def _handle_run_performance_event(self, run_id, event, detail):
        event_name = _safe_text(event)
        if not event_name:
            return
        with self._lock:
            session = self.runs.get(run_id) or {}
        payload = {
            "run_id": run_id,
            "flow_key": session.get("flow_key") or "",
        }
        if isinstance(detail, dict):
            payload.update(detail)
        self._append_execution_log(event_name, payload)

    def _cleanup_selenium_session_runtime(self, session):
        try:
            if not isinstance(session, dict):
                return
            run_id = _safe_text(session.get("run_id"))
            workspace_tab_id = _safe_text(session.get("workspace_tab_id"))
            if not run_id or not workspace_tab_id:
                context = session.get("seed_context") if isinstance(session.get("seed_context"), dict) else {}
                run_id = run_id or _safe_text(context.get("__run_id"))
                workspace_tab_id = workspace_tab_id or _safe_text(context.get("__workspace_tab_id"))
            if not run_id or not workspace_tab_id:
                return
            session_key = f"{workspace_tab_id}:{run_id}"
            from connectors import selenium_connector as _selenium_connector  # local import to avoid hard dependency at startup
            _selenium_connector.clear_session_runtime(session_key)
        except Exception:
            logger.exception("Selenium セッションのクリーンアップに失敗しました。")

    def _emit_step_status(self, run_id, detail):
        payload = {
            "run_id": run_id,
            "step_id": str(detail.get("step_id") or ""),
            "status": str(detail.get("status") or ""),
            "message": str(detail.get("message") or ""),
        }
        self.emit_event("run.stepStatus", payload)

    def _create_run_logger(self, run_id):
        logger = logging.getLogger(f"ziz.gui.{run_id}")
        logger.setLevel(logging.INFO)
        logger.handlers = []
        logger.propagate = True
        return logger

    def _compute_duration_ms(self, started_at, finished_at):
        if not started_at or not finished_at:
            return None
        try:
            start_dt = datetime.fromisoformat(str(started_at))
            end_dt = datetime.fromisoformat(str(finished_at))
        except ValueError:
            return None
        return max(0, int((end_dt - start_dt).total_seconds() * 1000))

    def _require_run_session(self, run_id):
        key = _safe_text(run_id)
        if not key:
            raise ValueError("run_id は必須です。")
        with self._lock:
            session = self.runs.get(key)
        if not session:
            raise FileNotFoundError("対象の実行が見つかりません。")
        return session

    def _build_flow_key(self, mode, flow_path=None):
        mode_text = _safe_text(mode) or "dataflow"
        path_text = _safe_text(flow_path)
        if path_text:
            try:
                normalized_path = str(Path(path_text).resolve())
            except Exception:
                normalized_path = path_text
        else:
            normalized_path = f"<unsaved:{self._unsaved_flow_uuid}>"
        return f"{mode_text}|{normalized_path}"

    def _get_latest_flow_context(self, flow_key):
        key = _safe_text(flow_key)
        if not key:
            return {}
        with self._lock:
            latest = self.latest_by_flow.get(key) or {}
            context = latest.get("context") if isinstance(latest, dict) else {}
        return copy.copy(context) if isinstance(context, dict) else {}

    def _update_latest_by_flow(self, flow_key, seed_context, report, final_context=None):
        key = _safe_text(flow_key)
        if not key:
            return
        with self._lock:
            existing = self.latest_by_flow.get(key)
            if not isinstance(existing, dict):
                existing = {}
            current_context = copy.copy(existing.get("context")) if isinstance(existing.get("context"), dict) else {}
            context = copy.copy(seed_context) if isinstance(seed_context, dict) else current_context
            step_data = dict(existing.get("step_data") or {})
            step_ui_cache = dict(existing.get("step_ui_cache") or {})
            step_status = dict(existing.get("step_status") or {})
            for step in (report.get("steps") or []):
                step_id = _safe_text(step.get("step_id"))
                if not step_id:
                    continue
                status = _safe_text(step.get("status")) or "unknown"
                step_status[step_id] = status
                if status != "success":
                    continue
                result = step.get("result")
                ui_cache = step.get("ui_cache") if isinstance(step.get("ui_cache"), dict) else None
                if ui_cache is not None:
                    step_ui_cache[step_id] = ui_cache
                elif step_id in step_ui_cache:
                    step_ui_cache.pop(step_id, None)
                if result is not None:
                    step_data[step_id] = result
                else:
                    step_data.pop(step_id, None)
                output_var = _safe_text(step.get("output_variable")) or step_id
                if result is not None:
                    context[output_var] = result
            if isinstance(final_context, dict):
                for name, value in final_context.items():
                    key_name = _safe_text(name)
                    if not key_name:
                        continue
                    context[key_name] = value
            self.latest_by_flow[key] = {
                "context": context,
                "step_data": step_data,
                "step_ui_cache": step_ui_cache,
                "step_status": step_status,
            }

    def _get_latest_step_payload(self, payload):
        step_id = _safe_text((payload or {}).get("step_id"))
        if not step_id:
            raise ValueError("step_id は必須です。")
        mode = _safe_text((payload or {}).get("mode")) or self.current_mode or "dataflow"
        flow_key = _safe_text((payload or {}).get("flow_key")) or self._build_flow_key(mode, self.current_flow_path)
        with self._lock:
            latest = self.latest_by_flow.get(flow_key)
            step_data = (latest or {}).get("step_data") if isinstance(latest, dict) else {}
            step_ui_cache = (latest or {}).get("step_ui_cache") if isinstance(latest, dict) else {}
            step_status = (latest or {}).get("step_status") if isinstance(latest, dict) else {}
            if not isinstance(step_data, dict):
                step_data = {}
            if not isinstance(step_ui_cache, dict):
                step_ui_cache = {}
            if not isinstance(step_status, dict):
                step_status = {}
            has_data = step_id in step_data or step_id in step_ui_cache
            status = _safe_text(step_status.get(step_id))
            result = step_data.get(step_id)
            ui_cache = step_ui_cache.get(step_id) if isinstance(step_ui_cache.get(step_id), dict) else None
        if not has_data:
            if status == "error":
                raise FileNotFoundError("指定ステップの最新実行は失敗しており、成功データがありません。")
            raise FileNotFoundError("対象のステップ結果が見つかりません。")
        return {
            "result": result,
            "ui_cache": ui_cache,
            "status": status,
        }

    def _migrate_flow_state(self, old_flow_key, new_flow_key):
        old_key = _safe_text(old_flow_key)
        new_key = _safe_text(new_flow_key)
        if not old_key or not new_key or old_key == new_key:
            return
        with self._lock:
            existing = self.latest_by_flow.get(old_key)
            if existing is None:
                return
            self.latest_by_flow[new_key] = existing
            self.latest_by_flow.pop(old_key, None)

    def _normalize_log_error(self, value):
        text = _safe_text(value)
        return text if text else ""

    def _append_execution_log(self, event, payload):
        if not event:
            return
        record = {
            "ts": _iso_now(),
            "event": str(event),
        }
        if isinstance(payload, dict):
            record.update(payload)
        try:
            line = json.dumps(record, ensure_ascii=False, default=str)
        except Exception:
            return
        with self._lock:
            with self._execution_log_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    def _register_flow_token(self, path):
        normalized = str(Path(path).resolve())
        for token, saved_path in self._flow_tokens.items():
            if saved_path == normalized:
                return token
        token = f"flow:{uuid.uuid4().hex}"
        self._flow_tokens[token] = normalized
        return token

    def _build_default_flow_file_name(self, mode):
        extension = MODE_EXTENSIONS.get(mode, ".zizd")
        return f"フロー{extension}"

    def _resolve_mode(self, config, file_name):
        metadata = config.get("metadata") if isinstance(config, dict) else {}
        raw_mode = _safe_text((metadata or {}).get("mode"))
        if raw_mode in MODE_EXTENSIONS:
            return raw_mode
        suffix = Path(file_name).suffix.lower()
        for mode, extension in MODE_EXTENSIONS.items():
            if extension == suffix:
                return mode
        return "dataflow"

    def _is_secret_key(self, key):
        return _safe_text(key) in SECRET_FIELD_KEYS

    def _resolve_workspace_tab_id(self, payload, *, required):
        tab_id = _safe_text((payload or {}).get("workspace_tab_id"))
        if tab_id:
            return tab_id
        if required:
            raise ValueError("workspace_tab_id は必須です。")
        return "__global__"

    def _ensure_hidden_session(self, workspace_tab_id):
        session_id = _safe_text(workspace_tab_id) or "__global__"
        with self._lock:
            session = self._hidden_sessions.get(session_id)
            if isinstance(session, dict):
                return session
            session = {
                "values": {},
                "meta": {},
                "counters": {},
            }
            self._hidden_sessions[session_id] = session
        return session

    def _get_hidden_values(self, workspace_tab_id):
        session = self._ensure_hidden_session(workspace_tab_id)
        values = session.get("values")
        return values if isinstance(values, dict) else {}

    def _get_hidden_meta(self, workspace_tab_id):
        session = self._ensure_hidden_session(workspace_tab_id)
        meta = session.get("meta")
        return meta if isinstance(meta, dict) else {}

    def _get_hidden_counters(self, workspace_tab_id):
        session = self._ensure_hidden_session(workspace_tab_id)
        counters = session.get("counters")
        return counters if isinstance(counters, dict) else {}

    def _clear_hidden_session(self, workspace_tab_id):
        session_id = _safe_text(workspace_tab_id) or "__global__"
        with self._lock:
            self._hidden_sessions[session_id] = {
                "values": {},
                "meta": {},
                "counters": {},
            }

    def _delete_hidden_session(self, workspace_tab_id):
        session_id = _safe_text(workspace_tab_id) or "__global__"
        with self._lock:
            self._hidden_sessions.pop(session_id, None)

    def _hide_sensitive_values(self, value, current_step="global", *, workspace_tab_id):
        if isinstance(value, list):
            return [self._hide_sensitive_values(item, current_step=current_step, workspace_tab_id=workspace_tab_id) for item in value]
        if isinstance(value, dict):
            next_step = _safe_text(value.get("step_id")) or current_step
            output = {}
            for key, item in value.items():
                if self._is_secret_key(key) and isinstance(item, (str, int, float)) and _safe_text(item):
                    ref, _ = self._store_hidden_value(
                        step_name=next_step,
                        field_key=_safe_text(key),
                        actual_value=str(item),
                        workspace_tab_id=workspace_tab_id,
                    )
                    output[key] = ref
                    continue
                output[key] = self._hide_sensitive_values(item, current_step=next_step, workspace_tab_id=workspace_tab_id)
            return output
        return value

    def _restore_hidden_values(self, value, *, workspace_tab_id):
        if isinstance(value, list):
            return [self._restore_hidden_values(item, workspace_tab_id=workspace_tab_id) for item in value]
        if isinstance(value, dict):
            return {key: self._restore_hidden_values(item, workspace_tab_id=workspace_tab_id) for key, item in value.items()}
        if _is_hidden_ref(value):
            hidden_values = self._get_hidden_values(workspace_tab_id)
            return hidden_values.get(str(value), value)
        return value

    def _store_hidden_value(self, *, step_name, field_key, actual_value, current_ref=None, workspace_tab_id):
        hidden_values = self._get_hidden_values(workspace_tab_id)
        hidden_meta = self._get_hidden_meta(workspace_tab_id)
        ref = current_ref if current_ref and current_ref in hidden_values else self._allocate_hidden_ref(step_name, workspace_tab_id=workspace_tab_id)
        hidden_values[ref] = actual_value
        hidden_meta[ref] = self._build_hidden_meta(field_key, actual_value)
        return ref, hidden_meta[ref]

    def _allocate_hidden_ref(self, step_name, *, workspace_tab_id):
        scope = _sanitize_hidden_scope(step_name)
        counters = self._get_hidden_counters(workspace_tab_id)
        next_index = counters.get(scope, 0) + 1
        counters[scope] = next_index
        return f"{{{{hidden.{scope}.var{next_index}}}}}"

    def _build_hidden_meta(self, field_key, actual_value):
        text = _safe_text(actual_value)
        key = _safe_text(field_key)
        full_path = text
        if text:
            try:
                full_path = str(Path(text).expanduser().resolve())
            except Exception:
                full_path = text
        if key in {"file_path", "output_path"}:
            path_obj = Path(text)
            return {
                "display_name": path_obj.name or text,
                "display_hint": full_path,
            }
        if key in {"folder_path", "directory", "output_folder", "output_dir"}:
            path_obj = Path(text)
            folder_name = path_obj.name or text
            return {
                "display_name": folder_name,
                "display_hint": full_path,
            }
        return {
            "display_name": key,
            "display_hint": "configured",
        }

    def _collect_secret_values(self, value):
        collected = set()
        if isinstance(value, list):
            for item in value:
                collected.update(self._collect_secret_values(item))
            return collected
        if isinstance(value, dict):
            for key, item in value.items():
                if self._is_secret_key(key) and isinstance(item, (str, int, float)) and _safe_text(item):
                    collected.add(str(item))
                collected.update(self._collect_secret_values(item))
        return collected

    def mask_log_message(self, run_id, message):
        with self._lock:
            session = self.runs.get(run_id) or {}
        masked = str(message or "")
        mask_targets = set()
        for item in session.get("secret_values") or set():
            text = _safe_text(item)
            if not text:
                continue
            mask_targets.add(text)
            mask_targets.add(text.replace("\\", "/"))
            mask_targets.add(text.replace("/", "\\"))
        for target in sorted(mask_targets, key=len, reverse=True):
            masked = masked.replace(target, "***********")
        return masked

    def _success_response(self, message_id, message_type, payload):
        return {
            "v": self.PROTOCOL_VERSION,
            "kind": "res",
            "type": message_type,
            "id": message_id,
            "ts": _iso_now(),
            "payload": payload,
        }

    def _error_response(self, message_id, message_type, code, message):
        return {
            "v": self.PROTOCOL_VERSION,
            "kind": "res",
            "type": message_type,
            "id": message_id,
            "ts": _iso_now(),
            "error": {
                "code": code,
                "message": message,
                "detail": {},
                "retryable": False,
                "trace_id": uuid.uuid4().hex,
            },
        }


class WebViewBridge(QObject):
    messageToFrontend = Signal(str)
    _ASYNC_MESSAGE_TYPES = {"preview.readExcel", "preview.readCsv"}

    def __init__(self, runtime):
        super().__init__()
        self._runtime = runtime
        self._runtime.set_event_sink(self._emit_event)

    def _emit_event(self, message):
        self.messageToFrontend.emit(json.dumps(message, ensure_ascii=False))

    def _arm_hang_dump(self, message_type):
        trace_targets = {
            "file.pickFile",
            "file.pickFolder",
            "preview.readExcel",
            "preview.readCsv",
        }
        if message_type not in trace_targets:
            return None, None
        try:
            logs_dir = (self._runtime.base_dir / "logs").resolve()
            logs_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            dump_path = logs_dir / f"hang_dump_{message_type.replace('.', '_')}_{ts}.log"
            stream = dump_path.open("w", encoding="utf-8")
            stream.write(f"[hang-watch] type={message_type} armed_at={datetime.now().isoformat()}\n")
            stream.flush()
            faulthandler.dump_traceback_later(12.0, repeat=False, file=stream, exit=False)
            return stream, dump_path
        except Exception:
            logger.exception("[hang-watch] arm failed type=%s", message_type)
            return None, None

    def _disarm_hang_dump(self, stream, dump_path, message_type, elapsed_ms):
        if stream is None:
            return
        try:
            faulthandler.cancel_dump_traceback_later()
        except Exception:
            pass
        try:
            stream.write(
                f"[hang-watch] type={message_type} disarmed_at={datetime.now().isoformat()} elapsed_ms={round(elapsed_ms, 1)}\n"
            )
            stream.flush()
            stream.close()
        except Exception:
            pass
        try:
            logger.info("[hang-watch] type=%s elapsed_ms=%s dump=%s", message_type, round(elapsed_ms, 1), str(dump_path or ""))
        except Exception:
            pass

    def _emit_response(self, response):
        try:
            self.messageToFrontend.emit(json.dumps(response, ensure_ascii=False))
        except Exception:
            logger.exception("[bridge] response emit failed")

    def _run_async_message(self, raw_text, message_id, message_type):
        started = time.perf_counter()
        stream, dump_path = self._arm_hang_dump(message_type)
        try:
            response = self._runtime.handle_message(raw_text)
        except ValueError as error:
            response = self._runtime._error_response(message_id, message_type, "E_VALIDATION", str(error))
        except Exception:
            response = self._runtime._error_response(message_id, message_type, "E_INTERNAL", "内部エラーが発生しました。")
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            self._disarm_hang_dump(stream, dump_path, message_type, elapsed_ms)
        self._emit_response(response)

    @Slot(str)
    def postMessage(self, raw_text):
        message_type = "unknown"
        message_id = None
        try:
            parsed = json.loads(str(raw_text or ""))
            message_type = _safe_text(parsed.get("type")) or "unknown"
            message_id = _safe_text(parsed.get("id")) or None
        except Exception:
            pass
        if message_type in self._ASYNC_MESSAGE_TYPES:
            worker = threading.Thread(
                target=self._run_async_message,
                args=(raw_text, message_id, message_type),
                daemon=True,
                name=f"bridge-async-{message_type}",
            )
            worker.start()
            return
        started = time.perf_counter()
        stream, dump_path = self._arm_hang_dump(message_type)
        try:
            response = self._runtime.handle_message(raw_text)
        except ValueError as error:
            response = self._runtime._error_response(None, "unknown", "E_VALIDATION", str(error))
        except Exception:
            response = self._runtime._error_response(None, "unknown", "E_INTERNAL", "内部エラーが発生しました。")
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            self._disarm_hang_dump(stream, dump_path, message_type, elapsed_ms)
        self.messageToFrontend.emit(json.dumps(response, ensure_ascii=False))
