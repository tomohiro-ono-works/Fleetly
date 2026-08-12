import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from PySide6.QtCore import QTimer
from PySide6.QtWidgets import QApplication

from app.gui.host import run_webview_app


def main():
    home_html = REPO_ROOT / "static" / "home.html"
    app = QApplication.instance() or QApplication([])
    QTimer.singleShot(20000, app.quit)

    def close_after_ready():
        QTimer.singleShot(100, app.quit)

    exit_code = run_webview_app(
        home_html,
        debug=False,
        ready_callback=close_after_ready,
    )
    if int(exit_code) != 0:
        print(f"GUI_HOST_SMOKE_FAILED exit={exit_code}", flush=True)
        return 1
    print("GUI_HOST_SMOKE_OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
