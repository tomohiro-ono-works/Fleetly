from __future__ import annotations

import os
from pathlib import Path


class GuiSingleInstanceGuard:
    def __init__(self, lock_path=None):
        self.lock_path = (
            Path(lock_path)
            if lock_path is not None
            else self.default_lock_path()
        )
        self._stream = None
        self._acquired = False

    @staticmethod
    def default_lock_path():
        local_app_data = str(
            os.environ.get("LOCALAPPDATA") or ""
        ).strip()
        base = (
            Path(local_app_data)
            if local_app_data
            else Path.home() / "AppData" / "Local"
        )
        return base / "zizai" / "runtime" / "gui.instance.lock"

    @property
    def acquired(self):
        return self._acquired

    def acquire(self):
        if self._acquired:
            return True
        if os.name != "nt":
            raise RuntimeError(
                "Zizai GUIのsingle-instance guardはWindows専用です。"
            )
        import msvcrt

        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        stream = self.lock_path.open("a+b")
        stream.seek(0, os.SEEK_END)
        if stream.tell() == 0:
            stream.write(b"\0")
            stream.flush()
        stream.seek(0)
        try:
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            stream.close()
            return False
        self._stream = stream
        self._acquired = True
        return True

    def release(self):
        if not self._acquired or self._stream is None:
            return
        import msvcrt

        try:
            self._stream.seek(0)
            msvcrt.locking(
                self._stream.fileno(),
                msvcrt.LK_UNLCK,
                1,
            )
        finally:
            self._stream.close()
            self._stream = None
            self._acquired = False

    def __enter__(self):
        if not self.acquire():
            raise RuntimeError("Zizai GUIはすでに起動しています。")
        return self

    def __exit__(self, _exc_type, _exc_value, _traceback):
        self.release()
