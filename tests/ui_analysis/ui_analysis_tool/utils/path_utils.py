from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.parse import unquote, urlsplit


def safe_relative(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except Exception:
        return path.as_posix()


def sha1_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def strip_url_query(src: str) -> str:
    text = str(src or "").strip()
    if not text:
        return ""
    if text.startswith(("http://", "https://", "//", "data:", "qrc:")):
        return text
    parts = urlsplit(text)
    raw = parts.path or text.split("?", 1)[0].split("#", 1)[0]
    return unquote(raw)


def resolve_local_ref(base_file: Path, project_root: Path, ref: str) -> Path | None:
    cleaned = strip_url_query(ref)
    if not cleaned:
        return None
    if cleaned.startswith(("http://", "https://", "//", "data:", "qrc:")):
        return None
    candidate = (base_file.parent / cleaned).resolve()
    if candidate.exists():
        return candidate
    # Some HTML files use ./js/... while JS files may be copied near the root during prototyping.
    root_candidate = (project_root / cleaned.lstrip("/.")).resolve()
    if root_candidate.exists():
        return root_candidate
    return candidate


def is_relative_to(path: Path, maybe_parent: Path) -> bool:
    try:
        path.resolve().relative_to(maybe_parent.resolve())
        return True
    except Exception:
        return False
