import os
import sys
import logging
from pathlib import Path

from app.runtime.execution_manager import ExecutionManager
from app.runtime.result_cache import ResultCache
from app.runtime.run_log_store import RunLogStore
from app.runtime.worker_pool import WorkerPool
from app.services.catalog_service import CatalogService
from app.services.run_service import RunService
from app.services.standalone_execution_service import (
    StandaloneExecutionService,
)
from app.services.workflow_document_service import WorkflowDocumentService
from app.services.workflow_execution_service import WorkflowExecutionService
from core.flow_locator import WORKFLOW_DIR, resolve_flow_path
from core.logger import setup_logger
from shared.security_sanitizer import SensitiveDataSanitizer

logger = logging.getLogger("ziz.cli")


def _build_cli_run_service(*, catalog_root=None):
    catalog_service = CatalogService(catalog_root=catalog_root)
    execution_manager = ExecutionManager()
    result_cache = ResultCache()
    run_log_store = RunLogStore(
        Path(__file__).resolve().parents[1] / "logs"
    )
    workflow_execution_service = WorkflowExecutionService()
    return RunService(
        execution_manager=execution_manager,
        workflow_document_service=WorkflowDocumentService(
            catalog_service
        ),
        workflow_execution_service=workflow_execution_service,
        standalone_execution_service=StandaloneExecutionService(
            catalog_service,
            result_cache,
        ),
        result_cache=result_cache,
        run_log_store=run_log_store,
        worker_pool=WorkerPool(max_workers=4),
        sanitizer=SensitiveDataSanitizer(),
    )

if not os.path.exists(WORKFLOW_DIR):
    os.makedirs(WORKFLOW_DIR)


def run_cli(yaml_path, *, catalog_root=None):
    setup_logger(mode="cli")
    try:
        run_service = _build_cli_run_service(
            catalog_root=catalog_root
        )
    except (OSError, ValueError) as error:
        message = f"catalogの読み込みに失敗しました: {error}"
        logger.error(message)
        return {
            "flow_path": "",
            "flow_name": "Untitled",
            "workflow_path": "",
            "workflow_name": "Untitled",
            "status": "error",
            "steps": [],
            "error": message,
        }

    resolved_path = resolve_flow_path(yaml_path)
    if not resolved_path or not os.path.exists(resolved_path):
        display_path = str(yaml_path or "").strip()
        if len(display_path) >= 2 and display_path[0] == display_path[-1] and display_path[0] in {"\"", "'"}:
            display_path = display_path[1:-1].strip()
        message = f"ファイルが見つかりません: {display_path}"
        logger.error(message)
        return {
            "flow_path": os.path.abspath(display_path) if display_path else "",
            "flow_name": "Untitled",
            "workflow_path": os.path.abspath(display_path) if display_path else "",
            "workflow_name": "Untitled",
            "status": "error",
            "steps": [],
            "error": message,
        }

    logger.info(f"CLIモードで実行開始: {resolved_path}")
    try:
        report = run_service.run_cli_file(
            resolved_path,
            logger=logger,
        )
    except Exception as error:
        logger.error("CLI実行中にエラーが発生しました: %s", error)
        return {
            "flow_path": str(resolved_path),
            "flow_name": "Untitled",
            "workflow_path": str(resolved_path),
            "workflow_name": "Untitled",
            "status": "error",
            "steps": [],
            "error": str(error),
        }
    if report.get("status") == "success":
        logger.info("CLI実行が正常に完了しました。")
    else:
        logger.error(f"CLI実行中にエラーが発生しました: {report.get('error')}")
    return report


def main():
    if len(sys.argv) < 2:
        print("usage: python -m app.main <flow_path>")
        return 1

    report = run_cli(sys.argv[1])
    return 0 if report.get("status") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
