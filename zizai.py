import argparse
from pathlib import Path

from app.gui.host import run_webview_app

BASE_DIR = Path(__file__).resolve().parent
HOME_HTML_PATH = BASE_DIR / "static" / "home.html"


def parse_args():
    parser = argparse.ArgumentParser(description="zizai GUI launcher")
    parser.add_argument("--debug", action="store_true", help="Qt WebEngine の DevTools を有効化します。")
    return parser.parse_args()


def main():
    args = parse_args()
    run_webview_app(HOME_HTML_PATH, debug=bool(args.debug))


if __name__ == "__main__":
    main()
