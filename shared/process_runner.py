from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
from dataclasses import dataclass

from shared.security_sanitizer import SensitiveDataSanitizer


TRUNCATED_MARKER = "\n...[output truncated]..."


@dataclass(frozen=True)
class ProcessResult:
    returncode: int
    stdout: str
    stderr: str
    stdout_truncated: bool
    stderr_truncated: bool
    duration_ms: int


class ProcessRunnerError(RuntimeError):
    def __init__(self, message, *, result=None):
        super().__init__(message)
        self.result = result


class ProcessStartError(ProcessRunnerError):
    pass


class ProcessExitError(ProcessRunnerError):
    pass


class ProcessCancelledError(ProcessRunnerError):
    pass


class ProcessTimeoutError(ProcessRunnerError):
    pass


class _BoundedText:
    def __init__(self, limit_bytes):
        self.limit_bytes = max(1, int(limit_bytes))
        self._chunks = []
        self._size = 0
        self.truncated = False

    def append(self, value):
        if self.truncated:
            return "ignored"
        text = str(value or "")
        encoded = text.encode("utf-8", errors="replace")
        remaining = self.limit_bytes - self._size
        if len(encoded) <= remaining:
            self._chunks.append(text)
            self._size += len(encoded)
            return "accepted"
        if remaining > 0:
            self._chunks.append(
                encoded[:remaining].decode("utf-8", errors="ignore")
            )
            self._size = self.limit_bytes
        self._chunks.append(TRUNCATED_MARKER)
        self.truncated = True
        return "truncated"

    def text(self):
        return "".join(self._chunks)


class ProcessRunner:
    DEFAULT_OUTPUT_LIMIT_BYTES = 1024 * 1024
    POLL_INTERVAL_SECONDS = 0.05
    TERMINATE_GRACE_SECONDS = 0.75

    def __init__(
        self,
        *,
        sanitizer=None,
        output_limit_bytes=DEFAULT_OUTPUT_LIMIT_BYTES,
        popen=None,
    ):
        self._sanitizer = sanitizer or SensitiveDataSanitizer()
        self._output_limit_bytes = max(1, int(output_limit_bytes))
        self._popen = popen or subprocess.Popen

    def run(
        self,
        command,
        *,
        label="process",
        shell=False,
        encoding="utf-8",
        cwd=None,
        env=None,
        timeout_seconds=None,
        cancel_event=None,
        secrets=(),
        on_stdout=None,
        on_stderr=None,
        creationflags=0,
    ):
        if cancel_event is not None and cancel_event.is_set():
            raise ProcessCancelledError(f"{label}はキャンセルされました。")

        flags = int(creationflags or 0)
        if os.name == "nt":
            flags |= int(getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
            flags |= int(getattr(subprocess, "CREATE_NO_WINDOW", 0))

        started = time.monotonic()
        try:
            process = self._popen(
                command,
                shell=bool(shell),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding=str(encoding or "utf-8"),
                errors="replace",
                cwd=cwd,
                env=env,
                bufsize=1,
                creationflags=flags,
            )
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            message = self._sanitize(
                f"{label}の起動に失敗しました: {error}",
                secrets,
            )
            raise ProcessStartError(message) from error

        output_queue = queue.Queue()
        readers = [
            self._start_reader(process.stdout, "stdout", output_queue),
            self._start_reader(process.stderr, "stderr", output_queue),
        ]
        stdout = _BoundedText(self._output_limit_bytes)
        stderr = _BoundedText(self._output_limit_bytes)
        stop_reason = ""

        while process.poll() is None or any(
            reader.is_alive() for reader in readers
        ) or not output_queue.empty():
            self._drain_output(
                output_queue,
                stdout,
                stderr,
                secrets=secrets,
                on_stdout=on_stdout,
                on_stderr=on_stderr,
            )
            if process.poll() is None and not stop_reason:
                if cancel_event is not None and cancel_event.is_set():
                    stop_reason = "cancelled"
                    self._stop_process_tree(process)
                elif (
                    timeout_seconds is not None
                    and time.monotonic() - started
                    >= max(0.0, float(timeout_seconds))
                ):
                    stop_reason = "timeout"
                    self._stop_process_tree(process)
            if process.poll() is None or any(
                reader.is_alive() for reader in readers
            ):
                time.sleep(self.POLL_INTERVAL_SECONDS)

        for reader in readers:
            reader.join(timeout=self.TERMINATE_GRACE_SECONDS)
        self._drain_output(
            output_queue,
            stdout,
            stderr,
            secrets=secrets,
            on_stdout=on_stdout,
            on_stderr=on_stderr,
        )
        returncode = int(process.wait())
        result = ProcessResult(
            returncode=returncode,
            stdout=stdout.text(),
            stderr=stderr.text(),
            stdout_truncated=stdout.truncated,
            stderr_truncated=stderr.truncated,
            duration_ms=max(
                0,
                int((time.monotonic() - started) * 1000),
            ),
        )

        if stop_reason == "cancelled":
            raise ProcessCancelledError(
                self._failure_message(label, "キャンセルされました", result),
                result=result,
            )
        if stop_reason == "timeout":
            raise ProcessTimeoutError(
                self._failure_message(label, "タイムアウトしました", result),
                result=result,
            )
        if returncode != 0:
            raise ProcessExitError(
                self._failure_message(label, "実行に失敗しました", result),
                result=result,
            )
        return result

    def _start_reader(self, stream, stream_name, output_queue):
        def read_stream():
            if stream is None:
                return
            try:
                for chunk in iter(stream.readline, ""):
                    if not chunk:
                        break
                    output_queue.put((stream_name, chunk))
            finally:
                try:
                    stream.close()
                except Exception:
                    pass

        reader = threading.Thread(
            target=read_stream,
            daemon=True,
            name=f"process-{stream_name}",
        )
        reader.start()
        return reader

    def _drain_output(
        self,
        output_queue,
        stdout,
        stderr,
        *,
        secrets,
        on_stdout,
        on_stderr,
    ):
        while True:
            try:
                stream_name, chunk = output_queue.get_nowait()
            except queue.Empty:
                break
            sanitized = self._sanitize(chunk, secrets)
            target = stdout if stream_name == "stdout" else stderr
            callback = on_stdout if stream_name == "stdout" else on_stderr
            append_status = target.append(sanitized)
            if callable(callback) and append_status == "accepted":
                line = sanitized.rstrip("\r\n")
                if line:
                    callback(line)
            elif callable(callback) and append_status == "truncated":
                callback(TRUNCATED_MARKER.strip())

    def _sanitize(self, value, secrets):
        return self._sanitizer.sanitize_text(
            value,
            secrets=secrets,
            mask_paths=False,
        )

    def _failure_message(self, label, reason, result):
        sections = [
            f"{label}: {reason}",
            f"Exit Code: {result.returncode}",
        ]
        if result.stdout:
            sections.append(f"Stdout:\n{result.stdout.rstrip()}")
        if result.stderr:
            sections.append(f"Stderr:\n{result.stderr.rstrip()}")
        return "\n".join(sections)

    def _stop_process_tree(self, process):
        if process.poll() is not None:
            return
        if os.name == "nt":
            self._taskkill(process.pid, force=False)
            try:
                process.wait(timeout=self.TERMINATE_GRACE_SECONDS)
                return
            except subprocess.SubprocessError:
                self._taskkill(process.pid, force=True)
                try:
                    process.wait(timeout=self.TERMINATE_GRACE_SECONDS)
                    return
                except subprocess.SubprocessError:
                    pass
        try:
            process.terminate()
            process.wait(timeout=self.TERMINATE_GRACE_SECONDS)
            return
        except (OSError, subprocess.SubprocessError):
            pass

        if process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass

    def _taskkill(self, process_id, *, force):
        command = [
            "taskkill",
            "/PID",
            str(process_id),
            "/T",
        ]
        if force:
            command.append("/F")
        try:
            subprocess.run(
                command,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=int(
                    getattr(subprocess, "CREATE_NO_WINDOW", 0)
                ),
            )
        except OSError:
            return
