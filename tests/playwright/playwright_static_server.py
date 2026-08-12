from __future__ import annotations

import argparse
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


REPO_ROOT = Path(__file__).resolve().parents[2]
STATIC_ROOT = REPO_ROOT / "static"


class StaticOnlyHandler(BaseHTTPRequestHandler):
    server_version = "zizai-playwright/1.0"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:  # noqa: N802
        self._serve()

    def do_HEAD(self) -> None:  # noqa: N802
        self._serve(send_body=False)

    def do_POST(self) -> None:  # noqa: N802
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Only GET and HEAD are allowed.")

    def do_PUT(self) -> None:  # noqa: N802
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Only GET and HEAD are allowed.")

    def do_DELETE(self) -> None:  # noqa: N802
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Only GET and HEAD are allowed.")

    def list_directory(self, path):  # type: ignore[override]
        self.send_error(HTTPStatus.FORBIDDEN, "Directory listing is disabled.")
        return None

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _serve(self, send_body: bool = True) -> None:
        file_path = self._resolve_path()
        if file_path is None:
            self.send_error(HTTPStatus.NOT_FOUND, "Not found.")
            return

        try:
            content = file_path.read_bytes()
        except OSError:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, "Failed to read file.")
            return

        content_type, _ = mimetypes.guess_type(str(file_path))
        body = content if send_body else b""
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if send_body:
            self.wfile.write(body)

    def _resolve_path(self) -> Path | None:
        raw_path = urlsplit(self.path).path
        path = unquote(raw_path or "/")
        if not path.startswith("/static/"):
            return None
        relative = path[len("/static/") :]
        candidate = (STATIC_ROOT / relative).resolve()
        try:
            candidate.relative_to(STATIC_ROOT.resolve())
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        return candidate


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), StaticOnlyHandler)
    print(f"Serving playwright static assets on http://{args.host}:{args.port}/static/home.html", flush=True)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
