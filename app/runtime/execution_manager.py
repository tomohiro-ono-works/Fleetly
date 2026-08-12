import copy
import threading

from app.services.errors import ApplicationServiceError


def _safe_text(value):
    return str(value or "").strip()


class ExecutionManager:
    ACTIVE_STATUSES = frozenset({
        "queued",
        "running",
        "cancel_requested",
    })
    TERMINAL_STATUSES = frozenset({
        "success",
        "error",
        "cancelled",
    })

    def __init__(self, *, lock=None, session_id=""):
        self._lock = lock or threading.RLock()
        self.session_id = _safe_text(session_id)
        self.runs = {}
        self.latest_by_flow = {}
        self.active_run_by_flow = {}
        self.latest_run_by_flow = {}
        self.latest_flow_run_by_flow = {}
        self.latest_step_run_by_step = {}
        self.active_standalone_by_document = {}
        self._active_gui_workflow_run_id = ""

    def register_session(self, session):
        if not isinstance(session, dict):
            raise ValueError("session はオブジェクトで指定してください。")
        run_id = _safe_text(session.get("run_id"))
        if not run_id:
            raise ValueError("run_id は必須です。")
        run_kind = _safe_text(session.get("run_kind")) or "flow"
        execution_source = (
            _safe_text(session.get("execution_source")) or "gui"
        )
        doc_session_id = _safe_text(
            session.get("doc_session_id")
            or session.get("workspace_tab_id")
        )
        flow_id = _safe_text(session.get("flow_id")) or "01"
        flow_key = (
            _safe_text(session.get("flow_key"))
            or self.build_flow_key(doc_session_id, flow_id)
        )
        if not flow_key and run_kind != "standalone":
            raise ValueError("flow_key は必須です。")
        if run_kind == "standalone" and not doc_session_id:
            raise ValueError("doc_session_id は必須です。")

        normalized_session = session
        normalized_session["run_id"] = run_id
        normalized_session["run_kind"] = run_kind
        normalized_session["execution_source"] = execution_source
        normalized_session["doc_session_id"] = doc_session_id
        normalized_session["flow_id"] = flow_id
        normalized_session["flow_key"] = flow_key
        normalized_session["status"] = (
            _safe_text(normalized_session.get("status")) or "running"
        )
        if self.session_id and not _safe_text(
            normalized_session.get("session_id")
        ):
            normalized_session["session_id"] = self.session_id

        with self._lock:
            if run_id in self.runs:
                raise ApplicationServiceError(
                    "E_RUN_CONFLICT",
                    "同じrun_idがすでに登録されています。",
                )
            if run_kind == "standalone":
                self._assert_standalone_available_locked(doc_session_id)
            elif execution_source == "gui":
                self._assert_gui_workflow_available_locked()

            self.runs[run_id] = normalized_session
            if run_kind == "standalone":
                self.active_standalone_by_document[doc_session_id] = run_id
            else:
                if execution_source == "gui":
                    self._active_gui_workflow_run_id = run_id
                self.active_run_by_flow[flow_key] = run_id
                self.latest_run_by_flow[(doc_session_id, flow_id)] = run_id
                requested_step_id = _safe_text(
                    normalized_session.get("requested_step_id")
                )
                if run_kind == "step" and requested_step_id:
                    self.latest_step_run_by_step[
                        (doc_session_id, flow_id, requested_step_id)
                    ] = run_id
                else:
                    self.latest_flow_run_by_flow[
                        (doc_session_id, flow_id)
                    ] = run_id
        return normalized_session

    def require_session(self, run_id):
        key = _safe_text(run_id)
        if not key:
            raise ValueError("run_id は必須です。")
        with self._lock:
            session = self.runs.get(key)
        if not session:
            raise ApplicationServiceError(
                "E_RUN_NOT_FOUND",
                "対象の実行が見つかりません。",
            )
        return session

    def request_cancel(self, run_id):
        session = self.require_session(run_id)
        with self._lock:
            status = _safe_text(session.get("status")).lower()
            if status not in self.ACTIVE_STATUSES:
                return {
                    "accepted": False,
                    "run_id": _safe_text(session.get("run_id")),
                    "status": status or "unknown",
                }
            cancel_event = session.get("cancel_event")
            if cancel_event is not None:
                cancel_event.set()
            session["status"] = "cancel_requested"
            return {
                "accepted": True,
                "run_id": _safe_text(session.get("run_id")),
                "status": "cancel_requested",
            }

    def mark_terminal(
        self,
        run_id,
        *,
        status,
        finished_at=None,
        report=None,
        error=None,
    ):
        key = _safe_text(run_id)
        normalized_status = _safe_text(status).lower()
        if normalized_status not in self.TERMINAL_STATUSES:
            raise ValueError("terminal statusが不正です。")
        with self._lock:
            session = self.runs.get(key)
            if not session:
                raise ApplicationServiceError(
                    "E_RUN_NOT_FOUND",
                    "対象の実行が見つかりません。",
                )
            session["status"] = normalized_status
            if finished_at is not None:
                session["finished_at"] = finished_at
            if report is not None:
                session["report"] = report
            if error is not None:
                session["error"] = error
            self._release_active_locked(key, session)
            return session

    def release_active(self, run_id):
        key = _safe_text(run_id)
        if not key:
            return
        with self._lock:
            session = self.runs.get(key) or {}
            self._release_active_locked(key, session)

    def get_run_index(self):
        with self._lock:
            workflows = []
            indexed_runs = [
                (doc_session_id, flow_id, "", run_id)
                for (doc_session_id, flow_id), run_id in
                self.latest_flow_run_by_flow.items()
            ]
            indexed_runs.extend(
                (doc_session_id, flow_id, step_id, run_id)
                for (doc_session_id, flow_id, step_id), run_id in
                self.latest_step_run_by_step.items()
            )
            for doc_session_id, flow_id, indexed_step_id, run_id in sorted(
                indexed_runs
            ):
                session = self.runs.get(run_id)
                if not session:
                    continue
                item = {
                    "doc_session_id": doc_session_id,
                    "flow_id": flow_id,
                    "run_id": run_id,
                    "run_kind": _safe_text(session.get("run_kind")) or "flow",
                    "status": _safe_text(session.get("status")) or "unknown",
                }
                step_id = (
                    indexed_step_id
                    or _safe_text(session.get("requested_step_id"))
                )
                if step_id:
                    item["step_id"] = step_id
                invalidated_step_ids = sorted({
                    _safe_text(value)
                    for value in session.get("invalidated_step_ids") or []
                    if _safe_text(value)
                })
                if invalidated_step_ids:
                    item["invalidated_step_ids"] = invalidated_step_ids
                workflows.append(item)
            standalone = []
            for doc_session_id, run_id in sorted(
                self.active_standalone_by_document.items()
            ):
                session = self.runs.get(run_id)
                if not session:
                    continue
                standalone.append({
                    "doc_session_id": doc_session_id,
                    "run_id": run_id,
                    "status": _safe_text(session.get("status")) or "unknown",
                })
        return {
            "workflows": workflows,
            "standalone": standalone,
        }

    def get_latest_flow_context(self, flow_key):
        key = _safe_text(flow_key)
        if not key:
            return {}
        with self._lock:
            latest = self.latest_by_flow.get(key) or {}
            context = latest.get("context") if isinstance(latest, dict) else {}
        return copy.copy(context) if isinstance(context, dict) else {}

    def update_latest_by_flow(
        self,
        flow_key,
        seed_context,
        report,
        final_context=None,
    ):
        key = _safe_text(flow_key)
        if not key:
            return
        with self._lock:
            existing = self.latest_by_flow.get(key)
            if not isinstance(existing, dict):
                existing = {}
            current_context = (
                copy.copy(existing.get("context"))
                if isinstance(existing.get("context"), dict)
                else {}
            )
            context = (
                copy.copy(seed_context)
                if isinstance(seed_context, dict)
                else current_context
            )
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
                    step_data.pop(step_id, None)
                    step_ui_cache.pop(step_id, None)
                    context.pop(step_id, None)
                    continue
                result = step.get("result")
                if (
                    result is None
                    and isinstance(final_context, dict)
                    and step_id in final_context
                ):
                    result = final_context[step_id]
                ui_cache = (
                    step.get("ui_cache")
                    if isinstance(step.get("ui_cache"), dict)
                    else None
                )
                if ui_cache is not None:
                    step_ui_cache[step_id] = ui_cache
                else:
                    step_ui_cache.pop(step_id, None)
                if result is not None:
                    step_data[step_id] = result
                    context[step_id] = result
                else:
                    step_data.pop(step_id, None)
                    context.pop(step_id, None)
            if isinstance(final_context, dict):
                for name, value in final_context.items():
                    key_name = _safe_text(name)
                    if key_name:
                        context[key_name] = value
            self.latest_by_flow[key] = {
                "context": context,
                "step_data": step_data,
                "step_ui_cache": step_ui_cache,
                "step_status": step_status,
            }

    def discard_session(self, run_id):
        key = _safe_text(run_id)
        if not key:
            return
        with self._lock:
            session = self.runs.pop(key, None)
            if not session:
                return
            self._release_active_locked(key, session)
            for flow_key, indexed_run_id in list(
                self.latest_run_by_flow.items()
            ):
                if indexed_run_id == key:
                    self.latest_run_by_flow.pop(flow_key, None)
            for index in (
                self.latest_flow_run_by_flow,
                self.latest_step_run_by_step,
            ):
                for index_key, indexed_run_id in list(index.items()):
                    if indexed_run_id == key:
                        index.pop(index_key, None)

    def get_latest_step_payload(self, step_id, flow_key):
        step_key = _safe_text(step_id)
        if not step_key:
            raise ValueError("step_id は必須です。")
        key = _safe_text(flow_key)
        if not key:
            raise ValueError("flow_key は必須です。")

        with self._lock:
            latest = self.latest_by_flow.get(key)
            step_data = (
                (latest or {}).get("step_data")
                if isinstance(latest, dict)
                else {}
            )
            step_ui_cache = (
                (latest or {}).get("step_ui_cache")
                if isinstance(latest, dict)
                else {}
            )
            step_status = (
                (latest or {}).get("step_status")
                if isinstance(latest, dict)
                else {}
            )
            step_data = step_data if isinstance(step_data, dict) else {}
            step_ui_cache = (
                step_ui_cache if isinstance(step_ui_cache, dict) else {}
            )
            step_status = step_status if isinstance(step_status, dict) else {}
            has_data = step_key in step_data or step_key in step_ui_cache
            status = _safe_text(step_status.get(step_key))
            result = step_data.get(step_key)
            ui_cache = (
                step_ui_cache.get(step_key)
                if isinstance(step_ui_cache.get(step_key), dict)
                else None
            )

        if not has_data:
            if status in {"error", "cancelled"}:
                raise ApplicationServiceError(
                    "E_RESULT_NOT_FOUND",
                    "指定ステップの最新実行は成功していません。",
                )
            raise ApplicationServiceError(
                "E_RESULT_NOT_FOUND",
                "対象のステップ結果が見つかりません。",
            )
        return {
            "result": result,
            "ui_cache": ui_cache,
            "status": status,
        }

    def invalidate_document_steps(self, doc_session_id, step_ids):
        session_id = _safe_text(doc_session_id)
        if not session_id:
            raise ValueError("doc_session_id は必須です。")
        normalized_ids = {
            _safe_text(step_id)
            for step_id in step_ids or []
            if _safe_text(step_id)
        }
        if not normalized_ids:
            raise ValueError("step_ids は1件以上必要です。")
        invalidated = set()
        prefix = f"{session_id}|"
        with self._lock:
            for flow_key, latest in self.latest_by_flow.items():
                if not flow_key.startswith(prefix) or not isinstance(latest, dict):
                    continue
                context = latest.get("context")
                step_data = latest.get("step_data")
                step_ui_cache = latest.get("step_ui_cache")
                step_status = latest.get("step_status")
                for step_id in normalized_ids:
                    removed = False
                    for mapping in (
                        context,
                        step_data,
                        step_ui_cache,
                        step_status,
                    ):
                        if isinstance(mapping, dict) and step_id in mapping:
                            mapping.pop(step_id, None)
                            removed = True
                    if removed:
                        invalidated.add(step_id)
            for session in self.runs.values():
                if _safe_text(session.get("doc_session_id")) != session_id:
                    continue
                requested_step_id = _safe_text(
                    session.get("requested_step_id")
                )
                plan = session.get("plan")
                run_step_ids = (
                    {requested_step_id}
                    if requested_step_id
                    else {
                        _safe_text(value)
                        for value in getattr(plan, "step_ids", []) or []
                        if _safe_text(value)
                    }
                )
                matching = normalized_ids.intersection(run_step_ids)
                if not matching:
                    continue
                session["invalidated_step_ids"] = sorted({
                    *(
                        session.get("invalidated_step_ids")
                        or []
                    ),
                    *matching,
                })
            for key in list(self.latest_step_run_by_step):
                if key[0] == session_id and key[2] in normalized_ids:
                    self.latest_step_run_by_step.pop(key, None)
        return {
            "doc_session_id": session_id,
            "invalidated_step_ids": sorted(invalidated),
        }

    def migrate_flow_state(self, old_flow_key, new_flow_key):
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

    def close_document(self, doc_session_id):
        session_id = _safe_text(doc_session_id)
        if not session_id:
            raise ValueError("doc_session_id は必須です。")
        with self._lock:
            matching_run_ids = [
                run_id
                for run_id, session in self.runs.items()
                if _safe_text(
                    session.get("doc_session_id")
                    or session.get("workspace_tab_id")
                ) == session_id
            ]
            if any(
                _safe_text(
                    (self.runs.get(run_id) or {}).get("status")
                ).lower() in self.ACTIVE_STATUSES
                for run_id in matching_run_ids
            ):
                raise ApplicationServiceError(
                    "E_RUN_CONFLICT",
                    "documentに実行中のrunがあります。",
                )

            flow_keys = {
                _safe_text((self.runs.get(run_id) or {}).get("flow_key"))
                for run_id in matching_run_ids
            }
            flow_keys.discard("")
            for run_id in matching_run_ids:
                self.runs.pop(run_id, None)
            for flow_key in flow_keys:
                self.latest_by_flow.pop(flow_key, None)
                self.active_run_by_flow.pop(flow_key, None)
            for key in list(self.latest_run_by_flow):
                if key[0] == session_id:
                    self.latest_run_by_flow.pop(key, None)
            for index in (
                self.latest_flow_run_by_flow,
                self.latest_step_run_by_step,
            ):
                for key in list(index):
                    if key[0] == session_id:
                        index.pop(key, None)
            self.active_standalone_by_document.pop(session_id, None)

        return {
            "doc_session_id": session_id,
            "released_run_count": len(matching_run_ids),
            "released_flow_count": len(flow_keys),
        }

    @staticmethod
    def build_flow_key(doc_session_id, flow_id):
        normalized_session_id = _safe_text(doc_session_id)
        normalized_flow_id = _safe_text(flow_id)
        if not normalized_session_id or not normalized_flow_id:
            return ""
        return f"{normalized_session_id}|{normalized_flow_id}"

    def _assert_gui_workflow_available_locked(self):
        active_run_id = _safe_text(self._active_gui_workflow_run_id)
        active = self.runs.get(active_run_id) if active_run_id else None
        if active and _safe_text(active.get("status")).lower() in self.ACTIVE_STATUSES:
            raise ApplicationServiceError(
                "E_RUN_CONFLICT",
                "ワークフローが実行中です。完了またはキャンセル後に再実行してください。",
            )
        if active_run_id:
            self._active_gui_workflow_run_id = ""

    def _assert_standalone_available_locked(self, doc_session_id):
        active_run_id = _safe_text(
            self.active_standalone_by_document.get(doc_session_id)
        )
        active = self.runs.get(active_run_id) if active_run_id else None
        if active and _safe_text(active.get("status")).lower() in self.ACTIVE_STATUSES:
            raise ApplicationServiceError(
                "E_RUN_CONFLICT",
                "このdocumentでは単体実行が進行中です。",
            )
        if active_run_id:
            self.active_standalone_by_document.pop(doc_session_id, None)

    def _release_active_locked(self, run_id, session):
        run_kind = _safe_text(session.get("run_kind")) or "flow"
        doc_session_id = _safe_text(
            session.get("doc_session_id")
            or session.get("workspace_tab_id")
        )
        flow_key = _safe_text(session.get("flow_key"))
        if (
            self._active_gui_workflow_run_id == run_id
            and run_kind != "standalone"
        ):
            self._active_gui_workflow_run_id = ""
        if flow_key and self.active_run_by_flow.get(flow_key) == run_id:
            self.active_run_by_flow.pop(flow_key, None)
        if (
            doc_session_id
            and self.active_standalone_by_document.get(doc_session_id)
            == run_id
        ):
            self.active_standalone_by_document.pop(doc_session_id, None)
