import threading
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass


@dataclass(frozen=True)
class _WorkerRequest:
    ticket: int
    run_id: str


class WorkerPool:
    def __init__(self, max_workers=4, *, lock=None):
        self.max_workers = max(1, int(max_workers))
        self._condition = threading.Condition(lock or threading.RLock())
        self._pending = deque()
        self._active_count = 0
        self._active_by_run = {}
        self._next_ticket = 0
        self._last_granted_run_id = ""

    @contextmanager
    def lease(self, run_id, *, cancel_event=None, on_queued=None):
        acquired = self.acquire(
            run_id,
            cancel_event=cancel_event,
            on_queued=on_queued,
        )
        try:
            yield acquired
        finally:
            if acquired:
                self.release(run_id)

    def acquire(self, run_id, *, cancel_event=None, on_queued=None):
        normalized_run_id = str(run_id or "").strip()
        if not normalized_run_id:
            raise ValueError("run_id は必須です。")

        with self._condition:
            self._next_ticket += 1
            request = _WorkerRequest(self._next_ticket, normalized_run_id)
            self._pending.append(request)
            queued_notified = False

            while True:
                if cancel_event is not None and cancel_event.is_set():
                    self._remove_request_locked(request)
                    self._condition.notify_all()
                    return False

                selected = self._next_request_locked()
                if (
                    self._active_count < self.max_workers
                    and selected == request
                ):
                    self._remove_request_locked(request)
                    self._active_count += 1
                    self._active_by_run[normalized_run_id] = (
                        int(self._active_by_run.get(normalized_run_id, 0)) + 1
                    )
                    self._last_granted_run_id = normalized_run_id
                    return True

                if not queued_notified and callable(on_queued):
                    queued_notified = True
                    on_queued()
                self._condition.wait(timeout=0.05)

    def release(self, run_id):
        normalized_run_id = str(run_id or "").strip()
        with self._condition:
            active_for_run = int(
                self._active_by_run.get(normalized_run_id, 0)
            )
            if active_for_run <= 0:
                raise RuntimeError("取得していないworkerは解放できません。")
            if active_for_run == 1:
                self._active_by_run.pop(normalized_run_id, None)
            else:
                self._active_by_run[normalized_run_id] = active_for_run - 1
            self._active_count -= 1
            self._condition.notify_all()

    def snapshot(self):
        with self._condition:
            return {
                "max_workers": self.max_workers,
                "active_count": self._active_count,
                "queued_count": len(self._pending),
                "active_by_run": dict(self._active_by_run),
            }

    def _next_request_locked(self):
        if not self._pending:
            return None
        if not self._last_granted_run_id:
            return self._pending[0]
        for request in self._pending:
            if request.run_id != self._last_granted_run_id:
                return request
        return self._pending[0]

    def _remove_request_locked(self, target):
        try:
            self._pending.remove(target)
        except ValueError:
            return
