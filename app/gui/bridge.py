import copy
import getpass
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

from app.gui.bridge_contract import (
    PROTOCOL_VERSION as QWEBCHANNEL_PROTOCOL_VERSION,
    build_event,
)
from app.gui.bridge_dispatcher import BridgeCommandDispatcher
from app.gui.bridge_security import BridgeSecurityPolicy
from app.runtime.execution_manager import ExecutionManager
from app.runtime.result_cache import ResultCache
from app.runtime.run_ids import new_session_id
from app.runtime.run_log_store import RunLogStore
from app.runtime.worker_pool import WorkerPool
from app.services.catalog_service import CatalogService
from app.services.document_service import DocumentService
from app.services.errors import ApplicationServiceError
from app.services.google_auth_service import GoogleAuthService
from app.services.hidden_value_service import HiddenValueService
from app.services.host_capability_service import HostCapabilityService
from app.services.preview_service import PreviewService
from app.services.result_service import ResultService
from app.services.run_service import RunService
from app.services.standalone_execution_service import (
    StandaloneExecutionService,
)
from app.services.workspace_service import WorkspaceService
from app.services.workflow_document_service import WorkflowDocumentService
from app.services.workflow_execution_service import WorkflowExecutionService
from core.security_policies import load_security_policies
from shared.security_sanitizer import SensitiveDataSanitizer

logger = logging.getLogger("ziz.gui_bridge")


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


def _safe_text(value):
    return str(value or "").strip()


class BridgeRuntime:
    PROTOCOL_VERSION = QWEBCHANNEL_PROTOCOL_VERSION

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
        open_external_callback=None,
        host_owner_thread_id=None,
        catalog_root=None,
    ):
        self.base_dir = Path(base_dir).resolve()
        self.debug = bool(debug)
        self._event_sink = None
        self._lock = threading.RLock()
        self._shutting_down = False
        self.security_sanitizer = SensitiveDataSanitizer()
        self.host_capability_service = HostCapabilityService(
            pick_file=pick_file_callback,
            pick_folder=pick_folder_callback,
            edit_file=edit_file_callback,
            edit_folder=edit_folder_callback,
            open_document=open_flow_callback,
            save_document=save_flow_callback,
            window_control=window_control_callback,
            coordinate_capture=coordinate_capture_callback,
            open_external=open_external_callback,
            owner_thread_id=host_owner_thread_id,
        )
        self.google_auth_service = GoogleAuthService()
        self.preview_service = PreviewService()
        self.session_id = new_session_id()
        self.catalog_service = CatalogService(catalog_root=catalog_root)
        self.execution_manager = ExecutionManager(
            lock=self._lock,
            session_id=self.session_id,
        )
        self.result_cache = ResultCache(lock=self._lock)
        self.run_log_store = RunLogStore(
            self.base_dir / "logs",
            lock=self._lock,
        )
        self.result_service = ResultService(
            self.result_cache,
            self.run_log_store,
            self.execution_manager,
        )
        self.run_service = RunService(
            execution_manager=self.execution_manager,
            workflow_document_service=WorkflowDocumentService(
                self.catalog_service
            ),
            workflow_execution_service=WorkflowExecutionService(),
            standalone_execution_service=StandaloneExecutionService(
                self.catalog_service,
                self.result_cache,
            ),
            result_cache=self.result_cache,
            run_log_store=self.run_log_store,
            worker_pool=WorkerPool(max_workers=4),
            sanitizer=self.security_sanitizer,
            event_sink=self.emit_event,
        )
        self.workspace_service = WorkspaceService(self.base_dir)
        self.hidden_value_service = HiddenValueService(lock=self._lock)
        self.document_service = DocumentService(
            self.workspace_service,
            self.hidden_value_service,
            open_document_callback=(
                self.host_capability_service.open_document
                if self.host_capability_service.supports("open_flow_dialog")
                else None
            ),
            save_document_callback=(
                self.host_capability_service.save_document
                if self.host_capability_service.supports("save_flow_dialog")
                else None
            ),
            close_callback=self._close_document_runtime_state,
            lock=self._lock,
        )

        self.config_root = self.workspace_service.config_root
        security_policy = BridgeSecurityPolicy(
            capabilities=self.host_capability_service.capabilities,
        )
        self.dispatcher = BridgeCommandDispatcher(
            self._build_command_handlers(),
            protocol_version=self.PROTOCOL_VERSION,
            command_observer=self._observe_command,
            error_observer=self._observe_command_error,
            security_policy=security_policy,
            security_observer=self._observe_security_decision,
            sanitizer=self.security_sanitizer,
        )

    def set_event_sink(self, callback):
        self._event_sink = callback

    @property
    def workspace_root(self):
        return self.workspace_service.workspace_root

    @workspace_root.setter
    def workspace_root(self, value):
        self.workspace_service.workspace_root = value

    def emit_event(self, message_type, payload):
        if not self._event_sink:
            return
        event = build_event(
            message_type,
            payload,
            protocol_version=self.PROTOCOL_VERSION,
        )
        self._event_sink(self.security_sanitizer.sanitize_structure(
            event,
            mask_paths=True,
        ))

    def handle_message(self, raw_text):
        return self.dispatcher.dispatch_raw(raw_text)

    def shutdown(self, timeout_seconds=1.0):
        with self._lock:
            self._shutting_down = True
        return self.run_service.shutdown(timeout_seconds)

    def _close_document_runtime_state(self, doc_session_id):
        released_resources = self.run_service.managed_resources.release_document(
            doc_session_id
        )
        runtime_result = self.execution_manager.close_document(doc_session_id)
        result_cache = self.result_service.close_document(
            doc_session_id=doc_session_id,
        )
        return {
            **runtime_result,
            "released_result_count": result_cache["released_run_count"],
            "released_resource_count": released_resources,
        }

    def _build_command_handlers(self):
        return {
            "app.getStatus": self._handle_app_get_status,
            "app.logUiEvent": self._handle_app_log_ui_event,
            "app.windowControl": self._handle_app_window_control,
            "mouse.coordinateCapture.start": self._handle_mouse_coordinate_capture_start,
            "app.openExternal": self._handle_app_open_external,
            "app.googleAuthLogin": self._handle_app_google_auth_login,
            "app.googleAuthStatus": self._handle_app_google_auth_status,
            "app.getSuggestIndex": self._handle_app_get_suggest_index,
            "run.start": self._handle_run_start,
            "documents.list": self._handle_documents_list,
            "documents.load": self._handle_documents_load,
            "documents.save": self._handle_documents_save,
            "documents.close": self._handle_documents_close,
            "run.cancel": self._handle_run_cancel,
            "result.getSummary": self._handle_result_get_summary,
            "result.getSchema": self._handle_result_get_schema,
            "result.getPreview": self._handle_result_get_preview,
            "result.getLogs": self._handle_result_get_logs,
            "result.invalidateSteps": self._handle_result_invalidate_steps,
            "file.pickFile": self._handle_file_pick_file,
            "file.pickFolder": self._handle_file_pick_folder,
            "workspace.pickRoot": self._handle_workspace_pick_root,
            "workspace.getRoot": self._handle_workspace_get_root,
            "workspace.setRoot": self._handle_workspace_set_root,
            "workspace.list": self._handle_workspace_list,
            "workspace.stat": self._handle_workspace_stat,
            "workspace.readText": self._handle_workspace_read_text,
            "workspace.writeText": self._handle_workspace_write_text,
            "workspace.mkdir": self._handle_workspace_mkdir,
            "workspace.delete": self._handle_workspace_delete,
            "preview.readExcel": self._handle_preview_read_excel,
            "preview.readCsv": self._handle_preview_read_csv,
            "catalog.getConnectors": self._handle_catalog_get_connectors,
            "catalog.getActions": self._handle_catalog_get_actions,
            "catalog.getForms": self._handle_catalog_get_forms,
            "catalog.getDataAreaPolicy": self._handle_catalog_get_data_area_policy,
            "catalog.getSecurityPolicySummary": self._handle_catalog_get_security_policy_summary,
        }

    def _handle_catalog_get_connectors(self, _payload):
        return self.catalog_service.get_connectors()

    def _handle_catalog_get_actions(self, _payload):
        return self.catalog_service.get_actions()

    def _handle_catalog_get_forms(self, _payload):
        return self.catalog_service.get_forms()

    def _handle_catalog_get_data_area_policy(self, _payload):
        return self.catalog_service.get_data_area_policy()

    def _handle_catalog_get_security_policy_summary(self, _payload):
        return self.catalog_service.get_security_policy_summary()

    def _observe_command(self, message_type, payload):
        if message_type not in {"documents.save", "workspace.writeText"}:
            return
        logger.info(
            "[save-trace][bridge] recv type=%s fields=%s content_len=%s",
            message_type,
            ",".join(sorted(str(key) for key in (payload or {}))),
            len(str((payload or {}).get("content") or "")),
        )

    def _observe_command_error(self, message_type, payload, code, message):
        logger.error(
            "[bridge-command-error] type=%s code=%s message=%s",
            message_type,
            str(code or ""),
            self.security_sanitizer.sanitize_text(message, mask_paths=True),
        )

    def _observe_security_decision(self, message_type, profile, decision, reason, trace_id):
        if decision == "allowed" and profile not in {"execute", "host"}:
            return
        log_method = logger.info if decision == "allowed" else logger.warning
        log_method(
            "[bridge-security] trace_id=%s type=%s profile=%s decision=%s reason=%s",
            trace_id,
            message_type,
            profile,
            decision,
            reason or "-",
        )

    def _handle_app_get_status(self, payload=None):
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
            "capabilities": list(self.dispatcher.command_types),
            "security_policies": {
                "loaded": bool(policies.get("loaded")),
                "api_profile_count": len(policies.get("apis", {}).get("profiles", {})),
                "web_allowlist_count": len(policies.get("web", {}).get("allowlist", [])),
            },
            "runtime_context_defaults": self._build_runtime_context_defaults(),
            "session_id": self.session_id,
            "run_index": self.execution_manager.get_run_index(),
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
        detail = self.security_sanitizer.sanitize_structure(
            detail,
            mask_paths=True,
        ) if isinstance(detail, dict) else detail
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
        return {"logged": True}

    def _handle_app_window_control(self, payload):
        return self.host_capability_service.control_window(
            (payload or {}).get("action")
        )

    def _handle_mouse_coordinate_capture_start(self, payload):
        return self.host_capability_service.start_coordinate_capture(
            (payload or {}).get("capture_id")
        )

    def _handle_app_open_external(self, payload):
        return self.host_capability_service.open_external(
            url=(payload or {}).get("url"),
            prefer=(payload or {}).get("prefer"),
        )

    def _handle_app_google_auth_login(self, payload):
        return self.google_auth_service.login(
            mode=(payload or {}).get("mode")
        )

    def _handle_app_google_auth_status(self, payload):
        return self.google_auth_service.get_status(
            mode=(payload or {}).get("mode")
        )

    def _handle_documents_list(self, payload):
        started = time.perf_counter()
        response = self.document_service.list_documents(
            scope=(payload or {}).get("scope") or "local",
            kind=(payload or {}).get("kind") or "recent",
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "[bridge] documents.list kind=%s count=%s elapsed_ms=%s",
            response["kind"],
            len(response["items"]),
            elapsed_ms,
        )
        return response

    def _handle_documents_load(self, payload):
        started = time.perf_counter()
        doc_session_id = _safe_text((payload or {}).get("doc_session_id"))
        response = self.document_service.load_document(
            doc_session_id=doc_session_id,
            document_token=(payload or {}).get("document_token"),
            scope=(payload or {}).get("scope"),
            rel_path=(
                (payload or {}).get("rel_path")
                if "rel_path" in (payload or {})
                else None
            ),
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "[bridge] documents.load selected=%s session=%s elapsed_ms=%s",
            bool(response.get("selected")),
            doc_session_id,
            elapsed_ms,
        )
        return response

    def _handle_documents_save(self, payload):
        started = time.perf_counter()
        doc_session_id = _safe_text((payload or {}).get("doc_session_id"))
        mode = _safe_text((payload or {}).get("mode")) or "dataflow"
        response = self.document_service.save_document(
            doc_session_id=doc_session_id,
            mode=mode,
            document_ref=(payload or {}).get("document_ref"),
            file_name=(payload or {}).get("file_name"),
            scope=(payload or {}).get("scope"),
            rel_path=(
                (payload or {}).get("rel_path")
                if "rel_path" in (payload or {})
                else None
            ),
            document=copy.deepcopy((payload or {}).get("document")),
        )
        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        logger.info(
            "[bridge] documents.save saved=%s session=%s mode=%s elapsed_ms=%s",
            bool(response.get("saved")),
            doc_session_id,
            mode,
            elapsed_ms,
        )
        return response

    def _handle_documents_close(self, payload):
        doc_session_id = _safe_text((payload or {}).get("doc_session_id"))
        return self.document_service.close_document(
            doc_session_id=doc_session_id,
        )

    def _handle_run_start(self, payload):
        with self._lock:
            if self._shutting_down:
                raise ApplicationServiceError(
                    "E_NOT_READY",
                    "アプリケーションは終了処理中です。",
                )
        request = payload or {}
        doc_session_id = _safe_text(request.get("doc_session_id"))
        if _safe_text(request.get("run_kind")) == "standalone":
            restored_request = self.hidden_value_service.restore_values(
                copy.deepcopy({
                    "params": request.get("params") or {},
                    "result_export": request.get("result_export"),
                }),
                doc_session_id=doc_session_id,
            )
            return self.run_service.start_standalone(
                doc_session_id=doc_session_id,
                connector_id=request.get("connector_id"),
                action_id=request.get("action_id"),
                params=restored_request.get("params") or {},
                result_mode=request.get("result_mode"),
                dry_run=bool(request.get("dry_run")),
                result_export=restored_request.get("result_export"),
                secret_values=self.hidden_value_service.collect_secret_values(
                    restored_request
                ),
            )

        document = self.hidden_value_service.restore_values(
            copy.deepcopy(request.get("document") or {}),
            doc_session_id=doc_session_id,
        )
        document_session = self.document_service.get_session(doc_session_id)
        document_ref = _safe_text(request.get("document_ref"))
        session_document_ref = _safe_text(
            (document_session or {}).get("document_ref")
        )
        if (
            document_ref
            and session_document_ref
            and document_ref != session_document_ref
        ):
            raise ValueError(
                "document_ref がdoc_session_idと一致しません。"
            )
        flow_path = (
            _safe_text((document_session or {}).get("path"))
            or "<unsaved>"
        )
        return self.run_service.start_workflow(
            doc_session_id=doc_session_id,
            document=document,
            document_ref=document_ref or session_document_ref,
            flow_id=request.get("flow_id"),
            step_id=request.get("step_id"),
            flow_path=flow_path,
            workspace_root=(
                str(self.workspace_root)
                if self.workspace_root
                else ""
            ),
            secret_values=self.hidden_value_service.collect_secret_values(
                document
            ),
        )

    def _handle_run_cancel(self, payload):
        run_id = _safe_text((payload or {}).get("run_id"))
        if not run_id:
            raise ValueError("run_id は必須です。")
        return self.run_service.cancel(run_id)

    def _handle_result_get_summary(self, payload):
        return self.result_service.get_summary(
            run_id=(payload or {}).get("run_id"),
        )

    def _handle_result_get_schema(self, payload):
        return self.result_service.get_schema(
            run_id=(payload or {}).get("run_id"),
            step_id=(payload or {}).get("step_id"),
        )

    def _handle_result_get_preview(self, payload):
        return self.result_service.get_preview(
            run_id=(payload or {}).get("run_id"),
            step_id=(payload or {}).get("step_id"),
        )

    def _handle_result_get_logs(self, payload):
        return self.result_service.get_logs(
            run_id=(payload or {}).get("run_id"),
            before_seq=(payload or {}).get("before_seq"),
            after_seq=(payload or {}).get("after_seq"),
        )

    def _handle_result_invalidate_steps(self, payload):
        doc_session_id = (payload or {}).get("doc_session_id")
        result = self.result_service.invalidate_steps(
            doc_session_id=doc_session_id,
            step_ids=(payload or {}).get("step_ids"),
        )
        released_resources = 0
        for step_id in result.get("invalidated_step_ids") or []:
            released_resources += (
                self.run_service.managed_resources.release_step(
                    doc_session_id,
                    step_id,
                )
            )
        return {
            **result,
            "released_resource_count": released_resources,
        }

    def _handle_file_pick_file(self, payload):
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        title = _safe_text((payload or {}).get("title")) or "ファイルを選択"
        filters = (payload or {}).get("filters") or []
        current_ref = _safe_text((payload or {}).get("current_ref")) or None
        current_value = self._resolve_picker_initial_value(payload, current_ref, workspace_tab_id=workspace_tab_id)
        selected_path = self.host_capability_service.pick_file(
            title=title,
            filters=filters,
            current_value=current_value,
        )
        if not selected_path:
            return {"selected": False}
        ref, meta = self.hidden_value_service.store_value(
            doc_session_id=workspace_tab_id,
            step_name=_safe_text((payload or {}).get("step_name")) or "global",
            field_key=_safe_text((payload or {}).get("field_key")) or "file_path",
            actual_value=str(selected_path),
            current_ref=current_ref,
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or "",
            "display_hint": meta.get("display_hint") or "",
            "selected": True,
        }

    def _handle_file_pick_folder(self, payload):
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        title = _safe_text((payload or {}).get("title")) or "フォルダを選択"
        current_ref = _safe_text((payload or {}).get("current_ref")) or None
        current_value = self._resolve_picker_initial_value(payload, current_ref, workspace_tab_id=workspace_tab_id)
        selected_path = self.host_capability_service.pick_folder(
            title=title,
            current_value=current_value,
            edit_current=bool(current_ref),
        )
        if not selected_path:
            return {"selected": False}
        ref, meta = self.hidden_value_service.store_value(
            doc_session_id=workspace_tab_id,
            step_name=_safe_text((payload or {}).get("step_name")) or "global",
            field_key=_safe_text((payload or {}).get("field_key")) or "folder_path",
            actual_value=str(selected_path),
            current_ref=current_ref,
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or "",
            "display_hint": meta.get("display_hint") or "",
            "selected": True,
        }

    def _handle_workspace_pick_root(self, payload):
        selected_path = self.host_capability_service.pick_folder(
            title=(
                _safe_text((payload or {}).get("title"))
                or "ワークスペースルートを選択"
            ),
            current_value=(
                _safe_text((payload or {}).get("current_value"))
                or str(self.workspace_root or "")
            ),
            edit_current=False,
        )
        return self.workspace_service.select_root(selected_path)

    def _handle_workspace_get_root(self, payload):
        return self.workspace_service.get_root()

    def _handle_workspace_set_root(self, payload):
        return self.workspace_service.set_root(
            (payload or {}).get("root_path")
        )

    def _handle_workspace_list(self, payload):
        return self.workspace_service.list_entries(
            scope=(payload or {}).get("scope") or "root",
            rel_path=(payload or {}).get("rel_path") or "",
        )

    def _handle_workspace_read_text(self, payload):
        return self.workspace_service.read_text(
            scope=(payload or {}).get("scope") or "root",
            rel_path=(payload or {}).get("rel_path"),
        )

    def _handle_workspace_stat(self, payload):
        return self.workspace_service.stat(
            scope=(payload or {}).get("scope") or "root",
            rel_path=(payload or {}).get("rel_path"),
        )

    def _handle_workspace_write_text(self, payload):
        return self.workspace_service.write_text(
            scope=(payload or {}).get("scope") or "root",
            rel_path=(payload or {}).get("rel_path"),
            content=(payload or {}).get("content"),
            force=bool((payload or {}).get("force")),
            expected_mtime_ns=(payload or {}).get("expected_mtime_ns"),
        )

    def _handle_workspace_mkdir(self, payload):
        return self.workspace_service.mkdir(
            scope=(payload or {}).get("scope") or "root",
            rel_path=(payload or {}).get("rel_path"),
        )

    def _handle_workspace_delete(self, payload):
        return self.workspace_service.delete(
            scope=(payload or {}).get("scope") or "root",
            rel_path=(payload or {}).get("rel_path"),
            recursive=(payload or {}).get("recursive") is True,
        )

    def _handle_preview_read_excel(self, payload):
        workspace_tab_id = self._resolve_workspace_tab_id(payload, required=True)
        actual_path, ref, meta = self._resolve_hidden_or_current_path(
            payload,
            field_key=_safe_text((payload or {}).get("field_key")) or "file_path",
            workspace_tab_id=workspace_tab_id,
        )
        if not actual_path:
            raise ValueError("Excel ファイルが選択されていません。")

        preview = self.preview_service.read_excel(
            file_path=actual_path,
            sheet_name=_safe_text((payload or {}).get("sheet_name")),
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or Path(actual_path).name,
            "display_hint": meta.get("display_hint") or "",
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

        preview = self.preview_service.read_csv(
            file_path=actual_path,
            encoding=(payload or {}).get("encoding"),
            delimiter=(payload or {}).get("delimiter"),
        )
        return {
            "ref": ref,
            "display_name": meta.get("display_name") or Path(actual_path).name,
            "display_hint": meta.get("display_hint") or "",
            **preview,
        }

    def _resolve_picker_initial_value(self, payload, current_ref, *, workspace_tab_id):
        return self.hidden_value_service.resolve_picker_value(
            doc_session_id=workspace_tab_id,
            current_ref=current_ref,
            current_value=(payload or {}).get("current_value"),
        )

    def _resolve_hidden_or_current_path(self, payload, *, field_key, workspace_tab_id):
        current_ref = _safe_text((payload or {}).get("current_ref")) or None
        current_value = self._resolve_picker_initial_value(payload, current_ref, workspace_tab_id=workspace_tab_id)
        actual_path = str(current_value or "")
        if not actual_path:
            raise ValueError("対象パスが未設定です。")
        path_obj = Path(actual_path).resolve()
        if not path_obj.exists():
            raise FileNotFoundError(f"ファイルが見つかりません: {path_obj}")
        hidden_meta = self.hidden_value_service.get_meta(workspace_tab_id)
        meta = (
            hidden_meta.get(current_ref)
            if current_ref and current_ref in hidden_meta
            else self.hidden_value_service.build_meta(field_key, actual_path)
        )
        return str(path_obj), current_ref or "", meta

    def _resolve_workspace_tab_id(self, payload, *, required):
        tab_id = _safe_text((payload or {}).get("workspace_tab_id"))
        if tab_id:
            return tab_id
        if required:
            raise ValueError("workspace_tab_id は必須です。")
        return "__global__"
