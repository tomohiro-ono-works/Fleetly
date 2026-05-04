import atexit
import logging
import os
import queue
from datetime import datetime, timedelta
from logging.handlers import QueueHandler, QueueListener
from pathlib import Path
from threading import RLock

LOG_DIR = Path("logs")
MAX_BYTES_PER_FILE = 10 * 1024 * 1024
BACKUP_COUNT_PER_DAY = 3
RETENTION_DAYS = 14
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


def _prune_log_files(log_dir, *, retention_days, total_limit_bytes):
    now = datetime.now()
    cutoff = now - timedelta(days=max(1, int(retention_days)))
    files = [path for path in log_dir.glob("*.log*") if path.is_file()]
    for path in files:
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime)
        except OSError:
            continue
        if modified_at < cutoff:
            _safe_unlink(path)

    files = [path for path in log_dir.glob("*.log*") if path.is_file()]
    entries = []
    total_size = 0
    for path in files:
        try:
            stat = path.stat()
        except OSError:
            continue
        entries.append((path, stat.st_mtime, stat.st_size))
        total_size += stat.st_size

    if total_size <= total_limit_bytes:
        return

    for path, _, size in sorted(entries, key=lambda item: item[1]):
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


class DailySizeFileHandler(logging.Handler):
    def __init__(self, log_dir, *, max_bytes, backup_count, retention_days, total_limit_bytes):
        super().__init__()
        self._log_dir = Path(log_dir)
        self._log_dir.mkdir(parents=True, exist_ok=True)
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
        return datetime.now().strftime("%Y%m%d")

    def _base_path_for_day(self, day_text):
        return self._log_dir / f"app_{day_text}.log"

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


def setup_logger():
    global _LOG_QUEUE, _LOG_LISTENER, _LOGGER_INITIALIZED, _SESSION_ID

    with _STATE_LOCK:
        if _LOGGER_INITIALIZED:
            return logging.getLogger("ziz")

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        _SESSION_ID = f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{os.getpid()}"
        level = _resolve_level()

        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] [pid=%(process)d] [sid=%(session_id)s] [%(name)s] %(message)s"
        )
        session_filter = SessionContextFilter(_SESSION_ID)

        console_handler = logging.StreamHandler()
        console_handler.setLevel(level)
        console_handler.setFormatter(formatter)
        console_handler.addFilter(session_filter)

        file_handler = DailySizeFileHandler(
            LOG_DIR,
            max_bytes=MAX_BYTES_PER_FILE,
            backup_count=BACKUP_COUNT_PER_DAY,
            retention_days=RETENTION_DAYS,
            total_limit_bytes=TOTAL_SIZE_LIMIT_BYTES,
        )
        file_handler.setLevel(level)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(session_filter)

        _LOG_QUEUE = queue.Queue(-1)
        _LOG_LISTENER = QueueListener(_LOG_QUEUE, console_handler, file_handler, respect_handler_level=True)
        _LOG_LISTENER.start()

        root_logger = logging.getLogger()
        for handler in list(root_logger.handlers):
            root_logger.removeHandler(handler)
        root_logger.setLevel(level)
        root_logger.addHandler(QueueHandler(_LOG_QUEUE))

        app_logger = logging.getLogger("ziz")
        app_logger.handlers = []
        app_logger.setLevel(level)
        app_logger.propagate = True

        _LOGGER_INITIALIZED = True
        atexit.register(shutdown_logger)

    return logging.getLogger("ziz")
