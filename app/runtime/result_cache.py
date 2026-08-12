import copy
import json
import threading

from app.services.errors import ApplicationServiceError
from shared.tabular_preview import build_dataframe_ui_cache


def _safe_text(value):
    return str(value or "").strip()


class ResultCache:
    MAX_PREVIEW_ROWS = 100
    MAX_PREVIEW_BYTES = 2 * 1024 * 1024
    MAX_CELL_BYTES = 64 * 1024
    DEFAULT_SESSION_BYTES = 128 * 1024 * 1024
    TERMINAL_STATUSES = frozenset({
        "success",
        "error",
        "cancelled",
        "skipped",
        "invalidated",
    })

    def __init__(
        self,
        *,
        lock=None,
        max_session_bytes=DEFAULT_SESSION_BYTES,
    ):
        self._lock = lock or threading.RLock()
        self.max_session_bytes = max(1, int(max_session_bytes))
        self._runs = {}
        self._latest_flow_run = {}
        self._latest_step_run = {}

    def register_run(
        self,
        *,
        run_id,
        trace_id,
        doc_session_id,
        flow_id,
        run_kind,
        execution_source,
        flow_name,
        started_at,
        step_ids,
        session_id="",
    ):
        normalized_run_id = self._require_text(run_id, "run_id")
        normalized_doc_session_id = self._require_text(
            doc_session_id,
            "doc_session_id",
        )
        normalized_flow_id = _safe_text(flow_id) or "01"
        normalized_run_kind = _safe_text(run_kind) or "flow"
        normalized_step_ids = self._normalize_step_ids(step_ids)
        summary = {
            "run_id": normalized_run_id,
            "trace_id": _safe_text(trace_id),
            "execution_source": _safe_text(execution_source) or "gui",
            "run_kind": normalized_run_kind,
            "flow_id": normalized_flow_id,
            "session_id": _safe_text(session_id),
            "flow_name": _safe_text(flow_name) or "Untitled",
            "status": "running",
            "started_at": started_at,
            "finished_at": None,
            "duration_ms": None,
            "step_count": len(normalized_step_ids),
            "success_count": 0,
            "error_count": 0,
            "error": None,
        }
        with self._lock:
            if normalized_run_kind == "flow":
                latest_key = (
                    normalized_doc_session_id,
                    normalized_flow_id,
                )
                previous_run_id = self._latest_flow_run.get(latest_key)
                if previous_run_id:
                    self._remove_run_locked(previous_run_id)
                self._latest_flow_run[latest_key] = normalized_run_id
            elif normalized_run_kind == "step" and normalized_step_ids:
                latest_key = (
                    normalized_doc_session_id,
                    normalized_flow_id,
                    normalized_step_ids[0],
                )
                previous_run_id = self._latest_step_run.get(latest_key)
                if previous_run_id:
                    self._remove_run_locked(previous_run_id)
                self._latest_step_run[latest_key] = normalized_run_id

            self._runs[normalized_run_id] = {
                "run_id": normalized_run_id,
                "doc_session_id": normalized_doc_session_id,
                "flow_id": normalized_flow_id,
                "run_kind": normalized_run_kind,
                "summary": summary,
                "terminal_order": "",
                "steps": {
                    step_id: {
                        "status": "pending",
                        "cache": None,
                    }
                    for step_id in normalized_step_ids
                },
            }
        return copy.deepcopy(summary)

    def set_step_status(self, run_id, step_id, status):
        normalized_run_id = self._require_text(run_id, "run_id")
        normalized_step_id = self._require_text(step_id, "step_id")
        normalized_status = _safe_text(status) or "unknown"
        with self._lock:
            run = self._runs.get(normalized_run_id)
            if not run:
                return
            step = run["steps"].setdefault(
                normalized_step_id,
                {"status": "pending", "cache": None},
            )
            step["status"] = normalized_status

    def complete_run(self, run_id, *, summary, report):
        normalized_run_id = self._require_text(run_id, "run_id")
        report_steps = (
            (report or {}).get("steps") or []
            if isinstance(report, dict)
            else []
        )
        with self._lock:
            run = self._runs.get(normalized_run_id)
            if not run:
                raise ApplicationServiceError(
                    "E_RUN_NOT_FOUND",
                    "対象の実行が見つかりません。",
                )
            current_summary = run["summary"]
            if isinstance(summary, dict):
                current_summary.update(copy.deepcopy(summary))
            current_summary["run_id"] = normalized_run_id
            run["summary"] = current_summary
            run["terminal_order"] = _safe_text(
                current_summary.get("finished_at")
            )
            for raw_step in report_steps:
                self._store_step_report_locked(
                    run,
                    raw_step,
                    allow_cache=True,
                )
            self._enforce_session_limit_locked()
            return copy.deepcopy(current_summary)

    def store_step_result(self, run_id, step_report):
        normalized_run_id = self._require_text(run_id, "run_id")
        if not isinstance(step_report, dict):
            raise ValueError("step_reportはオブジェクトで指定してください。")
        with self._lock:
            run = self._runs.get(normalized_run_id)
            if not run:
                raise ApplicationServiceError(
                    "E_RUN_NOT_FOUND",
                    "対象の実行が見つかりません。",
                )
            allow_cache = run.get("run_kind") == "flow"
            self._store_step_report_locked(
                run,
                step_report,
                allow_cache=allow_cache,
            )
            self._enforce_session_limit_locked(
                active_run_id=normalized_run_id,
                active_step_id=_safe_text(step_report.get("step_id")),
            )

    def get_summary(self, run_id):
        run = self._get_run(run_id)
        return copy.deepcopy(run["summary"])

    def get_schema(self, run_id, step_id):
        normalized_run_id, normalized_step_id, step = self._get_step(
            run_id,
            step_id,
        )
        cache = step.get("cache")
        if not isinstance(cache, dict):
            self._raise_unavailable_result(step)
        return {
            "run_id": normalized_run_id,
            "step_id": normalized_step_id,
            "columns": copy.deepcopy(cache.get("schema") or []),
        }

    def get_preview(self, run_id, step_id):
        normalized_run_id, normalized_step_id, step = self._get_step(
            run_id,
            step_id,
        )
        cache = step.get("cache")
        if not isinstance(cache, dict):
            self._raise_unavailable_result(step)
        preview = cache.get("preview") or {}
        if not isinstance(cache.get("preview"), dict):
            reason = _safe_text(cache.get("preview_unavailable"))
            if reason == "session_limit":
                raise ApplicationServiceError(
                    "E_RESULT_NOT_FOUND",
                    "previewはsession cache上限のため保持されていません。",
                )
            self._raise_unavailable_result(step)
        return {
            "run_id": normalized_run_id,
            "step_id": normalized_step_id,
            "columns": copy.deepcopy(preview.get("columns") or []),
            "rows": copy.deepcopy(preview.get("rows") or []),
            "row_count": int(cache.get("row_count") or 0),
            "truncated": bool(preview.get("truncated")),
        }

    def has_run(self, run_id):
        normalized_run_id = _safe_text(run_id)
        if not normalized_run_id:
            return False
        with self._lock:
            return normalized_run_id in self._runs

    def forget_run(self, run_id):
        normalized_run_id = _safe_text(run_id)
        if not normalized_run_id:
            return
        with self._lock:
            self._remove_run_locked(normalized_run_id)

    def get_usage(self):
        with self._lock:
            return {
                "used_bytes": self._estimate_total_bytes_locked(),
                "max_bytes": self.max_session_bytes,
            }

    def build_transient_preview(self, dataframe):
        cache = self._build_step_cache(
            build_dataframe_ui_cache(
                dataframe,
                max_rows=self.MAX_PREVIEW_ROWS,
            )
        )
        preview = cache.get("preview") or {}
        return {
            "columns": copy.deepcopy(preview.get("columns") or []),
            "rows": copy.deepcopy(preview.get("rows") or []),
            "row_count": int(cache.get("row_count") or 0),
            "truncated": bool(preview.get("truncated")),
        }

    def close_document(self, doc_session_id):
        normalized_session_id = self._require_text(
            doc_session_id,
            "doc_session_id",
        )
        with self._lock:
            run_ids = [
                run_id
                for run_id, run in self._runs.items()
                if run.get("doc_session_id") == normalized_session_id
            ]
            for run_id in run_ids:
                self._remove_run_locked(run_id)
        return {
            "doc_session_id": normalized_session_id,
            "released_run_ids": run_ids,
            "released_run_count": len(run_ids),
        }

    def invalidate_document_steps(self, doc_session_id, step_ids):
        normalized_session_id = self._require_text(
            doc_session_id,
            "doc_session_id",
        )
        normalized_step_ids = set(self._normalize_step_ids(step_ids))
        if not normalized_step_ids:
            raise ValueError("step_ids は1件以上必要です。")
        invalidated = set()
        removed_run_ids = []
        with self._lock:
            for run_id, run in list(self._runs.items()):
                if run.get("doc_session_id") != normalized_session_id:
                    continue
                run_steps = run.get("steps") or {}
                matching = normalized_step_ids.intersection(run_steps)
                if not matching:
                    continue
                if run.get("run_kind") == "step":
                    removed_run_ids.append(run_id)
                    invalidated.update(matching)
                    self._remove_run_locked(run_id)
                    continue
                for step_id in matching:
                    step = run_steps.get(step_id)
                    if not isinstance(step, dict):
                        continue
                    step["status"] = "invalidated"
                    step["cache"] = None
                    invalidated.add(step_id)
        return {
            "doc_session_id": normalized_session_id,
            "invalidated_step_ids": sorted(invalidated),
            "removed_run_ids": removed_run_ids,
        }

    def _get_run(self, run_id):
        normalized_run_id = self._require_text(run_id, "run_id")
        with self._lock:
            run = self._runs.get(normalized_run_id)
            if not run:
                raise ApplicationServiceError(
                    "E_RUN_NOT_FOUND",
                    "対象の実行が見つかりません。",
                )
            return copy.deepcopy(run)

    def _get_step(self, run_id, step_id):
        normalized_run_id = self._require_text(run_id, "run_id")
        normalized_step_id = self._require_text(step_id, "step_id")
        with self._lock:
            run = self._runs.get(normalized_run_id)
            if not run:
                raise ApplicationServiceError(
                    "E_RUN_NOT_FOUND",
                    "対象の実行が見つかりません。",
                )
            step = run["steps"].get(normalized_step_id)
            if not step:
                raise ApplicationServiceError(
                    "E_RESULT_NOT_FOUND",
                    "指定ステップの結果が見つかりません。",
                )
            return (
                normalized_run_id,
                normalized_step_id,
                copy.deepcopy(step),
            )

    def _raise_unavailable_result(self, step):
        status = _safe_text((step or {}).get("status")).lower()
        if status not in self.TERMINAL_STATUSES:
            raise ApplicationServiceError(
                "E_RESULT_NOT_READY",
                "指定ステップの結果はまだ生成されていません。",
            )
        raise ApplicationServiceError(
            "E_RESULT_NOT_FOUND",
            "指定ステップに表示可能な表データがありません。",
        )

    def _remove_run_locked(self, run_id):
        run = self._runs.pop(run_id, None)
        if not run:
            return
        flow_key = (run.get("doc_session_id"), run.get("flow_id"))
        if self._latest_flow_run.get(flow_key) == run_id:
            self._latest_flow_run.pop(flow_key, None)
        for key, indexed_run_id in list(self._latest_step_run.items()):
            if indexed_run_id == run_id:
                self._latest_step_run.pop(key, None)

    def _store_step_report_locked(self, run, raw_step, *, allow_cache):
        if not isinstance(raw_step, dict):
            return
        step_id = _safe_text(raw_step.get("step_id"))
        if not step_id:
            return
        step = run["steps"].setdefault(
            step_id,
            {"status": "pending", "cache": None},
        )
        step["status"] = _safe_text(raw_step.get("status")) or "unknown"
        if not allow_cache:
            return
        ui_cache = raw_step.get("ui_cache")
        step["cache"] = (
            self._build_step_cache(ui_cache)
            if isinstance(ui_cache, dict)
            else None
        )

    def _enforce_session_limit_locked(
        self,
        *,
        active_run_id="",
        active_step_id="",
    ):
        if self._estimate_total_bytes_locked() <= self.max_session_bytes:
            return
        terminal_flow_runs = sorted(
            (
                run
                for run in self._runs.values()
                if run.get("run_kind") == "flow"
                and _safe_text(
                    (run.get("summary") or {}).get("status")
                ).lower() in self.TERMINAL_STATUSES
            ),
            key=lambda run: (
                _safe_text(run.get("terminal_order")),
                _safe_text(run.get("run_id")),
            ),
        )
        for run in terminal_flow_runs:
            self._drop_run_previews_locked(run)
            if self._estimate_total_bytes_locked() <= self.max_session_bytes:
                return

        active_run = self._runs.get(_safe_text(active_run_id))
        active_step = (
            (active_run.get("steps") or {}).get(_safe_text(active_step_id))
            if isinstance(active_run, dict)
            else None
        )
        if isinstance(active_step, dict):
            self._drop_step_preview_locked(active_step)

    def _drop_run_previews_locked(self, run):
        for step in (run.get("steps") or {}).values():
            self._drop_step_preview_locked(step)

    def _drop_step_preview_locked(self, step):
        cache = step.get("cache") if isinstance(step, dict) else None
        if not isinstance(cache, dict):
            return
        if not isinstance(cache.get("preview"), dict):
            return
        cache["preview"] = None
        cache["preview_unavailable"] = "session_limit"

    def _estimate_total_bytes_locked(self):
        total = 0
        for run in self._runs.values():
            total += self._json_size(run.get("summary") or {})
            for step in (run.get("steps") or {}).values():
                cache = step.get("cache") if isinstance(step, dict) else None
                if isinstance(cache, dict):
                    total += self._json_size(cache)
        return total

    def _build_step_cache(self, ui_cache):
        schema = ui_cache.get("schema") or {}
        preview = ui_cache.get("preview") or {}
        schema_columns = (
            copy.deepcopy(schema.get("columns") or [])
            if isinstance(schema, dict)
            else []
        )
        row_count = self._to_non_negative_int(
            ui_cache.get("row_count"),
            fallback=(preview.get("row_count") if isinstance(preview, dict) else 0),
        )
        bounded_preview = self._build_bounded_preview(
            preview if isinstance(preview, dict) else {},
            row_count=row_count,
        )
        return {
            "schema": schema_columns,
            "preview": bounded_preview,
            "row_count": row_count,
        }

    def _build_bounded_preview(self, preview, *, row_count):
        source_columns = list(preview.get("columns") or [])
        source_rows = list(preview.get("rows") or [])
        output_columns = []
        output_rows = []
        used_bytes = 256
        truncated = bool(preview.get("truncated"))

        for raw_column in source_columns:
            column, was_truncated = self._truncate_text(raw_column)
            item_bytes = self._json_size(column) + 1
            if used_bytes + item_bytes > self.MAX_PREVIEW_BYTES:
                truncated = True
                break
            output_columns.append(column)
            used_bytes += item_bytes
            truncated = truncated or was_truncated

        if len(output_columns) < len(source_columns):
            truncated = True

        max_columns = len(output_columns)
        for raw_row in source_rows[: self.MAX_PREVIEW_ROWS]:
            values = list(raw_row or [])[:max_columns]
            output_row = []
            row_bytes = 2
            row_truncated = False
            for raw_value in values:
                value, was_truncated = self._truncate_text(raw_value)
                row_bytes += self._json_size(value) + 1
                output_row.append(value)
                row_truncated = row_truncated or was_truncated
            if used_bytes + row_bytes > self.MAX_PREVIEW_BYTES:
                truncated = True
                break
            output_rows.append(output_row)
            used_bytes += row_bytes
            truncated = truncated or row_truncated

        if len(source_rows) > len(output_rows):
            truncated = True
        if len(source_rows) > self.MAX_PREVIEW_ROWS:
            truncated = True
        if row_count > len(output_rows):
            truncated = True
        return {
            "columns": output_columns,
            "rows": output_rows,
            "truncated": truncated,
        }

    def _truncate_text(self, value):
        text = "" if value is None else str(value)
        encoded = text.encode("utf-8")
        if len(encoded) <= self.MAX_CELL_BYTES:
            return text, False
        truncated = encoded[: self.MAX_CELL_BYTES].decode(
            "utf-8",
            errors="ignore",
        )
        return truncated, True

    def _json_size(self, value):
        return len(
            json.dumps(
                value,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8")
        )

    def _normalize_step_ids(self, step_ids):
        output = []
        seen = set()
        for raw_step_id in step_ids or []:
            step_id = _safe_text(raw_step_id)
            if not step_id or step_id in seen:
                continue
            seen.add(step_id)
            output.append(step_id)
        return output

    def _to_non_negative_int(self, value, *, fallback=0):
        try:
            return max(0, int(value))
        except (TypeError, ValueError):
            try:
                return max(0, int(fallback))
            except (TypeError, ValueError):
                return 0

    def _require_text(self, value, field_name):
        text = _safe_text(value)
        if not text:
            raise ValueError(f"{field_name} は必須です。")
        return text
