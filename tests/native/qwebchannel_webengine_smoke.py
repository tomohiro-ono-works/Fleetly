import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from PySide6.QtCore import QTimer, QUrl
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication

from app.gui.bridge import BridgeRuntime
from app.gui.host import _configure_qtwebengine_environment
from app.gui.qwebchannel_transport import QWebChannelTransport


def main():
    _configure_qtwebengine_environment()
    app = QApplication.instance() or QApplication([])
    runtime = BridgeRuntime(base_dir=REPO_ROOT)
    transport = QWebChannelTransport(
        runtime.dispatcher,
        base_dir=runtime.base_dir,
        sanitizer=runtime.security_sanitizer,
    )
    runtime.set_event_sink(transport.publish)
    view = QWebEngineView()
    page = QWebEnginePage(view)
    view.setPage(page)
    settings = page.settings()
    settings.setAttribute(
        QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls,
        True,
    )
    channel = QWebChannel(page)
    channel.registerObject("backendBridge", transport)
    page.setWebChannel(channel)

    command = {
        "v": "1",
        "kind": "cmd",
        "id": "cmd_native_qt_smoke",
        "type": "app.getStatus",
        "ts": "2026-07-29T00:00:00Z",
        "payload": {},
    }
    raw_command = json.dumps(command, ensure_ascii=False)
    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="qrc:///qtwebchannel/qwebchannel.js"></script>
</head>
<body>
<script>
new QWebChannel(qt.webChannelTransport, function (channel) {{
  const bridge = channel.objects.backendBridge;
  bridge.messageToFrontend.connect(function (raw) {{
    const message = JSON.parse(raw);
    if (
      message.kind === "res"
      && message.id === "cmd_native_qt_smoke"
      && message.ok === true
      && message.data
      && message.data.session_id
    ) {{
      document.title = "QWEBCHANNEL_SMOKE_OK";
    }} else {{
      document.title = "QWEBCHANNEL_SMOKE_FAILED";
    }}
  }});
  bridge.postMessage({json.dumps(raw_command)});
}});
</script>
</body>
</html>"""

    outcome = {"ok": False}

    def handle_title(title):
        if title == "QWEBCHANNEL_SMOKE_OK":
            outcome["ok"] = True
            app.quit()
        elif title == "QWEBCHANNEL_SMOKE_FAILED":
            app.quit()

    page.titleChanged.connect(handle_title)
    QTimer.singleShot(15000, app.quit)
    with tempfile.TemporaryDirectory() as temp_dir:
        html_path = Path(temp_dir) / "smoke.html"
        html_path.write_text(html, encoding="utf-8")
        page.setUrl(QUrl.fromLocalFile(str(html_path)))
        app.exec()

    channel.deregisterObject(transport)
    transport.shutdown()
    runtime.set_event_sink(None)
    runtime.shutdown()
    view.setPage(None)
    page.deleteLater()
    view.deleteLater()
    app.processEvents()
    if not outcome["ok"]:
        print("QWEBCHANNEL_SMOKE_FAILED", flush=True)
        return 1
    print("QWEBCHANNEL_SMOKE_OK", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
