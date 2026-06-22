import os
import json
import time
import logging
import ctypes
from pathlib import Path

logger = logging.getLogger("ziz.gui_host")

WINDOW_FRAME_COLOR = "#292941"


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
        from PySide6.QtCore import QElapsedTimer, QEvent, QRect, Qt, QTimer, QUrl, Signal
        from PySide6.QtGui import QAction, QCursor, QIcon, QKeySequence
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
            QWidget,
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

    class ResizeHandle(QWidget):
        def __init__(self, parent, edges, cursor_shape):
            super().__init__(parent)
            self._edges = edges
            self.setCursor(cursor_shape)
            self.setStyleSheet("background: transparent;")

        def mousePressEvent(self, event):
            if event.button() != Qt.MouseButton.LeftButton:
                super().mousePressEvent(event)
                return
            host_window = self.window()
            if host_window.isMaximized() or host_window.isFullScreen():
                event.ignore()
                return
            handle = host_window.windowHandle()
            if handle is not None and hasattr(handle, "startSystemResize"):
                if handle.startSystemResize(self._edges):
                    event.accept()
                    return
            super().mousePressEvent(event)

    class FramelessMainWindow(QMainWindow):
        _RESIZE_MARGIN = 6

        def __init__(self):
            super().__init__()
            self._resize_handles = []
            self._overlay_sync_callback = None

        def install_resize_handles(self):
            if self._resize_handles:
                return
            specs = [
                (Qt.Edge.LeftEdge, Qt.CursorShape.SizeHorCursor),
                (Qt.Edge.RightEdge, Qt.CursorShape.SizeHorCursor),
                (Qt.Edge.TopEdge, Qt.CursorShape.SizeVerCursor),
                (Qt.Edge.BottomEdge, Qt.CursorShape.SizeVerCursor),
                (Qt.Edge.TopEdge | Qt.Edge.LeftEdge, Qt.CursorShape.SizeFDiagCursor),
                (Qt.Edge.TopEdge | Qt.Edge.RightEdge, Qt.CursorShape.SizeBDiagCursor),
                (Qt.Edge.BottomEdge | Qt.Edge.LeftEdge, Qt.CursorShape.SizeBDiagCursor),
                (Qt.Edge.BottomEdge | Qt.Edge.RightEdge, Qt.CursorShape.SizeFDiagCursor),
            ]
            self._resize_handles = [ResizeHandle(self, edges, cursor_shape) for edges, cursor_shape in specs]
            self._layout_resize_handles()
            self._update_resize_handles_visibility()

        def resizeEvent(self, event):
            super().resizeEvent(event)
            self._layout_resize_handles()
            if callable(self._overlay_sync_callback):
                self._overlay_sync_callback()

        def changeEvent(self, event):
            super().changeEvent(event)
            if event.type() == QEvent.Type.WindowStateChange:
                self._update_resize_handles_visibility()

        def _layout_resize_handles(self):
            if not self._resize_handles:
                return
            margin = self._RESIZE_MARGIN
            width = max(0, int(self.width()))
            height = max(0, int(self.height()))
            vertical_height = max(0, height - (margin * 2))
            horizontal_width = max(0, width - (margin * 2))
            geometries = [
                QRect(0, margin, margin, vertical_height),
                QRect(max(0, width - margin), margin, margin, vertical_height),
                QRect(margin, 0, horizontal_width, margin),
                QRect(margin, max(0, height - margin), horizontal_width, margin),
                QRect(0, 0, margin, margin),
                QRect(max(0, width - margin), 0, margin, margin),
                QRect(0, max(0, height - margin), margin, margin),
                QRect(max(0, width - margin), max(0, height - margin), margin, margin),
            ]
            for handle, geometry in zip(self._resize_handles, geometries):
                handle.setGeometry(geometry)
                handle.raise_()

        def _update_resize_handles_visibility(self):
            hidden = self.isMaximized() or self.isFullScreen()
            for handle in self._resize_handles:
                handle.setVisible(not hidden)
                if not hidden:
                    handle.raise_()

        def set_overlay_sync_callback(self, callback):
            self._overlay_sync_callback = callback if callable(callback) else None

    class NativeRetryOverlay(QWidget):
        def __init__(self, parent, retry_callback):
            super().__init__(parent)
            self._retry_callback = retry_callback
            self._message_label = QLabel("画面の読み込みに失敗しました。", self)
            self._message_label.setWordWrap(True)
            self._message_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            self._message_label.setObjectName("nativeRetryMessage")
            self._retry_button = QPushButton("再試行", self)
            self._retry_button.setObjectName("nativeRetryButton")
            self._retry_button.clicked.connect(self._on_retry_clicked)
            self.setObjectName("nativeRetryOverlay")
            self._build_ui()
            self.hide()

        def _build_ui(self):
            root_layout = QVBoxLayout(self)
            root_layout.setContentsMargins(24, 24, 24, 24)
            root_layout.setSpacing(0)
            root_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

            card = QWidget(self)
            card.setObjectName("nativeRetryCard")
            card_layout = QVBoxLayout(card)
            card_layout.setContentsMargins(20, 20, 20, 20)
            card_layout.setSpacing(12)

            title_label = QLabel("表示に失敗しました", card)
            title_label.setObjectName("nativeRetryTitle")
            title_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            card_layout.addWidget(title_label)
            card_layout.addWidget(self._message_label)
            card_layout.addWidget(self._retry_button, 0, Qt.AlignmentFlag.AlignCenter)

            root_layout.addWidget(card, 0, Qt.AlignmentFlag.AlignCenter)
            self.setStyleSheet(
                """
                QWidget#nativeRetryOverlay {
                    background: rgba(9, 12, 20, 0.58);
                }
                QWidget#nativeRetryCard {
                    background: #ffffff;
                    border: 1px solid #d8dce7;
                    border-radius: 14px;
                    min-width: 320px;
                    max-width: 520px;
                }
                QLabel#nativeRetryTitle {
                    color: #111827;
                    font-size: 18px;
                    font-weight: 700;
                }
                QLabel#nativeRetryMessage {
                    color: #334155;
                    font-size: 13px;
                }
                QPushButton#nativeRetryButton {
                    min-width: 120px;
                    padding: 8px 14px;
                    border-radius: 999px;
                    border: 1px solid #1d4ed8;
                    background: #eff6ff;
                    color: #1d4ed8;
                    font-weight: 700;
                }
                """
            )

        def sync_geometry(self):
            parent_widget = self.parentWidget()
            if parent_widget is None:
                return
            self.setGeometry(parent_widget.rect())
            self.raise_()

        def show_error(self, message_text):
            text = str(message_text or "").strip() or "画面の読み込みに失敗しました。"
            self._message_label.setText(text)
            self.sync_geometry()
            self.show()
            self.raise_()

        def _on_retry_clicked(self):
            self.hide()
            if callable(self._retry_callback):
                self._retry_callback()

    class CoordinateCaptureOverlay(QWidget):
        coordinate_preview = Signal(str, int, int)
        coordinate_selected = Signal(str, int, int)
        coordinate_cancelled = Signal(str)
        _PREVIEW_INTERVAL_MS = 50

        def __init__(self):
            super().__init__()
            self._capture_id = ""
            self._preview_timer = QElapsedTimer()
            self.setObjectName("coordinateCaptureOverlay")
            self.setWindowFlags(
                Qt.WindowType.FramelessWindowHint
                | Qt.WindowType.WindowStaysOnTopHint
                | Qt.WindowType.Tool
            )
            self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground, True)
            self.setWindowOpacity(0.01)
            self.setMouseTracking(True)

        def begin(self, capture_id):
            next_capture_id = str(capture_id or "").strip()
            if not next_capture_id:
                return False
            if self._capture_id and self._capture_id != next_capture_id:
                self.coordinate_cancelled.emit(self._capture_id)
            primary_screen = QApplication.primaryScreen()
            if primary_screen is None:
                return False
            self._capture_id = next_capture_id
            self.setGeometry(primary_screen.virtualGeometry())
            self._preview_timer.invalidate()
            self.show()
            self.raise_()
            self.activateWindow()
            self.setFocus(Qt.FocusReason.ActiveWindowFocusReason)
            self._emit_preview(QCursor.pos(), force=True)
            return True

        def mouseMoveEvent(self, event):
            self._emit_preview(event.globalPosition().toPoint())
            event.accept()

        def mousePressEvent(self, event):
            if event.button() != Qt.MouseButton.LeftButton:
                event.accept()
                return
            capture_id = self._capture_id
            if not capture_id:
                event.accept()
                return
            position = event.globalPosition().toPoint()
            self._emit_preview(position, force=True)
            self._capture_id = ""
            self.hide()
            self.coordinate_selected.emit(capture_id, position.x(), position.y())
            event.accept()

        def keyPressEvent(self, event):
            if event.key() == Qt.Key.Key_Escape and self._capture_id:
                capture_id = self._capture_id
                self._capture_id = ""
                self.hide()
                self.coordinate_cancelled.emit(capture_id)
                event.accept()
                return
            super().keyPressEvent(event)

        def _emit_preview(self, position, *, force=False):
            if not self._capture_id:
                return
            if (
                not force
                and self._preview_timer.isValid()
                and self._preview_timer.elapsed() < self._PREVIEW_INTERVAL_MS
            ):
                return
            self._preview_timer.restart()
            self.coordinate_preview.emit(self._capture_id, position.x(), position.y())

    app = QApplication.instance() or QApplication([])
    logger.info("[gui-startup] phase=app_ready elapsed_ms=%s", round((time.perf_counter() - startup_started) * 1000, 1))
    icon_dir = html_path.parent / "icons"
    icon_path = icon_dir / "icon.ico"
    if not icon_path.exists():
        icon_path = icon_dir / "ziz.svg"
    if icon_path.exists():
        app.setWindowIcon(QIcon(str(icon_path)))

    window = FramelessMainWindow()
    window.setStyleSheet(f"QMainWindow {{ background: {WINDOW_FRAME_COLOR}; }}")
    window.setWindowFlag(Qt.WindowType.FramelessWindowHint, True)
    window.setWindowTitle("zizai")
    window.setMinimumSize(700, 700)
    window.resize(1440, 960)
    if icon_path.exists():
        window.setWindowIcon(QIcon(str(icon_path)))
    startup_placeholder = QWidget(window)
    startup_placeholder.setStyleSheet("background: #0b0f1a;")
    window.setCentralWidget(startup_placeholder)
    window.install_resize_handles()
    window.show()
    app.processEvents()
    logger.info(
        "[gui-startup] phase=window_shown_native elapsed_ms=%s",
        round((time.perf_counter() - startup_started) * 1000, 1),
    )

    view = QWebEngineView(window)
    view.setContextMenuPolicy(
        Qt.ContextMenuPolicy.DefaultContextMenu if debug else Qt.ContextMenuPolicy.NoContextMenu
    )

    profile = QWebEngineProfile("zizai-webview", view)
    try:
        profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.DiskHttpCache)
    except Exception:
        logger.debug("WebView HTTPキャッシュ設定に失敗しました。", exc_info=True)
    profile.setUrlRequestInterceptor(LockedDownRequestInterceptor(html_path.parent, html_path))
    page = LockedDownPage(profile, html_path.parent, html_path, view)
    view.setPage(page)
    logger.info(
        "[gui-startup] phase=webengine_objects_ready elapsed_ms=%s",
        round((time.perf_counter() - startup_started) * 1000, 1),
    )
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
            "ziz flow (*.zizd)",
        )
        return selected or None

    def pick_save_flow_dialog(mode, suggested_name, current_path=None):
        suffix = ".zizd"
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
            "ziz flow (*.zizd)",
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

    coordinate_capture_overlay = CoordinateCaptureOverlay()

    def start_coordinate_capture(capture_id):
        return coordinate_capture_overlay.begin(capture_id)

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
        coordinate_capture_callback=start_coordinate_capture,
    )
    bridge = WebViewBridge(runtime)

    def emit_event_to_frontend(message):
        serialized = json.dumps(message, ensure_ascii=False)
        bridge.messageToFrontend.emit(serialized)

    runtime.set_event_sink(emit_event_to_frontend)

    def emit_coordinate_preview(capture_id, x, y):
        runtime.emit_event("mouse.coordinateCapture.preview", {
            "capture_id": capture_id,
            "x": int(x),
            "y": int(y),
        })

    def emit_coordinate_selected(capture_id, x, y):
        runtime.emit_event("mouse.coordinateCapture.selected", {
            "capture_id": capture_id,
            "x": int(x),
            "y": int(y),
        })

    def emit_coordinate_cancelled(capture_id):
        runtime.emit_event("mouse.coordinateCapture.cancelled", {
            "capture_id": capture_id,
        })

    coordinate_capture_overlay.coordinate_preview.connect(emit_coordinate_preview)
    coordinate_capture_overlay.coordinate_selected.connect(emit_coordinate_selected)
    coordinate_capture_overlay.coordinate_cancelled.connect(emit_coordinate_cancelled)
    app.aboutToQuit.connect(coordinate_capture_overlay.close)

    channel = QWebChannel(page)
    channel.registerObject("backendBridge", bridge)
    page.setWebChannel(channel)
    logger.info("[gui-startup] phase=bridge_ready elapsed_ms=%s", round((time.perf_counter() - startup_started) * 1000, 1))

    retry_state = {
        "attempts": 0,
    }
    startup_version = str(int(html_path.stat().st_mtime))
    target_url = QUrl.fromLocalFile(str(html_path))
    target_url.setQuery(f"v={startup_version}")
    retry_overlay = None
    load_timeout_timer = QTimer(window)
    load_timeout_timer.setSingleShot(True)
    load_timeout_timer.setInterval(8000)

    def load_main_page():
        retry_state["attempts"] += 1
        logger.info("[gui-startup] phase=page_load_attempt attempt=%s", retry_state["attempts"])
        load_timeout_timer.stop()
        load_timeout_timer.start()
        view.setUrl(target_url)

    def show_retry_overlay_for_load_failure():
        if retry_overlay is None:
            return
        retry_overlay.show_error("画面の初期化に失敗しました。再試行してください。")
        logger.error("[gui-startup] phase=page_load_failed attempt=%s", retry_state["attempts"])

    def handle_load_finished(ok):
        load_timeout_timer.stop()
        if ok:
            if retry_overlay is not None:
                retry_overlay.hide()
            logger.info("[gui-startup] phase=page_loaded attempt=%s", retry_state["attempts"])
            logger.info(
                "[gui-startup] phase=home_ready attempt=%s elapsed_ms=%s",
                retry_state["attempts"],
                round((time.perf_counter() - startup_started) * 1000, 1),
            )
            return
        show_retry_overlay_for_load_failure()

    def handle_load_timeout():
        if retry_overlay is None:
            return
        retry_overlay.show_error("初期化がタイムアウトしました。再試行してください。")
        logger.error("[gui-startup] phase=page_load_timeout attempt=%s", retry_state["attempts"])

    def handle_render_process_terminated(termination_status, exit_code):
        if retry_overlay is None:
            return
        status_text = str(termination_status)
        retry_overlay.show_error("表示プロセスが停止しました。再試行してください。")
        logger.error(
            "[gui-startup] phase=render_process_terminated status=%s exit_code=%s",
            status_text,
            exit_code,
        )

    page.loadFinished.connect(handle_load_finished)
    page.renderProcessTerminated.connect(handle_render_process_terminated)
    load_timeout_timer.timeout.connect(handle_load_timeout)

    window.setCentralWidget(view)
    logger.info(
        "[gui-startup] phase=webview_attached elapsed_ms=%s",
        round((time.perf_counter() - startup_started) * 1000, 1),
    )
    retry_overlay = NativeRetryOverlay(window, load_main_page)
    retry_overlay.sync_geometry()
    window.set_overlay_sync_callback(retry_overlay.sync_geometry)
    QTimer.singleShot(0, load_main_page)
    if debug:
        debug_menu = window.menuBar().addMenu("Debug")
        open_devtools_action = QAction("Open DevTools", window)
        open_devtools_action.setShortcuts([QKeySequence("F12"), QKeySequence("Ctrl+Shift+I")])
        open_devtools_action.triggered.connect(show_devtools)
        debug_menu.addAction(open_devtools_action)
    logger.info(
        "[gui-startup] phase=event_loop_start elapsed_ms=%s html=%s",
        round((time.perf_counter() - startup_started) * 1000, 1),
        html_path.name,
    )

    return app.exec()
