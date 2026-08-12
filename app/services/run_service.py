import copy
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

from app.runtime.managed_resources import managed_resource_registry
from app.runtime.run_ids import new_run_id, new_trace_id
from app.services.errors import ApplicationServiceError
from app.services.run_logging import RunLogHandler
from app.services.standalone_execution_service import (
    StandaloneCancelledError,
)


def _safe_text(value):
    return str(value or "").strip()


def _iso_now():
    return datetime.now(timezone.utc).isoformat()


class RunService:
    def __init__(
        self,
        *,
        execution_manager,
        workflow_document_service,
        workflow_execution_service,
        standalone_execution_service,
        result_cache,
        run_log_store,
        worker_pool,
        sanitizer,
        event_sink=None,
        max_parallel_steps=4,
        thread_factory=None,
        managed_resources=None,
    ):
        self.execution_manager = execution_manager
        self.workflow_document_service = workflow_document_service
        self.workflow_execution_service = workflow_execution_service
        self.standalone_execution_service = standalone_execution_service
        self.result_cache = result_cache
        self.run_log_store = run_log_store
        self.worker_pool = worker_pool
        self.sanitizer = sanitizer
        self.event_sink = event_sink
        self.max_parallel_steps = max(1, int(max_parallel_steps))
        self.thread_factory = thread_factory or threading.Thread
        self.managed_resources = (
            managed_resources or managed_resource_registry
        )

    def set_event_sink(self, callback):
        self.event_sink = callback

    def start_workflow(
        self,
        *,
        doc_session_id,
        document,
        flow_id,
        step_id=None,
        document_ref="",
        flow_path="<unsaved>",
        workspace_root="",
        secret_values=None,
    ):
        normalized_doc_session_id = self._require_text(
            doc_session_id,
            "doc_session_id",
        )
        plan = self.workflow_document_service.prepare_run(
            document,
            flow_id=flow_id,
            step_id=step_id,
        )
        run_kind = "step" if plan.requested_step_id else "flow"
        run_id = new_run_id("gui", run_kind)
        trace_id = new_trace_id()
        started_at = _iso_now()
        cancel_event = threading.Event()
        flow_key = self.execution_manager.build_flow_key(
            normalized_doc_session_id,
            plan.flow_id,
        )
        if run_kind == "step":
            self.managed_resources.release_step(
                normalized_doc_session_id,
                plan.requested_step_id,
            )
        seed_context = (
            self.execution_manager.get_latest_flow_context(flow_key)
            if run_kind == "step"
            else {}
        )
        seed_context = copy.copy(seed_context)
        seed_context.update({
            "__run_id": run_id,
            "__doc_session_id": normalized_doc_session_id,
            "__workspace_tab_id": normalized_doc_session_id,
            "__run_kind": run_kind,
        })
        if _safe_text(workspace_root):
            seed_context["__workspace_root"] = _safe_text(workspace_root)
        normalized_flow_path = _safe_text(flow_path) or "<unsaved>"
        if normalized_flow_path != "<unsaved>":
            seed_context["__flow_dir"] = str(
                Path(normalized_flow_path).resolve().parent
            )
        result_step_ids = (
            [plan.requested_step_id]
            if plan.requested_step_id
            else list(plan.step_ids)
        )
        session = {
            "run_id": run_id,
            "trace_id": trace_id,
            "session_id": self.execution_manager.session_id,
            "execution_source": "gui",
            "run_kind": run_kind,
            "doc_session_id": normalized_doc_session_id,
            "document_ref": _safe_text(document_ref),
            "flow_id": plan.flow_id,
            "flow_key": flow_key,
            "flow_name": plan.flow_name,
            "flow_path": normalized_flow_path,
            "status": "running",
            "started_at": started_at,
            "finished_at": None,
            "step_count": len(result_step_ids),
            "requested_step_id": plan.requested_step_id,
            "seed_context": seed_context,
            "cancel_event": cancel_event,
            "secret_values": set(secret_values or set()),
            "plan": plan,
            "cache_results": True,
            "emit_events": True,
        }
        worker = self.thread_factory(
            target=self._workflow_worker,
            args=(run_id,),
            daemon=True,
        )
        session["thread"] = worker
        self.execution_manager.register_session(session)
        try:
            self.result_cache.register_run(
                run_id=run_id,
                trace_id=trace_id,
                doc_session_id=normalized_doc_session_id,
                flow_id=plan.flow_id,
                run_kind=run_kind,
                execution_source="gui",
                flow_name=plan.flow_name,
                started_at=started_at,
                step_ids=result_step_ids,
                session_id=self.execution_manager.session_id,
            )
            worker.start()
        except Exception:
            self.result_cache.forget_run(run_id)
            self.execution_manager.discard_session(run_id)
            raise
        return self._start_response(session)

    def start_standalone(
        self,
        *,
        doc_session_id,
        connector_id,
        action_id,
        params,
        result_mode,
        dry_run=False,
        result_export=None,
        secret_values=None,
    ):
        normalized_doc_session_id = self._require_text(
            doc_session_id,
            "doc_session_id",
        )
        plan = self.standalone_execution_service.prepare_run(
            connector_id=connector_id,
            action_id=action_id,
            params=params,
            result_mode=result_mode,
            dry_run=dry_run,
            result_export=result_export,
        )
        run_id = new_run_id("gui", "standalone")
        trace_id = new_trace_id()
        started_at = _iso_now()
        session = {
            "run_id": run_id,
            "trace_id": trace_id,
            "session_id": self.execution_manager.session_id,
            "execution_source": "gui",
            "run_kind": "standalone",
            "doc_session_id": normalized_doc_session_id,
            "flow_id": "",
            "flow_key": "",
            "status": "queued",
            "started_at": started_at,
            "finished_at": None,
            "cancel_event": threading.Event(),
            "secret_values": set(secret_values or set()),
            "plan": plan,
            "cache_results": False,
            "emit_events": True,
        }
        worker = self.thread_factory(
            target=self._standalone_worker,
            args=(run_id,),
            daemon=True,
        )
        session["thread"] = worker
        self.execution_manager.register_session(session)
        try:
            worker.start()
        except Exception:
            self.execution_manager.discard_session(run_id)
            raise
        return self._start_response(session)

    def run_cli_file(self, flow_path, *, logger, flow_id=None):
        normalized_path = Path(flow_path).resolve()
        if not normalized_path.is_file():
            raise FileNotFoundError(
                f"ファイルが見つかりません: {normalized_path}"
            )
        with normalized_path.open("r", encoding="utf-8") as handle:
            document = yaml.safe_load(handle) or {}
        metadata = (
            document.get("metadata")
            if isinstance(document, dict)
            else {}
        )
        selected_flow_id = (
            _safe_text(flow_id)
            or _safe_text((metadata or {}).get("default_flow_id"))
            or "01"
        )
        plan = self.workflow_document_service.prepare_run(
            document,
            flow_id=selected_flow_id,
        )
        run_id = new_run_id("cli", "flow")
        session = {
            "run_id": run_id,
            "trace_id": new_trace_id(),
            "session_id": "",
            "execution_source": "cli",
            "run_kind": "flow",
            "doc_session_id": f"cli:{normalized_path}",
            "flow_id": plan.flow_id,
            "flow_key": f"cli:{normalized_path}|{plan.flow_id}",
            "flow_name": plan.flow_name,
            "flow_path": str(normalized_path),
            "status": "running",
            "started_at": _iso_now(),
            "finished_at": None,
            "step_count": len(plan.step_ids),
            "requested_step_id": "",
            "seed_context": {
                "__run_id": run_id,
                "__flow_dir": str(normalized_path.parent),
                "__run_kind": "flow",
            },
            "cancel_event": threading.Event(),
            "secret_values": {str(normalized_path)},
            "plan": plan,
            "cache_results": False,
            "emit_events": False,
            "logger": logger,
        }
        self.execution_manager.register_session(session)
        self._execute_workflow(session)
        report = copy.deepcopy(session.get("report") or {})
        report.update({
            "run_id": run_id,
            "trace_id": session["trace_id"],
            "execution_source": "cli",
            "run_kind": "flow",
            "flow_id": plan.flow_id,
        })
        return report

    def cancel(self, run_id):
        result = self.execution_manager.request_cancel(run_id)
        if result.get("accepted"):
            self._emit_event_for_run(
                run_id,
                "run.progress",
                {
                    "run_id": run_id,
                    "stage": "cancel_requested",
                    "percent": None,
                    "message": "キャンセル要求を受け付けました。",
                },
            )
        return result

    def shutdown(self, timeout_seconds=1.0):
        deadline = time.monotonic() + max(0.0, float(timeout_seconds))
        workers = []
        cancel_requested = 0
        for session in list(self.execution_manager.runs.values()):
            if _safe_text(session.get("status")) in (
                self.execution_manager.ACTIVE_STATUSES
            ):
                result = self.execution_manager.request_cancel(
                    session.get("run_id")
                )
                cancel_requested += int(bool(result.get("accepted")))
            worker = session.get("thread")
            if worker is not None and worker.is_alive():
                workers.append(worker)
        current = threading.current_thread()
        for worker in workers:
            if worker is current:
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            worker.join(timeout=remaining)
        released_resources = self.managed_resources.release_all()
        return {
            "cancel_requested": cancel_requested,
            "remaining_workers": sum(
                1
                for worker in workers
                if worker is not current and worker.is_alive()
            ),
            "released_resources": released_resources,
        }

    def append_run_log(
        self,
        *,
        run_id,
        ts,
        level,
        category,
        message,
        step_id=None,
        connector_id=None,
        action_id=None,
        iteration_no=None,
        iteration_total=None,
        detail=None,
    ):
        session = self.execution_manager.require_session(run_id)
        secrets = session.get("secret_values") or set()
        item = self.run_log_store.append(
            run_id=run_id,
            ts=ts,
            level=level,
            category=category,
            message=self.sanitizer.sanitize_text(
                message,
                secrets=secrets,
                mask_paths=True,
            ),
            step_id=step_id,
            connector_id=connector_id,
            action_id=action_id,
            iteration_no=iteration_no,
            iteration_total=iteration_total,
            trace_id=(
                session.get("trace_id")
                if _safe_text(level).upper() == "ERROR"
                else None
            ),
            detail=(
                self.sanitizer.sanitize_structure(
                    detail,
                    secrets=secrets,
                    mask_paths=True,
                )
                if isinstance(detail, dict)
                else None
            ),
        )
        self._emit_event_for_run(run_id, "run.log", item)
        return item

    def _workflow_worker(self, run_id):
        session = self.execution_manager.require_session(run_id)
        self._execute_workflow(session)

    def _execute_workflow(self, session):
        run_id = session["run_id"]
        run_logger, handler = self._open_run_logger(session)
        try:
            self._emit_event_for_run(
                run_id,
                "run.progress",
                {
                    "run_id": run_id,
                    "stage": "running",
                    "percent": None,
                    "message": "実行を開始しました。",
                },
            )
            run_logger.info(
                "実行を開始しました。",
                extra={"category": "run"},
            )
            plan = session["plan"]
            execution_result = self.workflow_execution_service.run_config(
                plan.execution_config,
                logger=run_logger,
                flow_path=session.get("flow_path") or "<run>",
                cancel_event=session["cancel_event"],
                initial_context=session.get("seed_context") or {},
                only_step_id=plan.requested_step_id or None,
                step_status_callback=lambda detail: self._step_status(
                    run_id,
                    detail,
                ),
                step_result_callback=lambda detail: self._step_result(
                    run_id,
                    detail,
                ),
                run_id=run_id,
                worker_pool=self.worker_pool,
                max_parallel_steps=self.max_parallel_steps,
                secret_values=session.get("secret_values") or set(),
            )
            raw_report = execution_result.report
            final_status = self._resolve_workflow_status(raw_report)
            if session.get("run_kind") == "step":
                self.execution_manager.update_latest_by_flow(
                    session["flow_key"],
                    session.get("seed_context") or {},
                    raw_report,
                    final_context=execution_result.context,
                )
            self._finish_workflow(
                session,
                raw_report,
                final_status,
            )
            if session.get("run_kind") != "step":
                execution_result.context.clear()
        except Exception as error:
            self._finish_unexpected_error(session, error)
        finally:
            run_logger.removeHandler(handler)
            handler.close()

    def _standalone_worker(self, run_id):
        session = self.execution_manager.require_session(run_id)
        run_logger, handler = self._open_run_logger(session)
        try:
            result_payload = self.standalone_execution_service.execute(
                session["plan"],
                logger=run_logger,
                run_id=run_id,
                cancel_event=session["cancel_event"],
                worker_pool=self.worker_pool,
                on_queued=lambda: self._standalone_queued(run_id),
                on_started=lambda: self._standalone_running(run_id),
                secret_values=session.get("secret_values") or set(),
            )
            session["report"] = {
                "status": "success",
                "steps": [],
                "error": None,
            }
            self.execution_manager.mark_terminal(
                run_id,
                status="success",
                finished_at=_iso_now(),
                report=session["report"],
            )
            self._emit_event_for_run(
                run_id,
                "run.completed",
                {
                    "run_id": run_id,
                    "status": "success",
                    "trace_id": session["trace_id"],
                    **result_payload,
                },
            )
        except StandaloneCancelledError:
            self._finish_standalone_cancelled(session)
        except Exception as error:
            self._finish_unexpected_error(session, error)
        finally:
            run_logger.removeHandler(handler)
            handler.close()

    def _finish_workflow(self, session, raw_report, status):
        run_id = session["run_id"]
        finished_at = _iso_now()
        compact_report = self._compact_report(raw_report, status)
        error = self._error_payload(
            session,
            compact_report.get("error"),
            cancelled=(status == "cancelled"),
        )
        summary = self._build_summary(
            session,
            compact_report,
            status,
            finished_at,
            error,
        )
        if session.get("cache_results"):
            self.result_cache.complete_run(
                run_id,
                summary=summary,
                report=raw_report,
            )
        session["report"] = compact_report
        self.execution_manager.mark_terminal(
            run_id,
            status=status,
            finished_at=finished_at,
            report=compact_report,
            error=error,
        )
        event_type = {
            "success": "run.completed",
            "cancelled": "run.cancelled",
            "error": "run.failed",
        }[status]
        event_payload = {
            "run_id": run_id,
            "status": status,
            "trace_id": session["trace_id"],
        }
        if event_type == "run.failed" and error:
            event_payload["error"] = error
        self._emit_event_for_run(
            run_id,
            event_type,
            event_payload,
        )
        self._finalize_managed_resources(session, status)

    def _finish_standalone_cancelled(self, session):
        session["report"] = {
            "status": "cancelled",
            "steps": [],
            "error": "実行がキャンセルされました。",
        }
        self.execution_manager.mark_terminal(
            session["run_id"],
            status="cancelled",
            finished_at=_iso_now(),
            report=session["report"],
            error=self._error_payload(
                session,
                session["report"]["error"],
                cancelled=True,
            ),
        )
        self._emit_event_for_run(
            session["run_id"],
            "run.cancelled",
            {
                "run_id": session["run_id"],
                "status": "cancelled",
                "trace_id": session["trace_id"],
            },
        )
        self.managed_resources.release_run(session["run_id"])

    def _finish_unexpected_error(self, session, error):
        message = self.sanitizer.sanitize_text(
            str(error or "内部エラーが発生しました。"),
            secrets=session.get("secret_values") or set(),
            mask_paths=True,
        )
        report = {
            "status": "error",
            "steps": [],
            "error": message or "内部エラーが発生しました。",
        }
        error_payload = self._error_payload(session, report["error"])
        if session.get("cache_results") and self.result_cache.has_run(
            session["run_id"]
        ):
            self.result_cache.complete_run(
                session["run_id"],
                summary=self._build_summary(
                    session,
                    report,
                    "error",
                    _iso_now(),
                    error_payload,
                ),
                report=report,
            )
        session["report"] = report
        self.execution_manager.mark_terminal(
            session["run_id"],
            status="error",
            finished_at=_iso_now(),
            report=report,
            error=error_payload,
        )
        self._emit_event_for_run(
            session["run_id"],
            "run.failed",
            {
                "run_id": session["run_id"],
                "status": "error",
                "trace_id": session["trace_id"],
                "error": error_payload,
            },
        )
        self.managed_resources.release_run(session["run_id"])

    def _finalize_managed_resources(self, session, status):
        if (
            _safe_text(session.get("run_kind")) == "step"
            and _safe_text(status) == "success"
        ):
            return
        self.managed_resources.release_run(session.get("run_id"))

    def _step_status(self, run_id, detail):
        payload = {
            "run_id": run_id,
            "step_id": _safe_text((detail or {}).get("step_id")),
            "status": _safe_text((detail or {}).get("status")),
            "message": str((detail or {}).get("message") or ""),
        }
        session = self.execution_manager.require_session(run_id)
        if session.get("cache_results"):
            self.result_cache.set_step_status(
                run_id,
                payload["step_id"],
                payload["status"],
            )
        self._emit_event_for_run(run_id, "run.stepStatus", payload)

    def _step_result(self, run_id, detail):
        session = self.execution_manager.require_session(run_id)
        if session.get("cache_results"):
            self.result_cache.store_step_result(run_id, detail)

    def _standalone_queued(self, run_id):
        session = self.execution_manager.require_session(run_id)
        session["status"] = "queued"
        self._emit_event_for_run(
            run_id,
            "run.progress",
            {
                "run_id": run_id,
                "stage": "queued",
                "percent": None,
                "message": "実行待ち",
            },
        )

    def _standalone_running(self, run_id):
        session = self.execution_manager.require_session(run_id)
        session["status"] = "running"
        self._emit_event_for_run(
            run_id,
            "run.progress",
            {
                "run_id": run_id,
                "stage": "running",
                "percent": None,
                "message": "実行を開始しました。",
            },
        )

    def _emit_event_for_run(self, run_id, event_type, payload):
        session = self.execution_manager.require_session(run_id)
        if not session.get("emit_events") or not callable(self.event_sink):
            return
        self.event_sink(event_type, payload)

    def _open_run_logger(self, session):
        run_logger = logging.getLogger(
            f"ziz.run.{session['run_id']}"
        )
        run_logger.setLevel(logging.INFO)
        run_logger.propagate = False
        handler = RunLogHandler(self, session["run_id"])
        run_logger.addHandler(handler)
        return run_logger, handler

    def _start_response(self, session):
        response = {
            "accepted": True,
            "run_id": session["run_id"],
            "trace_id": session["trace_id"],
            "execution_source": session["execution_source"],
            "run_kind": session["run_kind"],
            "session_id": session.get("session_id") or "",
            "doc_session_id": session.get("doc_session_id") or "",
            "flow_id": session.get("flow_id") or "",
            "status": session["status"],
            "started_at": session["started_at"],
        }
        step_id = _safe_text(session.get("requested_step_id"))
        if step_id:
            response["step_id"] = step_id
        return response

    def _resolve_workflow_status(self, report):
        if report.get("status") == "success":
            return "success"
        if report.get("status") == "cancelled" or report.get("cancelled"):
            return "cancelled"
        return "error"

    def _compact_report(self, report, status):
        return {
            "status": status,
            "error": str((report or {}).get("error") or ""),
            "flow_name": _safe_text((report or {}).get("flow_name")),
            "steps": [
                {
                    "step_id": _safe_text(step.get("step_id")),
                    "status": _safe_text(step.get("status")),
                }
                for step in (report or {}).get("steps") or []
                if isinstance(step, dict)
            ],
        }

    def _build_summary(
        self,
        session,
        report,
        status,
        finished_at,
        error,
    ):
        steps = report.get("steps") or []
        return {
            "run_id": session["run_id"],
            "trace_id": session["trace_id"],
            "execution_source": session["execution_source"],
            "run_kind": session["run_kind"],
            "flow_id": session.get("flow_id") or "",
            "session_id": session.get("session_id") or "",
            "flow_name": session.get("flow_name") or "Untitled",
            "status": status,
            "started_at": session["started_at"],
            "finished_at": finished_at,
            "duration_ms": self._duration_ms(
                session["started_at"],
                finished_at,
            ),
            "step_count": session.get("step_count") or len(steps),
            "success_count": sum(
                1 for step in steps if step.get("status") == "success"
            ),
            "error_count": sum(
                1 for step in steps if step.get("status") == "error"
            ),
            "error": error,
        }

    def _error_payload(self, session, message, *, cancelled=False):
        text = _safe_text(message)
        if not text:
            return None
        return {
            "code": "E_CANCELLED" if cancelled else "E_INTERNAL",
            "message": text,
            "detail": {},
            "retryable": False,
            "trace_id": session["trace_id"],
        }

    def _duration_ms(self, started_at, finished_at):
        try:
            start = datetime.fromisoformat(str(started_at))
            finish = datetime.fromisoformat(str(finished_at))
        except ValueError:
            return None
        return max(0, int((finish - start).total_seconds() * 1000))

    def _require_text(self, value, field_name):
        text = _safe_text(value)
        if not text:
            raise ValueError(f"{field_name} は必須です。")
        return text
