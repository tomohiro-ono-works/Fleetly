from dataclasses import dataclass

from core.workflow_engine import WorkflowEngine


@dataclass(frozen=True)
class WorkflowExecutionResult:
    report: dict
    context: dict


class WorkflowExecutionService:
    def __init__(self, engine_factory=WorkflowEngine):
        self._engine_factory = engine_factory

    def run_file(
        self,
        flow_path,
        *,
        logger,
        cancel_event=None,
        step_status_callback=None,
        performance_callback=None,
        step_result_callback=None,
        run_id="",
        worker_pool=None,
        max_parallel_steps=4,
        secret_values=None,
    ):
        engine = self._create_engine(
            logger,
            step_status_callback=step_status_callback,
            performance_callback=performance_callback,
            step_result_callback=step_result_callback,
        )
        self._configure_engine(
            engine,
            run_id=run_id,
            worker_pool=worker_pool,
            max_parallel_steps=max_parallel_steps,
            secret_values=secret_values,
        )
        report = engine.run_flow(flow_path, cancel_event=cancel_event)
        return self._build_result(engine, report)

    def run_config(
        self,
        config,
        *,
        logger,
        flow_path="<gui>",
        cancel_event=None,
        initial_context=None,
        only_step_id=None,
        step_status_callback=None,
        performance_callback=None,
        step_result_callback=None,
        run_id="",
        worker_pool=None,
        max_parallel_steps=4,
        secret_values=None,
    ):
        engine = self._create_engine(
            logger,
            step_status_callback=step_status_callback,
            performance_callback=performance_callback,
            step_result_callback=step_result_callback,
        )
        self._configure_engine(
            engine,
            run_id=run_id,
            worker_pool=worker_pool,
            max_parallel_steps=max_parallel_steps,
            secret_values=secret_values,
        )
        report = engine.run_flow_from_config(
            config,
            flow_path=flow_path,
            cancel_event=cancel_event,
            initial_context=initial_context,
            only_step_id=only_step_id,
        )
        return self._build_result(engine, report)

    def _create_engine(
        self,
        logger,
        *,
        step_status_callback,
        performance_callback,
        step_result_callback,
    ):
        return self._engine_factory(
            logger,
            step_status_callback=step_status_callback,
            performance_callback=performance_callback,
            step_result_callback=step_result_callback,
        )

    def _configure_engine(
        self,
        engine,
        *,
        run_id,
        worker_pool,
        max_parallel_steps,
        secret_values,
    ):
        configure = getattr(engine, "configure_runtime", None)
        if callable(configure):
            configure(
                run_id=run_id,
                worker_pool=worker_pool,
                max_parallel_steps=max_parallel_steps,
                secret_values=secret_values,
            )

    def _build_result(self, engine, report):
        context = getattr(engine, "context", None)
        return WorkflowExecutionResult(
            report=report if isinstance(report, dict) else {},
            context=context if isinstance(context, dict) else {},
        )
