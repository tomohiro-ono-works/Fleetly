import argparse
from pathlib import Path

from app.gui.host import run_webview_app
from app.main import run_cli
from core.flow_locator import has_flow_extension, resolve_flow_path
from core.logger import setup_logger

BASE_DIR = Path(__file__).resolve().parent
HOME_HTML_PATH = BASE_DIR / "static" / "home.html"


def parse_args():
    parser = argparse.ArgumentParser(description="zizai launcher")
    parser.add_argument(
        "flow_path",
        nargs="?",
        help="実行対象の .zizw/.zizd/.zizq ファイル。指定時はヘッドレス実行します。",
    )
    parser.add_argument("--debug", action="store_true", help="Qt WebEngine の DevTools を有効化します。")
    return parser.parse_args()


def run_headless(flow_path: str) -> int:
    resolved_path = resolve_flow_path(flow_path)
    extension_target = resolved_path or flow_path
    if not has_flow_extension(extension_target):
        print(f"unsupported flow extension: {flow_path}")
        return 1

    report = run_cli(flow_path)
    return 0 if report.get("status") == "success" else 1


def main():
    setup_logger()
    args = parse_args()
    if args.flow_path:
        return run_headless(args.flow_path)

    run_webview_app(HOME_HTML_PATH, debug=bool(args.debug))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
