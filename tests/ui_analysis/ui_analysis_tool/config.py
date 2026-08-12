from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List

DEFAULT_EXCLUDE_DIRS = {
    ".git",
    "__pycache__",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "dist",
    "build",
}

SUPPORTED_EXTENSIONS = {
    ".html": "html",
    ".htm": "html",
    ".js": "js",
    ".mjs": "js",
    ".cjs": "js",
    ".css": "css",
    ".json": "json",
}


@dataclass
class AnalysisOptions:
    root: Path
    out: Path
    exclude_dirs: List[str] = field(default_factory=lambda: sorted(DEFAULT_EXCLUDE_DIRS))
    include_css: bool = False
    include_json: bool = False
    verbose: bool = False

    @classmethod
    def from_raw(
        cls,
        root: str,
        out: str,
        exclude_dirs: Iterable[str] | None = None,
        include_css: bool = False,
        include_json: bool = False,
        verbose: bool = False,
    ) -> "AnalysisOptions":
        merged = set(DEFAULT_EXCLUDE_DIRS)
        if exclude_dirs:
            merged.update(str(x).strip() for x in exclude_dirs if str(x).strip())
        return cls(
            root=Path(root).expanduser().resolve(),
            out=Path(out).expanduser().resolve(),
            exclude_dirs=sorted(merged),
            include_css=include_css,
            include_json=include_json,
            verbose=verbose,
        )
