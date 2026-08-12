import copy
import json
import re
import threading
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


def _safe_text(value):
    return str(value or "").strip()


class RunLogStore:
    MAX_PAGE_ITEMS = 500
    DEFAULT_RETENTION_DAYS = 10
    DEFAULT_SOFT_LIMIT_BYTES = 1024 * 1024 * 1024
    FILE_PATTERN = re.compile(r"^run_log_(\d{4}-\d{2}-\d{2})\.jsonl$")
    LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR"})
    CATEGORIES = frozenset({"run", "step", "connector", "system"})

    def __init__(
        self,
        log_dir,
        *,
        retention_days=DEFAULT_RETENTION_DAYS,
        soft_limit_bytes=DEFAULT_SOFT_LIMIT_BYTES,
        lock=None,
        now_provider=None,
    ):
        self.log_dir = Path(log_dir).resolve()
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self.retention_days = max(1, int(retention_days))
        self.soft_limit_bytes = max(1, int(soft_limit_bytes))
        self._lock = lock or threading.RLock()
        self._now_provider = now_provider or (
            lambda: datetime.now(timezone.utc)
        )
        self._items_by_run = {}
        self._next_seq_by_run = {}
        self._last_cleanup_date = None
        self.cleanup()

    def append(
        self,
        *,
        run_id,
        level,
        category,
        message,
        ts=None,
        step_id=None,
        connector_id=None,
        action_id=None,
        iteration_no=None,
        iteration_total=None,
        trace_id=None,
        detail=None,
    ):
        normalized_run_id = self._require_text(run_id, "run_id")
        normalized_level = _safe_text(level).upper() or "INFO"
        if normalized_level not in self.LEVELS:
            normalized_level = "INFO"
        normalized_category = _safe_text(category).lower() or "system"
        if normalized_category not in self.CATEGORIES:
            normalized_category = "system"
        now = self._coerce_datetime(ts) or self._now_provider()

        with self._lock:
            if self._last_cleanup_date != now.date():
                self._cleanup_locked(now.date())
            next_seq = int(self._next_seq_by_run.get(normalized_run_id, 0)) + 1
            self._next_seq_by_run[normalized_run_id] = next_seq
            item = {
                "run_id": normalized_run_id,
                "log_seq": next_seq,
                "ts": now.astimezone(timezone.utc).isoformat(),
                "level": normalized_level,
                "category": normalized_category,
                "message": str(message or ""),
            }
            self._set_optional_text(item, "step_id", step_id)
            self._set_optional_text(item, "connector_id", connector_id)
            self._set_optional_text(item, "action_id", action_id)
            self._set_optional_int(item, "iteration_no", iteration_no)
            self._set_optional_int(item, "iteration_total", iteration_total)
            self._set_optional_text(item, "trace_id", trace_id)
            if isinstance(detail, dict) and detail:
                item["detail"] = copy.deepcopy(detail)

            self._items_by_run.setdefault(normalized_run_id, []).append(item)
            self._append_file_locked(item, now.date())
            return copy.deepcopy(item)

    def get_logs(self, run_id, *, before_seq=None, after_seq=None):
        normalized_run_id = self._require_text(run_id, "run_id")
        before = self._normalize_cursor(before_seq, "before_seq")
        after = self._normalize_cursor(after_seq, "after_seq")
        if before is not None and after is not None:
            raise ValueError(
                "before_seq と after_seq は同時に指定できません。"
            )

        with self._lock:
            all_items = list(self._items_by_run.get(normalized_run_id) or [])

        if before is not None:
            candidates = [
                item for item in all_items
                if int(item["log_seq"]) < before
            ]
            selected = candidates[-self.MAX_PAGE_ITEMS :]
            has_more_before = len(candidates) > len(selected)
            has_more_after = bool(
                selected
                and any(
                    int(item["log_seq"]) > int(selected[-1]["log_seq"])
                    for item in all_items
                )
            )
        elif after is not None:
            candidates = [
                item for item in all_items
                if int(item["log_seq"]) > after
            ]
            selected = candidates[: self.MAX_PAGE_ITEMS]
            has_more_after = len(candidates) > len(selected)
            has_more_before = bool(
                selected
                and any(
                    int(item["log_seq"]) < int(selected[0]["log_seq"])
                    for item in all_items
                )
            )
        else:
            selected = all_items[-self.MAX_PAGE_ITEMS :]
            has_more_before = len(all_items) > len(selected)
            has_more_after = False

        response_items = []
        for item in selected:
            response_item = copy.deepcopy(item)
            response_item.pop("run_id", None)
            response_items.append(response_item)
        return {
            "run_id": normalized_run_id,
            "items": response_items,
            "has_more_before": bool(has_more_before),
            "has_more_after": bool(has_more_after),
            "next_before_seq": (
                int(response_items[0]["log_seq"])
                if response_items
                else None
            ),
            "next_after_seq": (
                int(response_items[-1]["log_seq"])
                if response_items
                else None
            ),
        }

    def forget_runs(self, run_ids):
        normalized_ids = {
            _safe_text(run_id)
            for run_id in run_ids or []
            if _safe_text(run_id)
        }
        with self._lock:
            for run_id in normalized_ids:
                self._items_by_run.pop(run_id, None)
                self._next_seq_by_run.pop(run_id, None)

    def cleanup(self):
        with self._lock:
            self._cleanup_locked(self._now_provider().date())

    def _cleanup_locked(self, today):
        cutoff = today - timedelta(days=self.retention_days - 1)
        dated_files = []
        for path in self.log_dir.glob("run_log_*.jsonl"):
            match = self.FILE_PATTERN.fullmatch(path.name)
            if not match:
                continue
            try:
                file_date = date.fromisoformat(match.group(1))
            except ValueError:
                continue
            if file_date < cutoff:
                path.unlink(missing_ok=True)
                continue
            dated_files.append((file_date, path))

        managed_paths = {}
        for pattern in ("*.log*", "run_log_*.jsonl"):
            for path in self.log_dir.glob(pattern):
                if path.is_file():
                    managed_paths[str(path.resolve())] = path
        entries = []
        total_size = 0
        for path in managed_paths.values():
            try:
                stat = path.stat()
            except OSError:
                continue
            modified_date = date.fromtimestamp(stat.st_mtime)
            entries.append((modified_date, stat.st_mtime, path, stat.st_size))
            total_size += stat.st_size
        for file_date, _, path, file_size in sorted(entries):
            if total_size <= self.soft_limit_bytes:
                break
            if file_date >= today or not path.exists():
                continue
            path.unlink(missing_ok=True)
            total_size = max(0, total_size - file_size)
        self._last_cleanup_date = today

    def _append_file_locked(self, item, current_date):
        path = self.log_dir / f"run_log_{current_date.isoformat()}.jsonl"
        line = json.dumps(
            item,
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )
        with path.open("a", encoding="utf-8", newline="") as handle:
            handle.write(line + "\n")

    def _normalize_cursor(self, value, field_name):
        if value is None:
            return None
        if isinstance(value, bool):
            raise ValueError(f"{field_name} の形式が不正です。")
        try:
            cursor = int(value)
        except (TypeError, ValueError) as error:
            raise ValueError(f"{field_name} の形式が不正です。") from error
        if cursor < 1:
            raise ValueError(f"{field_name} は1以上で指定してください。")
        return cursor

    def _coerce_datetime(self, value):
        if isinstance(value, datetime):
            parsed = value
        elif value:
            try:
                parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except ValueError:
                return None
        else:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    def _set_optional_text(self, target, key, value):
        text = _safe_text(value)
        if text:
            target[key] = text

    def _set_optional_int(self, target, key, value):
        if value is None or isinstance(value, bool):
            return
        try:
            target[key] = int(value)
        except (TypeError, ValueError):
            return

    def _require_text(self, value, field_name):
        text = _safe_text(value)
        if not text:
            raise ValueError(f"{field_name} は必須です。")
        return text
