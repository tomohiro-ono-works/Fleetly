import os
import sys

from core.flow_locator import WORKFLOW_DIR, resolve_flow_path
from core.logger import setup_logger
from core.workflow_engine import WorkflowEngine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

logger = setup_logger()
engine = WorkflowEngine(logger)

if not os.path.exists(WORKFLOW_DIR):
    os.makedirs(WORKFLOW_DIR)


def run_cli(yaml_path):
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
    report = engine.run_flow(resolved_path)
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
