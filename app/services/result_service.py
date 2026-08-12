from app.services.errors import ApplicationServiceError


def _safe_text(value):
    return str(value or "").strip()


class ResultService:
    def __init__(
        self,
        result_cache,
        run_log_store,
        execution_manager=None,
    ):
        self.result_cache = result_cache
        self.run_log_store = run_log_store
        self.execution_manager = execution_manager

    def get_summary(self, *, run_id):
        return self.result_cache.get_summary(run_id)

    def get_schema(self, *, run_id, step_id):
        return self.result_cache.get_schema(run_id, step_id)

    def get_preview(self, *, run_id, step_id):
        return self.result_cache.get_preview(run_id, step_id)

    def get_logs(self, *, run_id, before_seq=None, after_seq=None):
        normalized_run_id = _safe_text(run_id)
        if not normalized_run_id:
            raise ValueError("run_id は必須です。")
        if not self.result_cache.has_run(normalized_run_id):
            raise ApplicationServiceError(
                "E_RUN_NOT_FOUND",
                "対象の実行が見つかりません。",
            )
        return self.run_log_store.get_logs(
            normalized_run_id,
            before_seq=before_seq,
            after_seq=after_seq,
        )

    def invalidate_steps(self, *, doc_session_id, step_ids):
        display_result = self.result_cache.invalidate_document_steps(
            doc_session_id,
            step_ids,
        )
        runtime_result = (
            self.execution_manager.invalidate_document_steps(
                doc_session_id,
                step_ids,
            )
            if self.execution_manager is not None
            else {"invalidated_step_ids": []}
        )
        invalidated = sorted({
            *display_result.get("invalidated_step_ids", []),
            *runtime_result.get("invalidated_step_ids", []),
        })
        return {
            "doc_session_id": _safe_text(doc_session_id),
            "invalidated_step_ids": invalidated,
            "removed_run_ids": display_result.get("removed_run_ids", []),
        }

    def close_document(self, *, doc_session_id):
        released = self.result_cache.close_document(doc_session_id)
        self.run_log_store.forget_runs(released["released_run_ids"])
        return released
