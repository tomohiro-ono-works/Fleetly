import os
import json
import time
import logging
import ctypes
from pathlib import Path

logger = logging.getLogger("ziz.gui_host")


def _is_within_path(path, base_dir):
    try:
        path.relative_to(base_dir)
        return True
    except ValueError:
        return False


def _configure_qtwebengine_environment():
    # Remote debugging は設定しない。既存の有効化設定だけ除去する。
    os.environ.pop("QTWEBENGINE_REMOTE_DEBUGGING", None)
    existing_flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "").strip()
    filtered_flags = [
        flag
        for flag in existing_flags.split()
        if not flag.startswith("--remote-debugging-port")
        and not flag.startswith("--remote-allow-origins")
    ]
    extra_flags = ["--no-default-browser-check"]
    merged = " ".join([flag for flag in [*filtered_flags, *extra_flags] if flag]).strip()
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = merged


def _set_windows_app_user_model_id():
    if os.name != "nt":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("tomoh.zizai.desktop")
    except Exception:
        logger.debug("AppUserModelID の設定に失敗しました。", exc_info=True)


def run_webview_app(form_html_path, debug=False):
    startup_started = time.perf_counter()
    logger.info("[gui-startup] phase=begin debug=%s", bool(debug))
    _configure_qtwebengine_environment()
    _set_windows_app_user_model_id()
    logger.info("[gui-startup] phase=environment_configured elapsed_ms=%s", round((time.perf_counter() - startup_started) * 1000, 1))
    try:
        from PySide6.QtCore import QObject, Qt, QUrl, Signal, Slot
        from PySide6.QtGui import QAction, QIcon, QKeySequence
        from PySide6.QtWebChannel import QWebChannel
        from PySide6.QtWidgets import (
            QApplication,
            QDialog,
            QDialogButtonBox,
            QFileDialog,
            QHBoxLayout,
            QLabel,
            QLineEdit,
            QMainWindow,
            QPushButton,
            QVBoxLayout,
        )
        from PySide6.QtWebEngineCore import (
            QWebEnginePage,
            QWebEngineProfile,
            QWebEngineSettings,
            QWebEngineUrlRequestInterceptor,
        )
        from PySide6.QtWebEngineWidgets import QWebEngineView
    except ImportError as error:
        raise RuntimeError("PySide6 と Qt WebEngine がインストールされていません。") from error
    logger.info("[gui-startup] phase=qt_imported elapsed_ms=%s", round((time.perf_counter() - startup_started) * 1000, 1))

    from .bridge import BridgeRuntime, WebViewBridge

    html_path = Path(form_html_path).resolve()
    if not html_path.exists():
        raise FileNotFoundError(f"GUI ファイルが見つかりません: {html_path}")

    class LockedDownRequestInterceptor(QWebEngineUrlRequestInterceptor):
        def __init__(self, base_dir, html_file):
            super().__init__()
            self._base_dir = Path(base_dir).resolve()
            self._html_file = Path(html_file).resolve()
            self._allowed_schemes = {"file", "qrc", "data", "blob", "about"}

        def interceptRequest(self, info):
            url = info.requestUrl()
            scheme = str(url.scheme() or "").lower()
            if scheme not in self._allowed_schemes:
                info.block(True)
                return
            if scheme != "file":
                return
            local_file = Path(url.toLocalFile() or "").resolve()
            if local_file == self._html_file or _is_within_path(local_file, self._base_dir):
                return
            info.block(True)

    class LockedDownPage(QWebEnginePage):
        def __init__(self, profile, base_dir, html_file, parent=None):
            super().__init__(profile, parent)
            self._base_dir = Path(base_dir).resolve()
            self._html_file = Path(html_file).resolve()
            self._allowed_schemes = {"file", "qrc", "data", "blob", "about"}

        def acceptNavigationRequest(self, url, navigation_type, is_main_frame):
            scheme = str(url.scheme() or "").lower()
            if scheme not in self._allowed_schemes:
                return False
            if scheme != "file":
                return True
            local_file = Path(url.toLocalFile() or "").resolve()
            return local_file == self._html_file or _is_within_path(local_file, self._base_dir)

        def javaScriptConsoleMessage(self, level, message, line_number, source_id):
            logger.info(
                "[js-console] level=%s source=%s line=%s message=%s",
                level,
                source_id or "",
                line_number,
                message,
            )
            super().javaScriptConsoleMessage(level, message, line_number, source_id)

    app = QApplication.instance() or QApplication([])
    logger.info("[gui-startup] phase=app_ready elapsed_ms=%s", round((time.perf_counter() - startup_started) * 1000, 1))
    icon_dir = html_path.parent / "icons"
    icon_path = icon_dir / "icon.ico"
    if not icon_path.exists():
        icon_path = icon_dir / "ziz.svg"
    if icon_path.exists():
        app.setWindowIcon(QIcon(str(icon_path)))

    window = QMainWindow()
    window.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
    window.setWindowTitle("zizai")
    window.setMinimumSize(700, 700)
    window.resize(1440, 960)
    if icon_path.exists():
        window.setWindowIcon(QIcon(str(icon_path)))

    view = QWebEngineView(window)
    view.setContextMenuPolicy(
        Qt.ContextMenuPolicy.DefaultContextMenu if debug else Qt.ContextMenuPolicy.NoContextMenu
    )

    profile = QWebEngineProfile("zizai-webview", view)
    try:
        profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.NoCache)
        profile.clearHttpCache()
    except Exception:
        logger.debug("WebView HTTPキャッシュ無効化に失敗しました。", exc_info=True)
    profile.setUrlRequestInterceptor(LockedDownRequestInterceptor(html_path.parent, html_path))
    page = LockedDownPage(profile, html_path.parent, html_path, view)
    view.setPage(page)
    devtools_window = None
    devtools_view = None
    devtools_page = None

    def show_devtools():
        nonlocal devtools_window, devtools_view, devtools_page
        if not debug:
            return
        if devtools_window is None:
            devtools_window = QMainWindow(window)
            devtools_window.setWindowTitle("zizai DevTools")
            devtools_window.resize(1200, 800)
            if icon_path.exists():
                devtools_window.setWindowIcon(QIcon(str(icon_path)))
            devtools_view = QWebEngineView(devtools_window)
            devtools_page = QWebEnginePage(profile, devtools_view)
            devtools_view.setPage(devtools_page)
            page.setDevToolsPage(devtools_page)
            devtools_window.setCentralWidget(devtools_view)
        devtools_window.show()
        devtools_window.raise_()
        devtools_window.activateWindow()

    def cleanup_webengine():
        try:
            if view.page() is page:
                view.setPage(None)
        except Exception:
            pass
        try:
            if devtools_window is not None:
                devtools_window.close()
        except Exception:
            pass
        try:
            if devtools_page is not None:
                page.setDevToolsPage(None)
                devtools_page.deleteLater()
        except Exception:
            pass
        try:
            page.deleteLater()
        except Exception:
            pass
        try:
            profile.deleteLater()
        except Exception:
            pass

    app.aboutToQuit.connect(cleanup_webengine)

    settings = page.settings()
    settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalStorageEnabled, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, False)
    settings.setAttribute(QWebEngineSettings.WebAttribute.ErrorPageEnabled, True)
    settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptCanOpenWindows, False)
    settings.setAttribute(QWebEngineSettings.WebAttribute.PluginsEnabled, False)

    def to_qt_filter_text(filters, fallback="すべてのファイル (*)"):
        if not filters:
            return fallback
        chunks = []
        for item in filters:
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or "").strip() or "ファイル"
            patterns = item.get("patterns") or []
            normalized = [str(pattern).strip() for pattern in patterns if str(pattern).strip()]
            if not normalized:
                continue
            chunks.append(f"{label} ({' '.join(normalized)})")
        return ";;".join(chunks) if chunks else fallback

    def pick_file_dialog(title, filters):
        selected, _ = QFileDialog.getOpenFileName(
            window,
            title or "ファイルを選択",
            "",
            to_qt_filter_text(filters),
        )
        return selected or None

    def pick_folder_dialog(title):
        selected = QFileDialog.getExistingDirectory(
            window,
            title or "フォルダを選択",
            "",
        )
        return selected or None

    def edit_path_dialog(*, title, initial_path, browse_label, browse_callback, placeholder):
        dialog = QDialog(window)
        dialog.setWindowTitle(title or "パスを編集")
        dialog.setModal(True)
        dialog.resize(760, 150)

        root_layout = QVBoxLayout(dialog)
        root_layout.setContentsMargins(18, 18, 18, 18)
        root_layout.setSpacing(12)

        root_layout.addWidget(QLabel("実際のパスを確認・編集できます。", dialog))

        path_layout = QHBoxLayout()
        path_layout.setSpacing(8)
        path_input = QLineEdit(dialog)
        path_input.setPlaceholderText(placeholder)
        path_input.setText(str(initial_path or ""))
        path_layout.addWidget(path_input, 1)

        browse_button = QPushButton(browse_label, dialog)

        def on_browse():
            selected = browse_callback(path_input.text().strip())
            if selected:
                path_input.setText(str(selected))
                path_input.setCursorPosition(len(path_input.text()))

        browse_button.clicked.connect(on_browse)
        path_layout.addWidget(browse_button, 0)
        root_layout.addLayout(path_layout)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel, dialog)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        root_layout.addWidget(buttons)

        if dialog.exec() != QDialog.DialogCode.Accepted:
            return None

        result = path_input.text().strip()
        return result or None

    def edit_file_dialog(title, current_path, filters):
        filter_text = to_qt_filter_text(filters)

        def browse(current_text):
            selected, _ = QFileDialog.getOpenFileName(
                window,
                title or "ファイルを選択",
                str(current_text or ""),
                filter_text,
            )
            return selected or None

        return edit_path_dialog(
            title=title or "ファイルを編集",
            initial_path=current_path,
            browse_label="参照…",
            browse_callback=browse,
            placeholder="ファイルパスを入力",
        )

    def edit_folder_dialog(title, current_path):
        def browse(current_text):
            selected = QFileDialog.getExistingDirectory(
                window,
                title or "フォルダを選択",
                str(current_text or ""),
                "",
            )
            return selected or None

        return edit_path_dialog(
            title=title or "フォルダを編集",
            initial_path=current_path,
            browse_label="参照…",
            browse_callback=browse,
            placeholder="フォルダパスを入力",
        )

    def pick_flow_dialog():
        selected, _ = QFileDialog.getOpenFileName(
            window,
            "フローを開く",
            "",
            "ziz flow (*.zizw *.zizd *.zizq)",
        )
        return selected or None

    def pick_save_flow_dialog(mode, suggested_name, current_path=None):
        suffix = {
            "workflow": ".zizw",
            "dataflow": ".zizd",
            "query-builder": ".zizq",
        }.get(str(mode or "").strip(), ".zizd")
        default_name = suggested_name or f"フロー{suffix}"
        initial_target = ""
        if current_path:
            try:
                current_resolved = Path(current_path).resolve()
                initial_name = default_name or current_resolved.name
                initial_target = str(current_resolved.with_name(initial_name))
            except Exception:
                initial_target = ""
        if not initial_target:
            initial_target = str(html_path.parent.parent / "workflows" / default_name)
        selected, _ = QFileDialog.getSaveFileName(
            window,
            "フローを保存",
            initial_target,
            "ziz flow (*.zizw *.zizd *.zizq)",
        )
        if not selected:
            return None
        if not Path(selected).suffix:
            return f"{selected}{suffix}"
        return selected

    def handle_window_control(action):
        action_text = str(action or "").strip().lower()
        if action_text == "minimize":
            window.showMinimized()
            return "minimized"
        if action_text == "maximize":
            if window.isMaximized():
                window.showNormal()
                return "normal"
            window.showMaximized()
            return "maximized"
        if action_text == "close":
            window.close()
            return "closed"
        if action_text == "drag":
            handle = window.windowHandle()
            if handle is not None and hasattr(handle, "startSystemMove"):
                handle.startSystemMove()
                return "dragging"
            return "unsupported"
        return "unknown"

    runtime = BridgeRuntime(
        base_dir=html_path.parent.parent,
        debug=bool(debug),
        pick_file_callback=pick_file_dialog,
        pick_folder_callback=pick_folder_dialog,
        edit_file_callback=edit_file_dialog,
        edit_folder_callback=edit_folder_dialog,
        open_flow_callback=pick_flow_dialog,
        save_flow_callback=pick_save_flow_dialog,
        window_control_callback=handle_window_control,
    )
    bridge = WebViewBridge(runtime)

    class NativeEventRelay(QObject):
        messageReady = Signal(str)

    relay = NativeEventRelay()

    def build_run_popup_text(message):
        payload = message.get("payload") or {}
        run_id = str(payload.get("run_id") or "")
        try:
            summary = runtime._handle_result_get_summary({"run_id": run_id}) if run_id else None
        except Exception:
            summary = None
        flow_name = str((summary or {}).get("flow_name") or "フロー")
        duration_ms = (summary or {}).get("duration_ms")
        if message.get("type") == "run.completed":
            duration_suffix = f"\n実行時間: {duration_ms} ms" if duration_ms is not None else ""
            return "success", "実行完了", f"{flow_name} の実行が完了しました。{duration_suffix}"
        error_message = str(((summary or {}).get("error") or {}).get("message") or "実行に失敗しました。")
        return "error", "実行エラー", f"{flow_name} の実行に失敗しました。\n{error_message}"

    def show_native_status_popup(kind, title, message_text):
        dialog = QDialog(window)
        dialog.setWindowTitle(title)
        dialog.setModal(True)
        dialog.resize(520, 220)
        if icon_path.exists():
            dialog.setWindowIcon(QIcon(str(icon_path)))

        is_success = kind == "success"
        accent = "#5865f2" if kind == "info" else ("#1f8f5f" if is_success else "#c9475c")
        surface = "#f4f2ff" if kind == "info" else ("#eefaf4" if is_success else "#fff1f3")
        icon_bg = "#efe9ff" if kind == "info" else ("#dff4e8" if is_success else "#ffe1e6")
        button_bg = "#e5e0ff" if kind == "info" else ("#d8f2e4" if is_success else "#ffd9df")
        icon_text = "✓" if is_success else "!"

        root_layout = QVBoxLayout(dialog)
        root_layout.setContentsMargins(18, 18, 18, 16)
        root_layout.setSpacing(14)

        content_layout = QHBoxLayout()
        content_layout.setSpacing(14)

        icon_label = QLabel(icon_text, dialog)
        icon_label.setObjectName("nativeStatusIcon")
        icon_label.setFixedSize(56, 56)
        icon_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        content_layout.addWidget(icon_label, 0, Qt.AlignmentFlag.AlignTop)

        body_layout = QVBoxLayout()
        body_layout.setSpacing(6)

        message_label = QLabel(message_text, dialog)
        message_label.setObjectName("nativeStatusMessage")
        message_label.setWordWrap(True)
        body_layout.addWidget(message_label)

        content_layout.addLayout(body_layout, 1)
        root_layout.addLayout(content_layout)

        actions_layout = QHBoxLayout()
        actions_layout.addStretch(1)
        ok_button = QPushButton("OK", dialog)
        ok_button.setObjectName("nativeStatusOkButton")
        ok_button.clicked.connect(dialog.accept)
        actions_layout.addWidget(ok_button, 0, Qt.AlignmentFlag.AlignRight)
        root_layout.addLayout(actions_layout)

        dialog.setStyleSheet(
            f"""
            QDialog {{
                background: {surface};
                border: 1px solid #d8d3ee;
                border-radius: 22px;
            }}
            QLabel#nativeStatusIcon {{
                border-radius: 18px;
                background: {icon_bg};
                color: {accent};
                font-size: 28px;
                font-weight: 800;
            }}
            QLabel#nativeStatusMessage {{
                color: #1f2937;
                font-size: 14px;
                line-height: 1.5;
            }}
            QPushButton#nativeStatusOkButton {{
                min-width: 84px;
                padding: 8px 16px;
                border-radius: 999px;
                border: 1px solid {accent};
                background: {button_bg};
                color: {accent};
                font-weight: 700;
            }}
            """
        )
        dialog.exec()

    @Slot(str)
    def handle_native_event(raw_text):
        try:
            message = json.loads(str(raw_text or ""))
        except Exception:
            return
        message_type = str(message.get("type") or "")
        if message_type not in {"run.completed", "run.failed"}:
            return
        kind, title, text = build_run_popup_text(message)
        show_native_status_popup(kind, title, text)

    relay.messageReady.connect(handle_native_event)

    def emit_event_to_frontend_and_native(message):
        serialized = json.dumps(message, ensure_ascii=False)
        bridge.messageToFrontend.emit(serialized)
        relay.messageReady.emit(serialized)

    runtime.set_event_sink(emit_event_to_frontend_and_native)

    channel = QWebChannel(page)
    channel.registerObject("backendBridge", bridge)
    page.setWebChannel(channel)
    logger.info("[gui-startup] phase=bridge_ready elapsed_ms=%s", round((time.perf_counter() - startup_started) * 1000, 1))

    view.setUrl(QUrl.fromLocalFile(str(html_path)))
    window.setCentralWidget(view)
    if debug:
        debug_menu = window.menuBar().addMenu("Debug")
        open_devtools_action = QAction("Open DevTools", window)
        open_devtools_action.setShortcuts([QKeySequence("F12"), QKeySequence("Ctrl+Shift+I")])
        open_devtools_action.triggered.connect(show_devtools)
        debug_menu.addAction(open_devtools_action)
    window.show()
    logger.info("[gui-startup] phase=window_shown elapsed_ms=%s html=%s", round((time.perf_counter() - startup_started) * 1000, 1), html_path.name)

    return app.exec()
