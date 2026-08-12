from __future__ import annotations

from pathlib import Path
from typing import List

from ui_analysis_tool.config import AnalysisOptions, SUPPORTED_EXTENSIONS
from ui_analysis_tool.models import FileRecord
from ui_analysis_tool.utils.path_utils import is_relative_to, safe_relative, sha1_file


def classify_file_type(path: Path) -> str:
    return SUPPORTED_EXTENSIONS.get(path.suffix.lower(), "other")


def should_include_file(path: Path, options: AnalysisOptions) -> bool:
    file_type = classify_file_type(path)
    if file_type in {"html", "js"}:
        return True
    if file_type == "css" and options.include_css:
        return True
    if file_type == "json" and options.include_json:
        return True
    return False


def should_skip_dir(path: Path, options: AnalysisOptions) -> bool:
    if path.name in set(options.exclude_dirs):
        return True
    # Do not re-scan generated reports when out is inside root.
    if path.resolve() == options.out.resolve() or is_relative_to(path, options.out):
        return True
    return False


def collect_project_files(options: AnalysisOptions) -> List[FileRecord]:
    root = options.root
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"root directory not found: {root}")

    records: List[FileRecord] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if any(part in set(options.exclude_dirs) for part in path.relative_to(root).parts[:-1]):
            continue
        if is_relative_to(path, options.out):
            continue
        if not should_include_file(path, options):
            continue
        relative = safe_relative(path, root)
        file_type = classify_file_type(path)
        records.append(
            FileRecord(
                file_id=relative,
                file_path=str(path),
                relative_path=relative,
                file_type=file_type,
                size_bytes=path.stat().st_size,
                sha1=sha1_file(path),
            )
        )
    return records
