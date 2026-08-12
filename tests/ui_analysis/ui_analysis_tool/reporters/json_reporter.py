from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict

from ui_analysis_tool.models import Envelope, to_jsonable


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = payload.to_dict() if isinstance(payload, Envelope) else to_jsonable(payload)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_inventory_reports(out_path: Path, project_root: str, payloads: Dict[str, Any]) -> None:
    inventory_dir = out_path / "inventory"
    for name, data in payloads.items():
        write_json(inventory_dir / f"{name}.json", Envelope(project_root=project_root, data=data))


def write_extracted_reports(out_path: Path, project_root: str, payloads: Dict[str, Any]) -> None:
    extracted_dir = out_path / "extracted"
    for name, data in payloads.items():
        write_json(extracted_dir / f"{name}.json", Envelope(project_root=project_root, data=data))


def write_analyzed_reports(out_path: Path, project_root: str, payloads: Dict[str, Any]) -> None:
    analyzed_dir = out_path / "analyzed"
    for name, data in payloads.items():
        write_json(analyzed_dir / f"{name}.json", Envelope(project_root=project_root, data=data))


def write_table_reports(out_path: Path, project_root: str, payloads: Dict[str, Any]) -> None:
    table_dir = out_path / "tables"
    for name, data in payloads.items():
        write_json(table_dir / f"{name}.json", Envelope(project_root=project_root, data=data))
