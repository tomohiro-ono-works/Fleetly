import faulthandler
import logging
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QObject, Signal, Slot

from app.gui.bridge_contract import (
    PROTOCOL_VERSION,
    build_failure_response,
    peek_command_identity,
)
from app.gui.bridge_events import BridgeMessageQueue
from shared.security_sanitizer import SensitiveDataSanitizer


logger = logging.getLogger("ziz.qwebchannel_transport")


class QWebChannelTransport(QObject):
    messageToFrontend = Signal(str)
    ASYNC_MESSAGE_TYPES = frozenset({
        "app.googleAuthStatus",
        "preview.readExcel",
        "preview.readCsv",
    })

    def __init__(self, dispatcher, *, base_dir, sanitizer=None, parent=None):
        super().__init__(parent)
        self._dispatcher = dispatcher
        self._base_dir = Path(base_dir).resolve()
        self._sanitizer = sanitizer or SensitiveDataSanitizer()
        self._accepting = True
        self._worker_lock = threading.RLock()
        self._workers = set()
        self._messages = BridgeMessageQueue(self)
        self._messages.message_ready.connect(self.messageToFrontend.emit)

    def publish(self, message):
        mask_paths = isinstance(message, dict) and message.get("kind") == "evt"
        self._messages.publish(self._sanitizer.sanitize_structure(
            message,
            mask_paths=mask_paths,
        ))

    @Slot(str)
    def postMessage(self, raw_text):
        message_id, message_type = peek_command_identity(raw_text)
        if not self._accepting:
            self.publish(build_failure_response(
                message_id,
                message_type,
                "E_NOT_READY",
                "QWebChannel transportは終了処理中です。",
                f"trace_{uuid.uuid4().hex}",
                protocol_version=PROTOCOL_VERSION,
            ))
            return

        if message_type in self.ASYNC_MESSAGE_TYPES:
            worker = threading.Thread(
                target=self._run_async_message,
                args=(raw_text, message_type),
                daemon=True,
                name=f"bridge-async-{message_type}",
            )
            with self._worker_lock:
                self._workers.add(worker)
            worker.start()
            return
        self._dispatch_and_publish(raw_text, message_type)

    def shutdown(self, timeout_seconds=1.0):
        self._accepting = False
        deadline = time.monotonic() + max(0.0, float(timeout_seconds))
        current_thread = threading.current_thread()
        with self._worker_lock:
            workers = list(self._workers)
        for worker in workers:
            if worker is current_thread:
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            worker.join(timeout=remaining)

    def _run_async_message(self, raw_text, message_type):
        try:
            self._dispatch_and_publish(raw_text, message_type)
        finally:
            current_thread = threading.current_thread()
            with self._worker_lock:
                self._workers.discard(current_thread)

    def _dispatch_and_publish(self, raw_text, message_type):
        started = time.perf_counter()
        stream, dump_path = self._arm_hang_dump(message_type)
        try:
            response = self._dispatcher.dispatch_raw(raw_text)
        except Exception:
            logger.exception("bridge dispatch failed outside dispatcher")
            message_id, resolved_type = peek_command_identity(raw_text)
            response = build_failure_response(
                message_id,
                resolved_type,
                "E_INTERNAL",
                "内部エラーが発生しました。",
                f"trace_{uuid.uuid4().hex}",
                protocol_version=PROTOCOL_VERSION,
            )
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            self._disarm_hang_dump(stream, dump_path, message_type, elapsed_ms)
        self.publish(response)

    def _arm_hang_dump(self, message_type):
        trace_targets = {
            "file.pickFile",
            "file.pickFolder",
            "preview.readExcel",
            "preview.readCsv",
        }
        if message_type not in trace_targets:
            return None, None
        try:
            logs_dir = (self._base_dir / "logs").resolve()
            logs_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
            dump_path = logs_dir / f"hang_dump_{message_type.replace('.', '_')}_{timestamp}.log"
            stream = dump_path.open("w", encoding="utf-8")
            stream.write(f"[hang-watch] type={message_type} armed_at={datetime.now().isoformat()}\n")
            stream.flush()
            faulthandler.dump_traceback_later(12.0, repeat=False, file=stream, exit=False)
            return stream, dump_path
        except Exception:
            logger.exception("[hang-watch] arm failed type=%s", message_type)
            return None, None

    def _disarm_hang_dump(self, stream, dump_path, message_type, elapsed_ms):
        if stream is None:
            return
        try:
            faulthandler.cancel_dump_traceback_later()
        except Exception:
            pass
        try:
            stream.write(
                f"[hang-watch] type={message_type} disarmed_at={datetime.now().isoformat()} "
                f"elapsed_ms={round(elapsed_ms, 1)}\n"
            )
            stream.flush()
            stream.close()
        except Exception:
            pass
        logger.info(
            "[hang-watch] type=%s elapsed_ms=%s dump=%s",
            message_type,
            round(elapsed_ms, 1),
            str(dump_path or ""),
        )
