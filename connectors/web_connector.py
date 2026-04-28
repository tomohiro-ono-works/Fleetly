import os
import base64
import hashlib
import json
import random
import socket
import ssl
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse
from urllib.request import urlopen

import pandas as pd

from connectors.base_connector import BaseConnector
from core.security_policies import is_web_target_allowed


class WebConnector(BaseConnector):
    CDP_HOST = "127.0.0.1"
    CDP_PORT = 9222
    CDP_TIMEOUT_SECONDS = 10.0

    def execute(self, action: str, params: dict[str, Any], context: dict[str, Any]) -> Any:
        if action not in {
            "open_chrome_page",
            "lookat_pages",
            "lookat_page",
            "easy_get_element",
            "easy_click_element",
        }:
            raise ValueError(f"Unknown action: {action}")

        if action in {"open_chrome_page", "lookat_pages", "lookat_page"}:
            target = self._normalize_optional_text(params.get("url"))
            if not target:
                raise ValueError("url は必須です。")
            try:
                result = self.open_chrome_page(target)
                return self._build_result_dataframe(
                    action=action,
                    target=result["target"],
                    status="success",
                    message=result["message"],
                )
            except Exception as error:
                raise RuntimeError(str(error)) from error

        text = self._normalize_optional_text(params.get("text"))
        if not text:
            raise ValueError("text は必須です。")
        occurrence = self._parse_occurrence(params.get("occurrence"))
        url_hint = self._normalize_optional_text(params.get("url"))
        try:
            matched = self._easy_match_element(
                text=text,
                occurrence=occurrence,
                click=(action == "easy_click_element"),
                url_hint=url_hint,
            )
            return self._build_easy_result_dataframe(
                action=action,
                status="success",
                message=matched.get("message") or "成功",
                matched=matched,
            )
        except Exception as error:
            raise RuntimeError(str(error)) from error

    @staticmethod
    def _normalize_optional_text(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _parse_occurrence(value: Any) -> int:
        if value in {None, ""}:
            return 1
        try:
            parsed = int(value)
        except (TypeError, ValueError) as error:
            raise ValueError("occurrence は 1 以上の整数で指定してください。") from error
        if parsed < 1:
            raise ValueError("occurrence は 1 以上の整数で指定してください。")
        return parsed

    @staticmethod
    def _find_chrome_executable() -> Optional[str]:
        executable = shutil.which("chrome") or shutil.which("chrome.exe")
        if executable:
            return executable

        candidates = [
            Path(os.environ.get("PROGRAMFILES", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("PROGRAMFILES(X86)", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe",
        ]
        for candidate in candidates:
            if str(candidate) and candidate.exists():
                return str(candidate)
        return None

    def _build_result_dataframe(self, *, action: str, target: str, status: str, message: str) -> pd.DataFrame:
        return pd.DataFrame([{
            "status": str(status),
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "connector": "WebConnector",
            "action": str(action),
            "target": str(target or ""),
            "message": str(message or ""),
        }])

    def _build_easy_result_dataframe(
        self,
        *,
        action: str,
        status: str,
        message: str,
        matched: dict[str, Any],
    ) -> pd.DataFrame:
        return pd.DataFrame([{
            "status": str(status),
            "executed_at": datetime.now(timezone.utc).isoformat(),
            "connector": "WebConnector",
            "action": str(action),
            "target": str(matched.get("page_url") or ""),
            "text": str(matched.get("text") or ""),
            "occurrence": int(matched.get("occurrence") or 1),
            "total_matches": int(matched.get("total_matches") or 0),
            "tag_name": str(matched.get("tag_name") or ""),
            "dom_path": str(matched.get("dom_path") or ""),
            "outer_html": str(matched.get("outer_html") or ""),
            "clicked": bool(matched.get("clicked")),
            "message": str(message or ""),
        }])

    def _resolve_open_target(self, target: str) -> str:
        normalized_target = self.normalize_file_path(target)
        if not normalized_target:
            raise ValueError("url は必須です。")

        parsed = urlparse(normalized_target)
        if parsed.scheme in {"http", "https", "file"}:
            return normalized_target

        path = Path(normalized_target)
        if path.exists():
            return path.resolve().as_uri()

        if "://" in normalized_target:
            return normalized_target

        return f"https://{normalized_target}"

    def open_chrome_page(self, target: str) -> dict[str, str]:
        chrome_path = self._find_chrome_executable()
        if not chrome_path:
            raise FileNotFoundError("Chrome が見つかりませんでした。")

        open_target = self._resolve_open_target(target)
        parsed = urlparse(open_target)
        if parsed.scheme in {"http", "https"} and not is_web_target_allowed(open_target):
            raise ValueError(f"Web allowlist に未登録のため開けません: {parsed.netloc}{parsed.path or '/'}")
        subprocess.Popen([
            chrome_path,
            f"--remote-debugging-port={self.CDP_PORT}",
            "--new-window",
            open_target,
        ])
        try:
            self._wait_for_cdp_ready(timeout_seconds=5.0)
        except Exception:
            # open アクションはページ起動を優先し、CDP待機失敗のみでは失敗扱いにしない。
            pass
        return {
            "target": open_target,
            "message": f"Chrome で開きました: {open_target}",
        }

    def _easy_match_element(
        self,
        *,
        text: str,
        occurrence: int,
        click: bool,
        url_hint: Optional[str],
    ) -> dict[str, Any]:
        page = self._resolve_target_page(url_hint=url_hint)
        ws_url = str(page.get("webSocketDebuggerUrl") or "").strip()
        if not ws_url:
            raise RuntimeError("対象ページのデバッグソケットが見つかりません。")
        script = self._build_easy_match_script(text=text, occurrence=occurrence, click=click)
        with _CdpSocket(ws_url, timeout_seconds=self.CDP_TIMEOUT_SECONDS) as cdp:
            self._cdp_call(cdp, "Page.bringToFront", {})
            eval_result = self._cdp_call(cdp, "Runtime.evaluate", {
                "expression": script,
                "returnByValue": True,
                "awaitPromise": True,
            })
        payload = (((eval_result or {}).get("result") or {}).get("value") or {})
        if not isinstance(payload, dict):
            raise RuntimeError("要素検索結果の解析に失敗しました。")
        if not payload.get("ok"):
            raise RuntimeError(str(payload.get("error") or "要素が見つかりませんでした。"))
        payload["page_url"] = str(page.get("url") or "")
        payload["text"] = text
        payload["occurrence"] = occurrence
        return payload

    def _resolve_target_page(self, *, url_hint: Optional[str]) -> dict[str, Any]:
        pages = self._list_cdp_pages()
        if not pages:
            if url_hint:
                self.open_chrome_page(url_hint)
                pages = self._list_cdp_pages()
            if not pages:
                raise RuntimeError("Chrome のデバッグ対象ページがありません。先に Chromeで開く を実行してください。")

        normalized_hint = self._normalize_url_hint(url_hint) if url_hint else ""
        if normalized_hint:
            exact = [page for page in pages if str(page.get("url") or "") == normalized_hint]
            if exact:
                return exact[0]
            partial = [page for page in pages if normalized_hint in str(page.get("url") or "")]
            if partial:
                return partial[0]
            self.open_chrome_page(normalized_hint)
            pages = self._list_cdp_pages()
            exact = [page for page in pages if str(page.get("url") or "") == normalized_hint]
            if exact:
                return exact[0]

        return pages[0]

    def _normalize_url_hint(self, value: str) -> str:
        if not value:
            return ""
        target = self._resolve_open_target(value)
        parsed = urlparse(target)
        if parsed.scheme in {"http", "https"} and not is_web_target_allowed(target):
            raise ValueError(f"Web allowlist に未登録のため操作できません: {parsed.netloc}{parsed.path or '/'}")
        return target

    def _wait_for_cdp_ready(self, timeout_seconds: float) -> None:
        deadline = time.time() + max(0.2, float(timeout_seconds))
        last_error: Exception | None = None
        while time.time() < deadline:
            try:
                info = self._read_cdp_json("version")
                if isinstance(info, dict) and info.get("webSocketDebuggerUrl"):
                    return
            except Exception as error:
                last_error = error
            time.sleep(0.2)
        if last_error:
            raise RuntimeError(f"Chrome DevTools 接続待機に失敗しました: {last_error}") from last_error
        raise RuntimeError("Chrome DevTools 接続待機に失敗しました。")

    def _list_cdp_pages(self) -> list[dict[str, Any]]:
        data = self._read_cdp_json("list")
        pages = []
        for item in data if isinstance(data, list) else []:
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "") != "page":
                continue
            url = str(item.get("url") or "")
            if url.startswith("devtools://"):
                continue
            if not str(item.get("webSocketDebuggerUrl") or "").strip():
                continue
            pages.append(item)
        return pages

    def _read_cdp_json(self, route: str) -> Any:
        url = f"http://{self.CDP_HOST}:{self.CDP_PORT}/json/{route}"
        with urlopen(url, timeout=self.CDP_TIMEOUT_SECONDS) as response:
            raw = response.read()
        return json.loads(raw.decode("utf-8"))

    @staticmethod
    def _build_easy_match_script(*, text: str, occurrence: int, click: bool) -> str:
        payload_text = json.dumps(text, ensure_ascii=False)
        payload_occurrence = int(occurrence)
        payload_click = "true" if click else "false"
        return f"""
(() => {{
  const targetText = String({payload_text} ?? "").trim();
  const occurrence = Math.max(1, Number({payload_occurrence}) || 1);
  const doClick = {payload_click};
  if (!targetText) return {{ ok: false, error: "text は必須です。" }};

  const elements = Array.from(document.querySelectorAll("*")).filter((element) => {{
    if (!element) return false;
    if (element.children && element.children.length > 0) return false;
    if (element.attributes && element.attributes.length > 0) return false;
    const textValue = String(element.textContent || "").trim();
    return textValue === targetText;
  }});
  if (!elements.length) {{
    return {{ ok: false, error: `完全一致要素が見つかりません: ${{targetText}}` }};
  }}
  if (occurrence > elements.length) {{
    return {{ ok: false, error: `指定件数がヒット数を超えています: ${{occurrence}} / ${{elements.length}}` }};
  }}

  const element = elements[occurrence - 1];
  element.scrollIntoView({{ block: "center", inline: "center", behavior: "instant" }});
  const tagName = String(element.tagName || "").toLowerCase();
  const outerHtml = String(element.outerHTML || "");
  const domPathParts = [];
  let current = element;
  while (current && current.nodeType === 1) {{
    const parent = current.parentElement;
    const index = parent ? (Array.prototype.indexOf.call(parent.children, current) + 1) : 1;
    domPathParts.unshift(`${{String(current.tagName || "").toLowerCase()}}:nth-child(${{index}})`);
    current = parent;
  }}
  const domPath = domPathParts.join(" > ");

  if (doClick) {{
    if (typeof element.click === "function") {{
      element.click();
    }} else {{
      const clickEvent = new MouseEvent("click", {{ bubbles: true, cancelable: true, view: window }});
      element.dispatchEvent(clickEvent);
    }}
  }}
  return {{
    ok: true,
    clicked: doClick,
    total_matches: elements.length,
    tag_name: tagName,
    outer_html: outerHtml,
    dom_path: domPath,
    message: doClick ? "対象DOMへ click() を実行しました。" : "対象DOMを取得しました。"
  }};
}})();
""".strip()

    @staticmethod
    def _cdp_call(client: "_CdpSocket", method: str, params: dict[str, Any]) -> dict[str, Any]:
        return client.call(method=method, params=params)


class _CdpSocket:
    def __init__(self, ws_url: str, *, timeout_seconds: float = 10.0) -> None:
        self.ws_url = str(ws_url or "")
        self.timeout_seconds = max(1.0, float(timeout_seconds))
        self._socket: socket.socket | ssl.SSLSocket | None = None
        self._next_id = 0

    def __enter__(self) -> "_CdpSocket":
        self._connect()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def close(self) -> None:
        if self._socket:
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None

    def call(self, *, method: str, params: dict[str, Any]) -> dict[str, Any]:
        self._next_id += 1
        request_id = self._next_id
        payload = json.dumps({
            "id": request_id,
            "method": str(method),
            "params": params or {},
        }, ensure_ascii=False)
        self._send_text(payload)
        deadline = time.time() + self.timeout_seconds
        while time.time() < deadline:
            message = self._receive_json()
            if not isinstance(message, dict):
                continue
            if int(message.get("id") or 0) != request_id:
                continue
            if message.get("error"):
                error = message["error"]
                raise RuntimeError(str(error.get("message") or error))
            return message.get("result") or {}
        raise RuntimeError(f"CDP 応答待機がタイムアウトしました: {method}")

    def _connect(self) -> None:
        parsed = urlparse(self.ws_url)
        if parsed.scheme not in {"ws", "wss"}:
            raise ValueError(f"無効な WebSocket URL: {self.ws_url}")
        host = parsed.hostname or "127.0.0.1"
        port = parsed.port or (443 if parsed.scheme == "wss" else 80)
        resource = parsed.path or "/"
        if parsed.query:
            resource += f"?{parsed.query}"

        raw_sock = socket.create_connection((host, port), timeout=self.timeout_seconds)
        if parsed.scheme == "wss":
            context = ssl.create_default_context()
            sock = context.wrap_socket(raw_sock, server_hostname=host)
        else:
            sock = raw_sock
        sock.settimeout(self.timeout_seconds)
        self._socket = sock

        sec_key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {resource} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {sec_key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self._socket.sendall(request.encode("utf-8"))
        response = self._read_http_response_header()
        if " 101 " not in response.split("\r\n", 1)[0]:
            raise RuntimeError(f"WebSocket 接続に失敗しました: {response.splitlines()[0] if response else 'no response'}")
        accept_key = self._extract_header(response, "Sec-WebSocket-Accept")
        expected = base64.b64encode(
            hashlib.sha1((sec_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("utf-8")).digest()
        ).decode("ascii")
        if accept_key != expected:
            raise RuntimeError("WebSocket ハンドシェイク検証に失敗しました。")

    def _read_http_response_header(self) -> str:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self._socket.recv(4096)
            if not chunk:
                break
            data += chunk
            if len(data) > 65536:
                break
        return data.decode("utf-8", errors="ignore")

    @staticmethod
    def _extract_header(response_header: str, key: str) -> str:
        key_lower = str(key).lower()
        for line in response_header.split("\r\n"):
            if ":" not in line:
                continue
            name, value = line.split(":", 1)
            if name.strip().lower() == key_lower:
                return value.strip()
        return ""

    def _send_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        frame = bytearray()
        frame.append(0x81)
        payload_length = len(payload)
        if payload_length < 126:
            frame.append(0x80 | payload_length)
        elif payload_length < (1 << 16):
            frame.append(0x80 | 126)
            frame.extend(payload_length.to_bytes(2, "big"))
        else:
            frame.append(0x80 | 127)
            frame.extend(payload_length.to_bytes(8, "big"))
        mask_key = random.randbytes(4) if hasattr(random, "randbytes") else os.urandom(4)
        frame.extend(mask_key)
        masked = bytes(payload[i] ^ mask_key[i % 4] for i in range(payload_length))
        frame.extend(masked)
        self._socket.sendall(bytes(frame))

    def _receive_json(self) -> Any:
        payload = self._receive_frame()
        if payload is None:
            return None
        try:
            return json.loads(payload.decode("utf-8", errors="ignore"))
        except json.JSONDecodeError:
            return None

    def _receive_frame(self) -> Optional[bytes]:
        first = self._recv_exact(2)
        if not first:
            return None
        first_byte, second_byte = first[0], first[1]
        opcode = first_byte & 0x0F
        masked = (second_byte & 0x80) != 0
        length = second_byte & 0x7F
        if length == 126:
            length = int.from_bytes(self._recv_exact(2), "big")
        elif length == 127:
            length = int.from_bytes(self._recv_exact(8), "big")
        mask_key = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length) if length else b""
        if masked and mask_key:
            payload = bytes(payload[i] ^ mask_key[i % 4] for i in range(len(payload)))
        if opcode == 0x8:
            return None
        return payload

    def _recv_exact(self, nbytes: int) -> bytes:
        chunks = bytearray()
        while len(chunks) < nbytes:
            chunk = self._socket.recv(nbytes - len(chunks))
            if not chunk:
                raise RuntimeError("WebSocket 接続が切断されました。")
            chunks.extend(chunk)
        return bytes(chunks)
