import atexit
import copy
import logging
import os
import queue
from datetime import datetime, timedelta
from logging.handlers import QueueHandler, QueueListener
from pathlib import Path
from threading import RLock

from shared.security_sanitizer import SensitiveDataSanitizer

LOG_DIR = Path("logs")
MAX_BYTES_PER_FILE = 10 * 1024 * 1024
BACKUP_COUNT_PER_DAY = 3
RETENTION_DAYS = 10
TOTAL_SIZE_LIMIT_BYTES = 1024 * 1024 * 1024
DEFAULT_LEVEL_NAME = "INFO"

_LOG_QUEUE = None
_LOG_LISTENER = None
_LOGGER_INITIALIZED = False
_SESSION_ID = ""
_STATE_LOCK = RLock()


def _resolve_level():
    name = str(os.environ.get("ZIZ_LOG_LEVEL", DEFAULT_LEVEL_NAME) or DEFAULT_LEVEL_NAME).strip().upper()
    return getattr(logging, name, logging.INFO)


def _safe_unlink(path):
    try:
        path.unlink(missing_ok=True)
    except Exception:
        return


def _managed_log_files(log_dir):
    paths = {}
    for pattern in ("*.log*", "run_log_*.jsonl"):
        for path in Path(log_dir).glob(pattern):
            if path.is_file():
                paths[str(path.resolve())] = path
    return list(paths.values())


def _prune_log_files(log_dir, *, retention_days, total_limit_bytes):
    now = datetime.now()
    today = now.date()
    cutoff = today - timedelta(
        days=max(1, int(retention_days)) - 1
    )
    files = _managed_log_files(log_dir)
    for path in files:
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime)
        except OSError:
            continue
        if modified_at.date() < cutoff:
            _safe_unlink(path)

    files = _managed_log_files(log_dir)
    entries = []
    total_size = 0
    for path in files:
        try:
            stat = path.stat()
        except OSError:
            continue
        modified_at = datetime.fromtimestamp(stat.st_mtime)
        entries.append(
            (path, stat.st_mtime, stat.st_size, modified_at.date())
        )
        total_size += stat.st_size

    if total_size <= total_limit_bytes:
        return

    for path, _, size, modified_date in sorted(
        entries,
        key=lambda item: item[1],
    ):
        if modified_date >= today:
            continue
        _safe_unlink(path)
        total_size -= size
        if total_size <= total_limit_bytes:
            break


class SessionContextFilter(logging.Filter):
    def __init__(self, session_id):
        super().__init__()
        self._session_id = str(session_id or "")

    def filter(self, record):
        record.session_id = self._session_id
        return True


class SanitizingFormatter(logging.Formatter):
    def __init__(self, format_text, *, mask_paths):
        super().__init__(format_text)
        self._sanitizer = SensitiveDataSanitizer()
        self._mask_paths = bool(mask_paths)

    def format(self, record):
        copied = copy.copy(record)
        copied.msg = self._sanitizer.sanitize_text(
            record.getMessage(),
            mask_paths=self._mask_paths,
        )
        copied.args = ()
        return super().format(copied)


class DailySizeFileHandler(logging.Handler):
    def __init__(
        self,
        log_dir,
        *,
        file_prefix="app_log",
        max_bytes,
        backup_count,
        retention_days,
        total_limit_bytes,
    ):
        super().__init__()
        self._log_dir = Path(log_dir)
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._file_prefix = str(file_prefix or "app_log").strip()
        self._max_bytes = int(max_bytes)
        self._backup_count = max(1, int(backup_count))
        self._retention_days = max(1, int(retention_days))
        self._total_limit_bytes = max(1, int(total_limit_bytes))
        self._current_day = ""
        self._base_path = None
        self._stream = None
        self._lock = RLock()
        self._open_stream_for_today()
        _prune_log_files(
            self._log_dir,
            retention_days=self._retention_days,
            total_limit_bytes=self._total_limit_bytes,
        )

    def _today_text(self):
        return datetime.now().strftime("%Y-%m-%d")

    def _base_path_for_day(self, day_text):
        return self._log_dir / f"{self._file_prefix}_{day_text}.log"

    def _close_stream(self):
        if self._stream is None:
            return
        try:
            self._stream.flush()
            self._stream.close()
        except Exception:
            pass
        self._stream = None

    def _open_stream(self):
        if self._base_path is None:
            return
        self._stream = self._base_path.open("a", encoding="utf-8")

    def _open_stream_for_today(self):
        self._current_day = self._today_text()
        self._base_path = self._base_path_for_day(self._current_day)
        self._close_stream()
        self._open_stream()

    def _rollover(self):
        if self._base_path is None:
            return
        self._close_stream()
        for idx in range(self._backup_count, 0, -1):
            src = Path(f"{self._base_path}.{idx}")
            dst = Path(f"{self._base_path}.{idx + 1}")
            if not src.exists():
                continue
            if idx == self._backup_count:
                _safe_unlink(src)
                continue
            if dst.exists():
                _safe_unlink(dst)
            try:
                src.rename(dst)
            except Exception:
                pass
        first_backup = Path(f"{self._base_path}.1")
        if first_backup.exists():
            _safe_unlink(first_backup)
        if self._base_path.exists():
            try:
                self._base_path.rename(first_backup)
            except Exception:
                pass
        self._open_stream()
        _prune_log_files(
            self._log_dir,
            retention_days=self._retention_days,
            total_limit_bytes=self._total_limit_bytes,
        )

    def _ensure_target(self, incoming_size):
        day_text = self._today_text()
        if day_text != self._current_day:
            self._open_stream_for_today()
            _prune_log_files(
                self._log_dir,
                retention_days=self._retention_days,
                total_limit_bytes=self._total_limit_bytes,
            )
        if self._stream is None:
            self._open_stream()
        try:
            current_size = self._stream.tell()
        except Exception:
            current_size = 0
        if current_size + incoming_size > self._max_bytes:
            self._rollover()

    def emit(self, record):
        try:
            message = self.format(record)
        except Exception:
            self.handleError(record)
            return
        payload = f"{message}\n"
        incoming_size = len(payload.encode("utf-8", errors="replace"))
        try:
            with self._lock:
                self._ensure_target(incoming_size)
                if self._stream is None:
                    return
                self._stream.write(payload)
                self._stream.flush()
        except Exception:
            self.handleError(record)

    def close(self):
        with self._lock:
            self._close_stream()
        super().close()


def shutdown_logger():
    global _LOG_LISTENER
    with _STATE_LOCK:
        listener = _LOG_LISTENER
        _LOG_LISTENER = None
    if listener is not None:
        try:
            listener.stop()
        except Exception:
            pass


def setup_logger(*, mode="gui", debug=False, log_dir=None):
    global _LOG_QUEUE, _LOG_LISTENER, _LOGGER_INITIALIZED, _SESSION_ID

    with _STATE_LOCK:
        if _LOGGER_INITIALIZED:
            return logging.getLogger("ziz")

        target_log_dir = Path(log_dir) if log_dir is not None else LOG_DIR
        target_log_dir.mkdir(parents=True, exist_ok=True)
        _SESSION_ID = f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.getpid()}"
        configured_level = _resolve_level()
        root_level = (
            min(configured_level, logging.DEBUG)
            if debug
            else configured_level
        )
        normalized_mode = str(mode or "gui").strip().lower()
        app_log_prefix = (
            "cli_app_log"
            if normalized_mode == "cli"
            else "gui_app_log"
        )

        format_text = (
            "%(asctime)s [%(levelname)s] [pid=%(process)d] "
            "[sid=%(session_id)s] [%(name)s] %(message)s"
        )
        standard_formatter = SanitizingFormatter(
            format_text,
            mask_paths=True,
        )
        debug_formatter = SanitizingFormatter(
            format_text,
            mask_paths=False,
        )
        session_filter = SessionContextFilter(_SESSION_ID)

        console_handler = logging.StreamHandler()
        console_handler.setLevel(configured_level)
        console_handler.setFormatter(standard_formatter)
        console_handler.addFilter(session_filter)

        file_handler = DailySizeFileHandler(
            target_log_dir,
            file_prefix=app_log_prefix,
            max_bytes=MAX_BYTES_PER_FILE,
            backup_count=BACKUP_COUNT_PER_DAY,
            retention_days=RETENTION_DAYS,
            total_limit_bytes=TOTAL_SIZE_LIMIT_BYTES,
        )
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(standard_formatter)
        file_handler.addFilter(session_filter)

        output_handlers = [console_handler, file_handler]
        if debug:
            debug_handler = DailySizeFileHandler(
                target_log_dir,
                file_prefix="debug_log",
                max_bytes=MAX_BYTES_PER_FILE,
                backup_count=BACKUP_COUNT_PER_DAY,
                retention_days=RETENTION_DAYS,
                total_limit_bytes=TOTAL_SIZE_LIMIT_BYTES,
            )
            debug_handler.setLevel(logging.DEBUG)
            debug_handler.setFormatter(debug_formatter)
            debug_handler.addFilter(session_filter)
            output_handlers.append(debug_handler)

        _LOG_QUEUE = queue.Queue(-1)
        _LOG_LISTENER = QueueListener(
            _LOG_QUEUE,
            *output_handlers,
            respect_handler_level=True,
        )
        _LOG_LISTENER.start()

        root_logger = logging.getLogger()
        for handler in list(root_logger.handlers):
            root_logger.removeHandler(handler)
        root_logger.setLevel(root_level)
        root_logger.addHandler(QueueHandler(_LOG_QUEUE))

        app_logger = logging.getLogger("ziz")
        app_logger.handlers = []
        app_logger.setLevel(root_level)
        app_logger.propagate = True

        _LOGGER_INITIALIZED = True
        atexit.register(shutdown_logger)

    return logging.getLogger("ziz")
