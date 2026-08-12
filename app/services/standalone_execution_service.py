import copy
import json
from dataclasses import dataclass

from core.connector_factory import ConnectorFactory
from shared.tabular_preview import is_dataframe_like
from shared.process_runner import ProcessCancelledError


RESULT_CONTEXT_KEY = "__ziz_standalone_result__"


def _safe_text(value):
    return str(value or "").strip()


class StandaloneCancelledError(Exception):
    pass


@dataclass(frozen=True)
class StandaloneRunPlan:
    connector_id: str
    action_id: str
    params: dict
    result_mode: str
    dry_run: bool
    dry_run_strategy: str
    result_export: dict | None


class StandaloneExecutionService:
    def __init__(
        self,
        catalog_service,
        result_cache,
        *,
        connector_factory=None,
    ):
        self.catalog_service = catalog_service
        self.result_cache = result_cache
        self.connector_factory = (
            connector_factory or ConnectorFactory()
        )

    def prepare_run(
        self,
        *,
        connector_id,
        action_id,
        params,
        result_mode,
        dry_run=False,
        result_export=None,
    ):
        normalized_connector_id = _safe_text(connector_id)
        normalized_action_id = _safe_text(action_id)
        normalized_mode = _safe_text(result_mode)
        normalized_params = copy.deepcopy(params)
        if not isinstance(normalized_params, dict):
            raise ValueError("paramsはオブジェクトで指定してください。")
        action = self.catalog_service.get_action_definition(
            normalized_connector_id,
            normalized_action_id,
        )
        if not action.get("standalone_allowed"):
            raise ValueError("このactionは単体実行できません。")
        allowed_modes = set(action.get("standalone_result_modes") or [])
        if normalized_mode not in allowed_modes:
            raise ValueError("result_modeがactionの許可範囲外です。")
        self.catalog_service.validate_action_params(
            normalized_connector_id,
            normalized_action_id,
            normalized_params,
        )

        dry_run_config = action.get("dry_run") or {}
        is_dry_run = bool(dry_run)
        if is_dry_run and not bool(dry_run_config.get("supported")):
            raise ValueError("このactionはdry runに対応していません。")
        if is_dry_run and normalized_mode == "excel":
            raise ValueError("Exportではdry runを使用できません。")

        normalized_export = None
        if normalized_mode == "excel":
            normalized_export = self._prepare_export(result_export)
        elif result_export is not None:
            raise ValueError(
                "result_exportはexcel modeだけで指定できます。"
            )
        return StandaloneRunPlan(
            connector_id=normalized_connector_id,
            action_id=normalized_action_id,
            params=normalized_params,
            result_mode=normalized_mode,
            dry_run=is_dry_run,
            dry_run_strategy=_safe_text(dry_run_config.get("strategy")),
            result_export=normalized_export,
        )

    def execute(
        self,
        plan,
        *,
        logger,
        run_id,
        cancel_event,
        worker_pool,
        on_queued=None,
        on_started=None,
        secret_values=None,
    ):
        self._raise_if_cancelled(cancel_event)
        connector = self.connector_factory.create(plan.connector_id)
        if hasattr(connector, "set_execution_logger"):
            connector.set_execution_logger(
                logger,
                connector_id=plan.connector_id,
                action_id=plan.action_id,
                cancel_event=cancel_event,
                secret_values=secret_values,
            )
        try:
            source_result = self._execute_connector(
                connector,
                plan,
                run_id=run_id,
                cancel_event=cancel_event,
                worker_pool=worker_pool,
                on_queued=on_queued,
                on_started=on_started,
            )
        except ProcessCancelledError as error:
            raise StandaloneCancelledError() from error
        finally:
            if hasattr(connector, "clear_execution_logger"):
                connector.clear_execution_logger()
        self._raise_if_cancelled(cancel_event)
        if plan.dry_run:
            return {"dry_run": self._json_value(source_result)}
        if plan.result_mode == "excel":
            return self._export_result(
                plan,
                source_result,
                logger=logger,
                run_id=run_id,
                cancel_event=cancel_event,
                worker_pool=worker_pool,
                on_queued=on_queued,
                on_started=on_started,
                secret_values=secret_values,
            )
        return self._format_result(source_result, plan.result_mode)

    def _execute_connector(
        self,
        connector,
        plan,
        *,
        run_id,
        cancel_event,
        worker_pool,
        on_queued,
        on_started,
    ):
        with worker_pool.lease(
            run_id,
            cancel_event=cancel_event,
            on_queued=on_queued,
        ) as acquired:
            if not acquired:
                raise StandaloneCancelledError()
            if callable(on_started):
                on_started()
            if plan.dry_run:
                return connector.dry_run(
                    plan.action_id,
                    plan.params,
                    {},
                )
            return connector.execute(plan.action_id, plan.params, {})

    def _export_result(
        self,
        plan,
        source_result,
        *,
        logger,
        run_id,
        cancel_event,
        worker_pool,
        on_queued,
        on_started,
        secret_values,
    ):
        export = plan.result_export or {}
        export_connector = self.connector_factory.create(
            export["connector_id"]
        )
        if hasattr(export_connector, "set_execution_logger"):
            export_connector.set_execution_logger(
                logger,
                connector_id=export["connector_id"],
                action_id=export["action_id"],
                cancel_event=cancel_event,
                secret_values=secret_values,
            )
        try:
            with worker_pool.lease(
                run_id,
                cancel_event=cancel_event,
                on_queued=on_queued,
            ) as acquired:
                if not acquired:
                    raise StandaloneCancelledError()
                if callable(on_started):
                    on_started()
                context = {RESULT_CONTEXT_KEY: source_result}
                export_result = export_connector.execute(
                    export["action_id"],
                    export["params"],
                    context,
                )
        except ProcessCancelledError as error:
            raise StandaloneCancelledError() from error
        finally:
            if hasattr(export_connector, "clear_execution_logger"):
                export_connector.clear_execution_logger()
        self._raise_if_cancelled(cancel_event)
        return {
            "export": self._metadata_value(export_result),
        }

    def _prepare_export(self, result_export):
        if not isinstance(result_export, dict):
            raise ValueError("excel modeではresult_exportが必須です。")
        connector_id = _safe_text(result_export.get("connector_id"))
        action_id = _safe_text(result_export.get("action_id"))
        params = copy.deepcopy(result_export.get("params"))
        if not isinstance(params, dict):
            raise ValueError(
                "result_export.paramsはオブジェクトで指定してください。"
            )
        action = self.catalog_service.get_action_definition(
            connector_id,
            action_id,
        )
        if "excel" not in set(
            action.get("standalone_export_modes") or []
        ):
            raise ValueError(
                "指定actionはstandaloneのExcel出力に使用できません。"
            )
        params["input_data"] = RESULT_CONTEXT_KEY
        self.catalog_service.validate_action_params(
            connector_id,
            action_id,
            params,
        )
        return {
            "connector_id": connector_id,
            "action_id": action_id,
            "params": params,
        }

    def _format_result(self, result, result_mode):
        if result_mode == "preview" and is_dataframe_like(result):
            return {
                "preview": self.result_cache.build_transient_preview(result)
            }
        if result_mode == "metadata":
            return {"metadata": self._metadata_value(result)}
        if result_mode == "text":
            return {"text": self._text_value(result)}
        if is_dataframe_like(result):
            return {
                "preview": self.result_cache.build_transient_preview(result)
            }
        return {"text": self._text_value(result)}

    def _metadata_value(self, value):
        if is_dataframe_like(value):
            return [
                self._json_value(item)
                for item in value.head(100).to_dict(orient="records")
            ]
        return self._json_value(value)

    def _text_value(self, value):
        if isinstance(value, (dict, list)):
            return json.dumps(
                value,
                ensure_ascii=False,
                default=str,
                separators=(",", ":"),
            )
        return str(value if value is not None else "")

    def _json_value(self, value):
        if isinstance(value, dict):
            return {
                str(key): self._json_value(item)
                for key, item in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [self._json_value(item) for item in value]
        if isinstance(value, (str, int, float, bool)) or value is None:
            return value
        return str(value)

    def _raise_if_cancelled(self, cancel_event):
        if cancel_event is not None and cancel_event.is_set():
            raise StandaloneCancelledError()
